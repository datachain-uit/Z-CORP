#!/bin/bash
# Z-CORP rerun protocol v3: one-command prover campaign runner (run on the macOS host).
#
#   bash bench/run-campaign.sh preflight                   host + container pre-flight, P7; no rounds
#   bash bench/run-campaign.sh dryrun [--plan resumetest]  engineering dry run (protocol v3 §3.9)
#   bash bench/run-campaign.sh campaign                    full prover campaign (needs ZCORP_ALLOW_FULL_CAMPAIGN=1)
#   bash bench/run-campaign.sh resume <campaign-dir>       continue an existing dry run or campaign
#
# Round-level resume (protocol v3 §3.2): a (kind, round) unit with all its profiles is atomic.
# A unit is accepted only after every profile finished and bench/validate_round.js passed; the
# outcome is appended to prover/round_ledger.csv. A restarted session re-runs the host and
# container pre-flight, refuses to continue if the campaign ID, git commit, uncommitted state of
# the campaign paths, image, artifact manifest, adapter, harness, schedule, protocol version or
# Docker environment differ,
# records a new session ID, preserves any interrupted attempt as "incomplete" evidence and
# continues with the first unit that has no accepted attempt, as a new attempt of the whole unit.
#
# Optional environment:
#   ZCORP_STOP_AFTER_ROUNDS=N              stop cleanly after N units accepted in this session
#   ZCORP_TEST_INTERRUPT_AFTER_CONTAINERS=N dry runs only: simulate a crash after N containers
#
# Outputs: dry runs and pre-flights -> build/campaigns/<campaign_id>/ (git-ignored);
#          full campaign            -> results/postcorr-<YYYYMMDD>/.
# Bash 3.2 compatible (macOS default).
set -u

usage() { echo "usage: $0 preflight | dryrun [--plan dryrun|resumetest] | campaign | resume <campaign-dir>"; exit 2; }
MODE="${1:-}"; [ $# -gt 0 ] && shift
PLAN=""; RESUME_DIR=""
case "$MODE" in
  preflight|campaign) ;;
  dryrun) if [ "${1:-}" = "--plan" ]; then PLAN="${2:-}"; [ -n "$PLAN" ] || usage; fi ;;
  resume) RESUME_DIR="${1:-}"; [ -n "$RESUME_DIR" ] || usage ;;
  *) usage ;;
esac

KIT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$KIT/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SESSION_ID="S${STAMP}"
PROTOCOL_VERSION=v3
IMAGE_TAG="${ZCORP_IMAGE_TAG:-zcorp-bench:v3}"
PLATFORM="${ZCORP_PLATFORM:-linux/arm64}"
EXPECT_DOCKER_ARCH="${ZCORP_EXPECT_DOCKER_ARCH:-aarch64}"
PROFILES="${ZCORP_PROFILES:-cpu2:1-2,cpu4:1-4,cpu8:1-8}"
BASE_REF="node:18.20.8-bookworm-slim@sha256:f9ab18e354e6855ae56ef2b290dd225c1e51a564f87584b9bd21dd651838830e"
MIN_NCPU="${ZCORP_MIN_NCPU:-9}"
MIN_MEM_GIB="${ZCORP_MIN_MEM_GIB:-11.0}"
CAMPAIGN_PATHS="bench scripts/setup circuits contracts test ARTIFACTS.sha256 PROVENANCE.md"

jget() { sed -n "s/.*\"$1\": \"\([^\"]*\)\".*/\1/p" "$OUT/CAMPAIGN.json" | head -1; }
sha() { shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1; }

if [ "$MODE" = resume ]; then
  OUT="$(cd "$RESUME_DIR" 2>/dev/null && pwd)" || { echo "ABORT: no such campaign directory: $RESUME_DIR"; exit 2; }
  [ -f "$OUT/CAMPAIGN.json" ] || { echo "ABORT: $OUT has no CAMPAIGN.json"; exit 2; }
  CAMPAIGN_ID="$(jget campaign_id)"
  CMODE="$(jget mode)"
  if [ "$CMODE" = campaign ] && [ "${ZCORP_ALLOW_FULL_CAMPAIGN:-0}" != 1 ]; then
    echo "ABORT: resuming the full prover campaign needs ZCORP_ALLOW_FULL_CAMPAIGN=1"; exit 2
  fi
else
  CAMPAIGN_ID="${ZCORP_CAMPAIGN_ID:-${MODE}-${STAMP}}"
  if [ "$MODE" = campaign ]; then
    OUT="${ZCORP_OUT:-$REPO/results/postcorr-$(date -u +%Y%m%d)}"; CMODE=campaign; PLAN=campaign
  else
    OUT="${ZCORP_OUT:-$REPO/build/campaigns/$CAMPAIGN_ID}"; CMODE=dryrun; [ -n "$PLAN" ] || PLAN=dryrun
  fi
  if [ -e "$OUT/CAMPAIGN.json" ]; then echo "ABORT: $OUT already holds a campaign (use: resume $OUT)"; exit 2; fi
  if [ "$MODE" = campaign ] && [ "${ZCORP_ALLOW_FULL_CAMPAIGN:-0}" != 1 ]; then
    echo "ABORT: the full prover campaign is not enabled in this run (set ZCORP_ALLOW_FULL_CAMPAIGN=1 deliberately)."; exit 2
  fi
fi
if [ -n "${ZCORP_TEST_INTERRUPT_AFTER_CONTAINERS:-}" ] && [ "$CMODE" != dryrun ]; then
  echo "ABORT: simulated interruptions are allowed in dry runs only"; exit 2
fi
case "$OUT" in "$REPO"/*) OUT_REL="${OUT#$REPO/}" ;; *) OUT_REL="" ;; esac

mkdir -p "$OUT/environment/preflight/$SESSION_ID" "$OUT/prover"
E="$OUT/environment"
LOG="$E/run-campaign.log"
exec > >(tee -a "$LOG") 2>&1
echo "== Z-CORP $PROTOCOL_VERSION $MODE: campaign $CAMPAIGN_ID, session $SESSION_ID -> $OUT"

# P9: keep the host awake while this runner lives. caffeinate is started here with -w $$, so it
# holds its assertions until this shell exits; its PID is known and is verified directly
# (process alive, process name, and a power assertion owned by that PID in `pmset -g assertions`).
CAFF_PID=""
if command -v caffeinate >/dev/null 2>&1; then caffeinate -dimsu -w $$ & CAFF_PID=$!; sleep 2; fi
caff_alive() { [ -n "$CAFF_PID" ] && kill -0 "$CAFF_PID" 2>/dev/null; }

COMPOSE="docker compose -f $KIT/compose.yaml"
[ -n "${ZCORP_COMPOSE_OVERRIDE:-}" ] && COMPOSE="$COMPOSE -f $ZCORP_COMPOSE_OVERRIDE"

# ------------------------------------------------------------------ session records
PSRC=""; LPM=""; CAFF_OK=0; NCPU=""; MEMB=""; DDV=""; ENGINE=""; KERNEL=""; IMAGE_ID="${IMAGE_ID:-}"
GIT_HEAD_BEFORE=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo none)
session_event() { # event detail
  local f="$E/sessions.csv"
  [ -f "$f" ] || echo "campaign_id,session_id,event,utc,mode,git_head,image_id,docker_desktop,engine,kernel,vm_ncpu,vm_mem_bytes,power_source,low_power_mode,caffeinated,detail" > "$f"
  echo "$CAMPAIGN_ID,$SESSION_ID,$1,$(date -u +%Y-%m-%dT%H:%M:%SZ),$MODE,$GIT_HEAD_BEFORE,$IMAGE_ID,$DDV,$ENGINE,$KERNEL,$NCPU,$MEMB,\"$PSRC\",$LPM,$CAFF_OK,\"$2\"" >> "$f"
}
fail() {
  echo "ABORT: $*"
  echo "result: FAIL ($*)" > "$E/RESULT-$SESSION_ID.txt"; cp "$E/RESULT-$SESSION_ID.txt" "$E/RESULT.txt"
  session_event end "FAIL: $*"
  exit 1
}

# ------------------------------------------------------------------ 1. host, P9 and Docker VM
{
  echo "session_id=$SESSION_ID"
  echo "hw.model=$(sysctl -n hw.model 2>/dev/null)"
  echo "cpu.brand=$(sysctl -n machdep.cpu.brand_string 2>/dev/null)"
  echo "hw.physicalcpu=$(sysctl -n hw.physicalcpu 2>/dev/null)"
  echo "perflevel0=$(sysctl -n hw.perflevel0.name 2>/dev/null) physicalcpu=$(sysctl -n hw.perflevel0.physicalcpu 2>/dev/null)"
  echo "perflevel1=$(sysctl -n hw.perflevel1.name 2>/dev/null) physicalcpu=$(sysctl -n hw.perflevel1.physicalcpu 2>/dev/null)"
  echo "hw.memsize=$(sysctl -n hw.memsize 2>/dev/null)"
  echo "macos=$(sw_vers -productVersion 2>/dev/null) build=$(sw_vers -buildVersion 2>/dev/null)"
  echo "model_name=$(system_profiler SPHardwareDataType 2>/dev/null | awk -F': ' '/Model Name/{print $2}')"
  echo "chip=$(system_profiler SPHardwareDataType 2>/dev/null | awk -F': ' '/Chip/{print $2}')"
  echo "power_source=$(pmset -g batt 2>/dev/null | head -1 | sed "s/.*'\(.*\)'.*/\1/")"
  echo "low_power_mode=$(pmset -g 2>/dev/null | awk '/lowpowermode/{print $2}')"
  echo "docker_desktop_app_version=$(defaults read /Applications/Docker.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null)"
  echo "docker_context=$(docker context show 2>/dev/null)"
  echo "git=$(git --version 2>/dev/null)"
  echo "caffeinate_pid=$CAFF_PID"
  echo "caffeinate_alive=$(caff_alive && echo 1 || echo 0)"
  echo "caffeinate_comm=$( [ -n "$CAFF_PID" ] && ps -o comm= -p "$CAFF_PID" 2>/dev/null | sed 's#.*/##')"
  NA=0; [ -n "$CAFF_PID" ] && NA=$(pmset -g assertions 2>/dev/null | grep -c "pid $CAFF_PID(caffeinate)")
  echo "caffeinate_assertions=${NA:-0}"
} > "$E/host-$SESSION_ID.txt"
pmset -g assertions > "$E/pmset-assertions-$SESSION_ID.txt" 2>&1
cp "$E/host-$SESSION_ID.txt" "$E/host.txt"
cat "$E/host-$SESSION_ID.txt"
PSRC=$(sed -n 's/^power_source=//p' "$E/host-$SESSION_ID.txt")
LPM=$(sed -n 's/^low_power_mode=//p' "$E/host-$SESSION_ID.txt")
CAFF_ALIVE=$(sed -n 's/^caffeinate_alive=//p' "$E/host-$SESSION_ID.txt")
CAFF_COMM=$(sed -n 's/^caffeinate_comm=//p' "$E/host-$SESSION_ID.txt")
CAFF_ASSERT=$(sed -n 's/^caffeinate_assertions=//p' "$E/host-$SESSION_ID.txt")
CAFF_OK=0; [ "$CAFF_ALIVE" = 1 ] && [ "$CAFF_COMM" = caffeinate ] && [ "${CAFF_ASSERT:-0}" -ge 1 ] 2>/dev/null && CAFF_OK=1
DDV=$(sed -n 's/^docker_desktop_app_version=//p' "$E/host-$SESSION_ID.txt")

# P9 host conditions. p9_ok <power_source> <low_power_mode> <caffeinate_ok 1|0>
p9_ok() { [ "$1" = "AC Power" ] && [ "$2" = 0 ] && [ "$3" = 1 ]; }
P9_ENFORCED=false
if [ "$MODE" = preflight ] || [ "$CMODE" = campaign ]; then P9_ENFORCED=true; fi
P9_ACTUAL=false; p9_ok "$PSRC" "$LPM" "$CAFF_OK" && P9_ACTUAL=true
NEG1=false; p9_ok "Battery Power" 0 1 || NEG1=true
NEG2=false; p9_ok "AC Power" 1 1 || NEG2=true
NEG3=false; p9_ok "AC Power" 0 0 || NEG3=true
printf '{\n  "session_id": "%s",\n  "enforced_in_this_mode": %s,\n  "power_source": "%s",\n  "low_power_mode": "%s",\n  "caffeinate_pid": "%s",\n  "caffeinate_alive": "%s",\n  "caffeinate_comm": "%s",\n  "caffeinate_assertions": "%s",\n  "caffeinate_ok": %s,\n  "conditions_met": %s,\n  "self_test_battery_rejected": %s,\n  "self_test_low_power_mode_rejected": %s,\n  "self_test_no_caffeinate_rejected": %s\n}\n' \
  "$SESSION_ID" "$P9_ENFORCED" "$PSRC" "$LPM" "$CAFF_PID" "$CAFF_ALIVE" "$CAFF_COMM" "$CAFF_ASSERT" "$([ $CAFF_OK = 1 ] && echo true || echo false)" "$P9_ACTUAL" "$NEG1" "$NEG2" "$NEG3" > "$E/p9-$SESSION_ID.json"
echo "P9: enforced=$P9_ENFORCED met=$P9_ACTUAL (power='$PSRC' lowpower=$LPM caffeinate pid=$CAFF_PID alive=$CAFF_ALIVE comm=$CAFF_COMM assertions=$CAFF_ASSERT); self-tests battery=$NEG1 lpm=$NEG2 nocaff=$NEG3"
if [ "$NEG1$NEG2$NEG3" != truetruetrue ]; then fail "P9 enforcement self-test failed"; fi
if [ "$P9_ENFORCED" = true ] && [ "$P9_ACTUAL" != true ]; then
  fail "P9 host conditions not met (power '$PSRC', Low Power Mode '$LPM', caffeinate ok=$CAFF_OK)"
fi

: > "$E/docker-desktop-settings-$SESSION_ID.txt"
for DDS in "$HOME/Library/Group Containers/group.com.docker/settings-store.json" "$HOME/Library/Group Containers/group.com.docker/settings.json"; do
  if [ -f "$DDS" ]; then
    { echo "# file: $(basename "$DDS")"; echo "# key names:"
      plutil -p "$DDS" 2>/dev/null | sed -n 's/^  "\([^"]*\)" => .*/\1/p' | tr '\n' ' '; echo
      echo "# resource/VM/update values:"
      plutil -p "$DDS" 2>/dev/null | grep -Ei '^  "[^"]*(cpu|memory|swap|disk|virtuali|rosetta|virtiofs|saver|pause|vmm|qemu|krun|grpcfuse|kernel|snapshotter|update)[^"]*" => '
    } >> "$E/docker-desktop-settings-$SESSION_ID.txt"
  fi
done
CONF_MEM_MIB=$(sed -n 's/^  "MemoryMiB" => \([0-9]*\)$/\1/p' "$E/docker-desktop-settings-$SESSION_ID.txt" | head -1)
{ echo "== docker desktop version"; docker desktop version 2>&1; echo "== docker desktop status"; docker desktop status 2>&1
  echo "== docker desktop update --help"; docker desktop update --help 2>&1; } > "$E/docker-desktop-cli-$SESSION_ID.txt" 2>&1
docker version --format '{{json .}}' > "$E/docker-version-$SESSION_ID.json" 2>&1
docker info --format '{{json .}}' > "$E/docker-info-$SESSION_ID.json" 2>&1 || fail "docker daemon not reachable"
NCPU=$(docker info --format '{{.NCPU}}')
MEMB=$(docker info --format '{{.MemTotal}}')
DARCH=$(docker info --format '{{.Architecture}}')
KERNEL=$(docker info --format '{{.KernelVersion}}')
ENGINE=$(docker version --format '{{.Server.Version}}')
echo "docker: desktop=$DDV engine=$ENGINE ncpu=$NCPU mem_bytes=$MEMB configured_memory_mib=${CONF_MEM_MIB:-not-exposed} arch=$DARCH cgroup=v$(docker info --format '{{.CgroupVersion}}') kernel=$KERNEL"
session_event start "$([ "$MODE" = resume ] && echo resume || echo new)"
awk -v n="$NCPU" -v m="$MEMB" -v mn="$MIN_NCPU" -v mm="$MIN_MEM_GIB" 'BEGIN{exit !(n>=mn && m/1073741824>=mm)}' \
  || fail "Docker VM has $NCPU vCPUs / $(awk -v m="$MEMB" 'BEGIN{printf "%.2f", m/1073741824}') GiB; need >= $MIN_NCPU vCPUs and >= $MIN_MEM_GIB GiB visible (12 GiB configured)"
[ "$DARCH" = "$EXPECT_DOCKER_ARCH" ] || fail "Docker VM architecture $DARCH, expected $EXPECT_DOCKER_ARCH"
if grep -Eiq '"UseResourceSaver" => (1|true)' "$E/docker-desktop-settings-$SESSION_ID.txt"; then fail "Docker Desktop Resource Saver is enabled"; fi
RUNNING=$(docker ps -q | wc -l | tr -d ' ')
[ "$RUNNING" = 0 ] || fail "$RUNNING other container(s) running; stop them first"

# ------------------------------------------------------------------ 2. repository state (before)
git_status() { # writes the porcelain status of the repository, excluding this campaign's own directory
  if [ -n "$OUT_REL" ]; then git -C "$REPO" status --porcelain=v1 --untracked-files=all -- . ":(exclude)$OUT_REL"
  else git -C "$REPO" status --porcelain=v1 --untracked-files=all; fi
}
( cd "$REPO" && shasum -a 256 -c ARTIFACTS.sha256 > "$E/manifest-before-$SESSION_ID.txt" 2>&1 ); MAN_BEFORE=$?
GIT_HEAD_BEFORE=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo none)
git_status > "$E/git-status-before-$SESSION_ID.txt" 2>/dev/null
GIT_STATUS_SHA=$(sha "$E/git-status-before-$SESSION_ID.txt")
GIT_DIRTY=$([ -s "$E/git-status-before-$SESSION_ID.txt" ] && echo true || echo false)
# Uncommitted state of the paths the measurements depend on (kit, input generator, circuits,
# contracts, tests, manifest). Compared across sessions; the whole-tree status is compared within a session.
( cd "$REPO" && git status --porcelain=v1 --untracked-files=all -- $CAMPAIGN_PATHS ) > "$E/git-status-campaign-paths-$SESSION_ID.txt" 2>/dev/null
CPATHS_STATUS_SHA=$(sha "$E/git-status-campaign-paths-$SESSION_ID.txt")
PATHS_DIRTY=$(wc -l < "$E/git-status-campaign-paths-$SESSION_ID.txt" | tr -d ' ')
echo "manifest before: $(grep -c ': OK$' "$E/manifest-before-$SESSION_ID.txt") OK, exit $MAN_BEFORE; git HEAD $GIT_HEAD_BEFORE dirty=$GIT_DIRTY; uncommitted campaign paths: $PATHS_DIRTY"
[ "$MAN_BEFORE" = 0 ] || fail "ARTIFACTS.sha256 check failed before the run"
if [ "$CMODE" = campaign ] && [ "$PATHS_DIRTY" != 0 ]; then fail "campaign paths ($CAMPAIGN_PATHS) have uncommitted changes"; fi

integrity_after() {
  ( cd "$REPO" && shasum -a 256 -c ARTIFACTS.sha256 > "$E/manifest-after-$SESSION_ID.txt" 2>&1 ); local man_after=$?
  git_status > "$E/git-status-after-$SESSION_ID.txt" 2>/dev/null
  local head_after; head_after=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo none)
  local same=false; cmp -s "$E/git-status-before-$SESSION_ID.txt" "$E/git-status-after-$SESSION_ID.txt" && same=true
  local hsame=false; [ "$GIT_HEAD_BEFORE" = "$head_after" ] && hsame=true
  printf '{\n  "session_id": "%s",\n  "manifest_before_ok": %s,\n  "manifest_after_ok": %s,\n  "manifest_entries_ok_after": %s,\n  "git_head_before": "%s",\n  "git_head_after": "%s",\n  "git_head_unchanged": %s,\n  "git_status_unchanged": %s,\n  "git_status_sha256_before": "%s"\n}\n' \
    "$SESSION_ID" "$([ "$MAN_BEFORE" = 0 ] && echo true || echo false)" "$([ "$man_after" = 0 ] && echo true || echo false)" \
    "$(grep -c ': OK$' "$E/manifest-after-$SESSION_ID.txt")" "$GIT_HEAD_BEFORE" "$head_after" "$hsame" "$same" "$GIT_STATUS_SHA" > "$E/integrity-$SESSION_ID.json"
  cp "$E/integrity-$SESSION_ID.json" "$E/integrity.json"
  cat "$E/integrity-$SESSION_ID.json"
}

# ------------------------------------------------------------------ 3. image and campaign identity
if [ "$MODE" = resume ]; then
  IMAGE_ID="$(jget built_image_id)"
  RTAG="zcorp-bench:$CAMPAIGN_ID"
  MISMATCH=""
  chk() { [ "$2" = "$3" ] || MISMATCH="$MISMATCH; $1 (recorded '$2', now '$3')"; }
  chk "protocol version" "$(jget protocol_version)" "$PROTOCOL_VERSION"
  chk "git commit" "$(jget commit)" "$GIT_HEAD_BEFORE"
  chk "uncommitted state of the campaign paths" "$(jget campaign_paths_status_sha256)" "$CPATHS_STATUS_SHA"
  chk "artifact manifest" "$(jget manifest_sha256)" "$(sha "$REPO/ARTIFACTS.sha256")"
  chk "adapter" "$(jget adapter_sha256)" "$(sha "$KIT/lib/cpu-visibility.js")"
  chk "runner" "$(jget 'bench\/run-campaign.sh')" "$(sha "$KIT/run-campaign.sh")"
  chk "compose file" "$(jget 'bench\/compose.yaml')" "$(sha "$KIT/compose.yaml")"
  chk "Dockerfile" "$(jget 'bench\/Dockerfile')" "$(sha "$KIT/Dockerfile")"
  chk "benchmark image" "$IMAGE_ID" "$(docker image inspect --format '{{.Id}}' "$RTAG" 2>/dev/null)"
  chk "Docker Desktop" "$(jget docker_desktop)" "$DDV"
  chk "Docker Engine" "$(jget engine)" "$ENGINE"
  chk "LinuxKit kernel" "$(jget kernel)" "$KERNEL"
  chk "VM vCPUs" "$(jget vm_ncpu)" "$NCPU"
  chk "VM memory" "$(jget vm_mem_bytes)" "$MEMB"
  if [ -n "$MISMATCH" ]; then fail "REFUSE resume: campaign identity differs${MISMATCH}"; fi
  echo "resume identity: campaign, commit, campaign-path state, manifest, adapter, runner, compose, Dockerfile, image, Docker environment all match the campaign record"
  IMAGE_REF="$RTAG"
  export ZCORP_IMAGE="$IMAGE_REF" ZCORP_IMAGE_ID="$IMAGE_ID" ZCORP_REPO="$REPO" ZCORP_RESULTS="$OUT" ZCORP_PLATFORM="$PLATFORM" ZCORP_SESSION_ID="$SESSION_ID"
else
  docker build --platform "$PLATFORM" -f "${ZCORP_DOCKERFILE:-$KIT/Dockerfile}" -t "$IMAGE_TAG" "$KIT" > "$E/docker-build-$SESSION_ID.log" 2>&1 || fail "image build failed"
  IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$IMAGE_TAG")
  IMAGE_REF="zcorp-bench:$CAMPAIGN_ID"
  docker tag "$IMAGE_ID" "$IMAGE_REF" || fail "could not tag the campaign image"
  IMAGE_PLATFORM=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$IMAGE_ID")
  docker buildx imagetools inspect --raw "$BASE_REF" > "$E/base-image-index.json" 2>/dev/null || echo '{}' > "$E/base-image-index.json"
  echo "image $IMAGE_REF id=$IMAGE_ID platform=$IMAGE_PLATFORM"
  export ZCORP_IMAGE="$IMAGE_REF" ZCORP_IMAGE_ID="$IMAGE_ID" ZCORP_REPO="$REPO" ZCORP_RESULTS="$OUT" ZCORP_PLATFORM="$PLATFORM" ZCORP_SESSION_ID="$SESSION_ID"
  $COMPOSE run --rm -T \
    -e ZCORP_PROFILES="$PROFILES" \
    -e ZCORP_EXPECT_ARCH="${ZCORP_EXPECT_ARCH:-arm64}" -e ZCORP_EXPECT_MACHINE="${ZCORP_EXPECT_MACHINE:-aarch64}" \
    -e ZCORP_EXPECT_CPU_IMPLEMENTER="${ZCORP_EXPECT_CPU_IMPLEMENTER-0x61}" -e ZCORP_EXPECT_CGROUP="${ZCORP_EXPECT_CGROUP:-2}" \
    -e ZCORP_META_GIT_COMMIT="$GIT_HEAD_BEFORE" -e ZCORP_META_GIT_DIRTY="$GIT_DIRTY" -e ZCORP_META_GIT_STATUS_SHA256="$GIT_STATUS_SHA" \
    -e ZCORP_META_CAMPAIGN_PATHS="$CAMPAIGN_PATHS" -e ZCORP_META_CAMPAIGN_PATHS_STATUS_SHA256="$CPATHS_STATUS_SHA" \
    -e ZCORP_META_IMAGE_ID="$IMAGE_ID" -e ZCORP_META_IMAGE_TAG="$IMAGE_REF" -e ZCORP_META_BASE_IMAGE_REF="$BASE_REF" \
    -e ZCORP_META_PLATFORM="$IMAGE_PLATFORM" \
    -e ZCORP_META_DOCKER_DESKTOP="$DDV" -e ZCORP_META_ENGINE="$ENGINE" -e ZCORP_META_KERNEL="$KERNEL" \
    -e ZCORP_META_VM_NCPU="$NCPU" -e ZCORP_META_VM_MEM_BYTES="$MEMB" -e ZCORP_META_CONFIGURED_MEMORY_MIB="$CONF_MEM_MIB" \
    -e ZCORP_META_RUNNER_SHA256="$(sha "$KIT/run-campaign.sh")" -e ZCORP_META_COMPOSE_SHA256="$(sha "$KIT/compose.yaml")" \
    -e ZCORP_META_DOCKERFILE_SHA256="$(sha "$KIT/Dockerfile")" \
    ${ZCORP_P7_DEPTHS:+-e ZCORP_P7_DEPTHS="$ZCORP_P7_DEPTHS"} \
    tools node /opt/zcorp/make_schedule.js --campaign-id "$CAMPAIGN_ID" --mode "$CMODE" --plan "$PLAN" </dev/null \
    || fail "campaign initialisation failed"
  $COMPOSE run --rm -T tools node /opt/zcorp/provenance.js </dev/null || fail "P7 provenance failed (see provenance/p7.json)"
fi

# ------------------------------------------------------------------ 4. container pre-flight and adapter controls (every session)
for spec in $(echo "$PROFILES" | tr ',' ' '); do
  pid=${spec%%:*}
  $COMPOSE run --rm -T "$pid" node /opt/zcorp/preflight.js </dev/null || fail "container pre-flight failed for $pid"
done
P="$E/preflight/$SESSION_ID"
CTRL_CPUSET="${ZCORP_CONTROL_CPUSET:-1-2}"
CTRL_N="${ZCORP_CONTROL_SIZE:-2}"
echo "size $CTRL_N" > "$P/controls-exit.txt"
docker run --rm --platform "$PLATFORM" --network none --cpuset-cpus="$CTRL_CPUSET" --memory=8g --memory-swap=8g \
  -e ZCORP_CPUS="$CTRL_N" -e ZCORP_PROFILE=control -e NODE_OPTIONS="--max-old-space-size=4096" \
  -v "$REPO":/work:ro "$IMAGE_ID" node /opt/zcorp/preflight.js --probe </dev/null > "$P/control-no-adapter.out" 2> "$P/control-no-adapter.err"
echo "no-adapter $?" >> "$P/controls-exit.txt"
docker run --rm --platform "$PLATFORM" --network none --cpuset-cpus="$CTRL_CPUSET" --memory=8g --memory-swap=8g \
  -e ZCORP_CPUS="$((CTRL_N * 2))" -e ZCORP_PROFILE=control -v "$REPO":/work:ro "$IMAGE_ID" node /opt/zcorp/preflight.js --probe </dev/null \
  > "$P/control-mismatch.out" 2> "$P/control-mismatch.err"
echo "mismatch $?" >> "$P/controls-exit.txt"
docker run --rm --platform "$PLATFORM" --network none --cpus="$CTRL_N" --memory=8g --memory-swap=8g \
  -e ZCORP_CPUS="$CTRL_N" -e ZCORP_PROFILE=control -v "$REPO":/work:ro "$IMAGE_ID" node /opt/zcorp/preflight.js --probe </dev/null \
  > "$P/control-quota-only.out" 2> "$P/control-quota-only.err"
echo "quota-only $?" >> "$P/controls-exit.txt"
$COMPOSE run --rm -T tools node /opt/zcorp/record_controls.js </dev/null || fail "adapter controls did not behave as expected"

if [ "$MODE" = preflight ]; then
  integrity_after
  echo "result: PREFLIGHT PASS (no rounds run; session $SESSION_ID)" | tee "$E/RESULT-$SESSION_ID.txt"; cp "$E/RESULT-$SESSION_ID.txt" "$E/RESULT.txt"
  session_event end "PREFLIGHT PASS"
  exit 0
fi

# ------------------------------------------------------------------ 5. resume bookkeeping and round units
$COMPOSE run --rm -T tools node /opt/zcorp/campaign_state.js --session "$SESSION_ID" </dev/null || fail "REFUSE: campaign state check failed"
UNITS="$OUT/prover/sessions/$SESSION_ID/units.csv"

sample() { # seq kind round attempt profile phase
  local la ps lpm th f="$OUT/prover/host_samples.csv"
  la=$(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' | sed 's/^ *//;s/ *$//')
  ps=$(pmset -g batt 2>/dev/null | head -1 | sed "s/.*'\(.*\)'.*/\1/")
  lpm=$(pmset -g 2>/dev/null | awk '/lowpowermode/{print $2}')
  th=$(pmset -g therm 2>/dev/null | tr '\n' ' ' | sed 's/"//g;s/  */ /g')
  [ -f "$f" ] || echo "campaign_id,session_id,seq,kind,round,round_attempt,profile_id,phase,utc,loadavg,power_source,low_power_mode,pmset_therm" > "$f"
  echo "$CAMPAIGN_ID,$SESSION_ID,$1,$2,$3,$4,$5,$6,$(date -u +%Y-%m-%dT%H:%M:%SZ),\"$la\",\"$ps\",$lpm,\"$th\"" >> "$f"
}

ACCEPTED=0; CONTAINERS=0; STOPPED=0
exec 3< <(tail -n +2 "$UNITS")
while IFS=, read -r kind round attempt profiles <&3; do
  if [ -n "${ZCORP_STOP_AFTER_ROUNDS:-}" ] && [ "$ACCEPTED" -ge "$ZCORP_STOP_AFTER_ROUNDS" ]; then STOPPED=1; break; fi
  echo "== round unit: $kind round $round attempt $attempt ($profiles)"
  for pid in $(echo "$profiles" | tr ';' ' '); do
    CONTAINERS=$((CONTAINERS + 1))
    echo "== [$CONTAINERS] $kind round $round attempt $attempt: $pid"
    if [ "$P9_ENFORCED" = true ]; then
      NOWPS=$(pmset -g batt 2>/dev/null | head -1 | sed "s/.*'\(.*\)'.*/\1/"); NOWLPM=$(pmset -g 2>/dev/null | awk '/lowpowermode/{print $2}')
      NOWC=0; caff_alive && NOWC=1
      p9_ok "$NOWPS" "$NOWLPM" "$NOWC" || fail "P9 host conditions lost before container $CONTAINERS (power '$NOWPS', Low Power Mode '$NOWLPM', caffeinate alive=$NOWC); $kind round $round attempt $attempt stays without outcome and is rerun whole on resume"
    fi
    sample "$CONTAINERS" "$kind" "$round" "$attempt" "$pid" before
    $COMPOSE run --rm -T "$pid" node --expose-gc /opt/zcorp/harness.js --kind "$kind" --round "$round" --attempt "$attempt" </dev/null
    rc=$?
    sample "$CONTAINERS" "$kind" "$round" "$attempt" "$pid" after
    if [ $rc -ne 0 ]; then
      $COMPOSE run --rm -T tools node /opt/zcorp/validate_round.js --kind "$kind" --round "$round" --attempt "$attempt" </dev/null
      fail "container for $pid exited $rc; $kind round $round attempt $attempt recorded as failed (rerun as a new attempt on resume)"
    fi
    if [ -n "${ZCORP_TEST_INTERRUPT_AFTER_CONTAINERS:-}" ] && [ "$CONTAINERS" -ge "$ZCORP_TEST_INTERRUPT_AFTER_CONTAINERS" ]; then
      echo "SIMULATED INTERRUPTION (dry-run test) after $CONTAINERS container(s), inside $kind round $round attempt $attempt"
      echo "result: INTERRUPTED (simulated, session $SESSION_ID)" > "$E/RESULT-$SESSION_ID.txt"; cp "$E/RESULT-$SESSION_ID.txt" "$E/RESULT.txt"
      exit 3
    fi
  done
  $COMPOSE run --rm -T tools node /opt/zcorp/validate_round.js --kind "$kind" --round "$round" --attempt "$attempt" </dev/null \
    || fail "$kind round $round attempt $attempt failed round validation (rerun as a new attempt on resume)"
  ACCEPTED=$((ACCEPTED + 1))
done
exec 3<&-

# ------------------------------------------------------------------ 6. integrity (after) and summary
integrity_after
REMAINING=$(( $(tail -n +2 "$UNITS" | wc -l) - ACCEPTED ))
if [ "$STOPPED" = 1 ] || [ "$REMAINING" -gt 0 ]; then
  $COMPOSE run --rm -T tools node /opt/zcorp/summarize_prover.js --allow-partial </dev/null; SUMRC=$?
  if [ $SUMRC -eq 0 ]; then
    echo "result: STOPPED after $ACCEPTED accepted round(s) this session; $REMAINING remaining; resume with: bash bench/run-campaign.sh resume $OUT" | tee "$E/RESULT-$SESSION_ID.txt"
    cp "$E/RESULT-$SESSION_ID.txt" "$E/RESULT.txt"; session_event end "STOPPED ($ACCEPTED accepted, $REMAINING remaining)"; exit 0
  fi
  fail "partial validation failed (see derived/validation.json)"
fi
$COMPOSE run --rm -T tools node /opt/zcorp/summarize_prover.js </dev/null; SUMRC=$?
if [ $SUMRC -eq 0 ]; then
  echo "result: PASS ($CMODE $CAMPAIGN_ID; session $SESSION_ID; see derived/validation.json)" | tee "$E/RESULT-$SESSION_ID.txt"
  cp "$E/RESULT-$SESSION_ID.txt" "$E/RESULT.txt"; session_event end "PASS"
else
  fail "validation (see derived/validation.json)"
fi
