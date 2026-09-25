#!/usr/bin/env bash
# chainbench: local L1 (EVM) experiment runner. The only prerequisite is Docker.
#
#   ./chainbench/run.sh build-image     build the pinned toolchain image (needs network access once)
#   ./chainbench/run.sh doctor          check Docker, resources, image, inputs, sources, outputs; runs no experiment
#   ./chainbench/run.sh smoke           short packaging test (under a minute; not scientific data)
#   ./chainbench/run.sh full-local-l1   the frozen scientific procedure (unit tests, two EDR runs, geth replay, comparisons)
#
#   ./chainbench/run.sh dry-run         reduced engineering dry run (same procedure on a small subset)
#   ./chainbench/run.sh load-image F    load the archived image (docker save file) instead of building it
#   ./chainbench/run.sh save-image DIR  archive the image (and its geth image) with docker save; --frozen: record in docker/ARCHIVE.json
#   ./chainbench/run.sh author-freeze   author only: pin image digests, build, then author-verify
#   ./chainbench/run.sh author-verify   author only: doctor, smoke, dry-run vs the accepted run, freeze record (no rebuild)
#   ./chainbench/run.sh author-prefreeze DIR  author only: archive the frozen image, linux/amd64 portability (doctor, smoke), doctor, smoke
#   CHAINBENCH_PLATFORM=linux/amd64 ./chainbench/run.sh doctor|smoke   portability check on another platform (own image and state)
#
#   Local EraVM arm (L2; commands handled by adapters/eravm/run-l2.sh, see its header and CHAIN-PROTOCOL-v1 section 16):
#   ./chainbench/run.sh doctor-l2 | smoke-l2 | dry-run-l2 | full-local-l2   (also build-image-l2, save-image-l2, load-image-l2, author-l2)
#
# Everything measured runs inside the chainbench container with --network none; the repository is mounted read-only.
set -uo pipefail

CB_DIR=$(cd "$(dirname "$0")" && pwd -P)
REPO=$(cd "$CB_DIR/.." && pwd -P)
WORKLOAD=${CHAINBENCH_WORKLOAD:-zcorp}
PINS="$CB_DIR/docker/pins.env"
IMG_STATE="$REPO/build/chainbench/image"
LOCAL_TAG="chainbench-l1:local"
# CHAINBENCH_PLATFORM (linux/arm64 | linux/amd64): portability checks on a platform other than the engine's native one.
# The overridden platform gets its own image tag and state directory; the default (native) state is never touched.
PLATFORM_OVERRIDE=${CHAINBENCH_PLATFORM:-}
case "$PLATFORM_OVERRIDE" in
  "") ;;
  linux/arm64|linux/amd64) IMG_STATE="$REPO/build/chainbench/image-${PLATFORM_OVERRIDE#linux/}"; LOCAL_TAG="chainbench-l1:local-${PLATFORM_OVERRIDE#linux/}" ;;
  *) printf '[FAIL] CHAINBENCH_PLATFORM must be linux/arm64 or linux/amd64 (got %s)\n' "$PLATFORM_OVERRIDE" >&2; exit 1 ;;
esac
FAILS=0
IMAGE_ID="" BASE_IMAGE_PINNED="" GETH_SOURCE_DESC=""

say()  { printf '%s\n' "$*"; }
pass() { printf '[PASS] %s\n' "$*"; }
info() { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$1"; if [ -n "${2:-}" ]; then printf '       Fix: %s\n' "$2"; fi; FAILS=$((FAILS + 1)); }
die()  { printf '[FAIL] %s\n' "$1" >&2; if [ -n "${2:-}" ]; then printf '       Fix: %s\n' "$2" >&2; fi; exit 1; }
utc()  { date -u +%Y%m%dT%H%M%SZ; }
sha256_of() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; else sha256sum "$1" | awk '{print $1}'; fi; }
usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------- Docker helpers
have_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed (the 'docker' command was not found)." \
    "Install Docker Desktop (macOS/Windows) or Docker Engine (Linux): https://docs.docker.com/get-docker/ — then re-run."
  docker info >/dev/null 2>&1 || die "Docker is installed but its daemon is not running or not reachable." \
    "Start Docker Desktop (macOS/Windows) or the Docker service (Linux: sudo systemctl start docker), then re-run."
}
docker_arch() {
  if [ -n "$PLATFORM_OVERRIDE" ]; then echo "${PLATFORM_OVERRIDE#linux/}"; return; fi
  case "$(docker info --format '{{.Architecture}}' 2>/dev/null)" in
    aarch64|arm64) echo arm64 ;; x86_64|amd64) echo amd64 ;; *) echo unknown ;;
  esac
}
repo_digest() {  # repo digest (sha256:...) of a pulled image reference
  docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$1" 2>/dev/null | grep '@sha256:' | head -1 | sed 's/.*@//'
}
set_pin() {  # KEY VALUE: rewrite chainbench/docker/pins.env in place (portable; no sed -i)
  local tmp; tmp=$(mktemp)
  awk -v k="$1" -v v="$2" 'BEGIN{d=0} index($0, k"=")==1 {print k"=\""v"\""; d=1; next} {print} END{if(!d) print k"=\""v"\""}' "$PINS" >"$tmp" \
    && cat "$tmp" >"$PINS"
  rm -f "$tmp"
}
load_image() {
  have_docker
  [ -f "$IMG_STATE/image.env" ] || die "No chainbench image has been built on this machine yet." \
    "Run ./chainbench/run.sh build-image (needs network access once; about 5 minutes)."
  # shellcheck disable=SC1091
  . "$IMG_STATE/image.env"
  docker image inspect "$IMAGE_ID" >/dev/null 2>&1 || die "The recorded chainbench image ($IMAGE_ID) is no longer present in Docker." \
    "Run ./chainbench/run.sh build-image again."
}
image_present() {  # the image recorded in build/chainbench/image/image.env exists in Docker
  [ -f "$IMG_STATE/image.env" ] || return 1
  local id; id=$(sed -n 's/^IMAGE_ID="\(.*\)"$/\1/p' "$IMG_STATE/image.env")
  [ -n "$id" ] && docker image inspect "$id" >/dev/null 2>&1
}
json_get() {  # KEY FILE: value of a top-level "KEY": value line (records written by this script, one key per line)
  sed -n "s/^ *\"$1\": *\"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\} *\$/\1/p" "$2" | head -1
}
run_ok() {  # <host run dir>: the run finished and its own checks were accepted
  [ -f "$1/run.json" ] && grep -q '"accepted_checks": true' "$1/run.json"
}
run_line() {  # <run id> <log>: the runner's final summary line
  grep "\"run\":\"$1\"" "$2" | tail -1
}
host_json() {
  printf '{"os":"%s","os_version":"%s","arch":"%s","docker_server":"%s","docker_os":"%s","docker_cpus":"%s","docker_mem_bytes":"%s"}' \
    "$(uname -s)" "$(sw_vers -productVersion 2>/dev/null || uname -r)" "$(uname -m)" \
    "$(docker version --format '{{.Server.Version}}' 2>/dev/null)" "$(docker info --format '{{.OperatingSystem}}' 2>/dev/null | tr -d '"')" \
    "$(docker info --format '{{.NCPU}}' 2>/dev/null)" "$(docker info --format '{{.MemTotal}}' 2>/dev/null)"
}
# dkr [-e VAR=value ...] -- <in-container command ...>
# Runs one fresh container: repository read-only at /repo, the image's node_modules on an anonymous volume,
# a tmpfs work directory, writable output roots only, and no network.
dkr() {
  local envs=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do envs+=("$1"); shift; done
  [ "$#" -gt 0 ] && shift
  mkdir -p "$REPO/chainbench/node_modules" "$REPO/chainbench/.work" "$REPO/build/chainbench" "$REPO/build/campaigns/chain"
  local user=() plat=()
  if [ "$(uname -s)" = Linux ]; then user=(--user "$(id -u):$(id -g)"); fi
  if [ -n "$PLATFORM_OVERRIDE" ]; then plat=(--platform "$PLATFORM_OVERRIDE"); fi
  docker run --rm --network none ${user[@]+"${user[@]}"} ${plat[@]+"${plat[@]}"} \
    -e HOME=/tmp -e CHAINBENCH_WORKLOAD="$WORKLOAD" -e CHAINBENCH_NETWORK=none \
    -e CHAINBENCH_ALLOW_REBUILT_IMAGE="${CHAINBENCH_ALLOW_REBUILT_IMAGE:-}" \
    -e CHAINBENCH_IMAGE_ID="$IMAGE_ID" -e CHAINBENCH_IMAGE_REF="$LOCAL_TAG" \
    -e CHAINBENCH_BASE_IMAGE="$BASE_IMAGE_PINNED" -e CHAINBENCH_GETH_SOURCE="$GETH_SOURCE_DESC" \
    ${envs[@]+"${envs[@]}"} \
    --mount "type=bind,source=$REPO,target=/repo,readonly" \
    --mount "type=volume,target=/repo/chainbench/node_modules" \
    --mount "type=tmpfs,target=/repo/chainbench/.work,tmpfs-mode=1777" \
    --mount "type=bind,source=$REPO/build/chainbench,target=/repo/build/chainbench" \
    --mount "type=bind,source=$REPO/build/campaigns/chain,target=/repo/build/campaigns/chain" \
    -w /repo/chainbench "$IMAGE_ID" bash run/incontainer.sh "$@"
}

# ---------------------------------------------------------------- build-image
prep_from_source_geth() {  # arch dest: copy the verified from-source geth binary into the build context
  local bin want
  if [ "$1" = arm64 ]; then bin="$REPO/$GETH_FROM_SOURCE_BIN_ARM64"; want=$GETH_FROM_SOURCE_SHA256_ARM64
  else bin="$REPO/$GETH_FROM_SOURCE_BIN_AMD64"; want=$GETH_FROM_SOURCE_SHA256_AMD64; fi
  [ -f "$bin" ] || return 1
  [ "$(sha256_of "$bin")" = "$want" ] || return 2
  cp "$bin" "$2" && chmod 755 "$2"
}
docker_build() {  # arch base_ref geth_stage ctx metadata log
  if docker buildx version >/dev/null 2>&1; then
    docker buildx build --load --progress plain --metadata-file "$5" --platform "linux/$1" \
      --build-arg "BASE_IMAGE=$2" --build-arg "GETH_STAGE=$3" -t "$LOCAL_TAG" "$4" >>"$6" 2>&1
  else
    DOCKER_BUILDKIT=1 docker build --progress plain --platform "linux/$1" \
      --build-arg "BASE_IMAGE=$2" --build-arg "GETH_STAGE=$3" -t "$LOCAL_TAG" "$4" >>"$6" 2>&1
  fi
}
build_image() {
  local freeze=0; [ "${1:-}" = "--freeze" ] && freeze=1
  have_docker
  local arch; arch=$(docker_arch)
  [ "$arch" != unknown ] || die "Unsupported Docker engine architecture." "chainbench images are built for linux/arm64 or linux/amd64."
  mkdir -p "$IMG_STATE"
  local log; log="$IMG_STATE/build-$(utc).log"; : >"$log"
  # shellcheck disable=SC1090
  . "$PINS"
  say "chainbench build-image: platform linux/$arch (log: ${log#"$REPO"/})"

  # 1. Base image, pinned by digest.
  if [ -z "$BASE_IMAGE_DIGEST" ]; then
    [ "$freeze" = 1 ] || die "The base-image digest is not pinned in chainbench/docker/pins.env." \
      "Use the committed pins (git checkout -- chainbench/docker/pins.env); only the author pins new digests (author-freeze)."
    local t
    for t in $BASE_IMAGE_TAG_CANDIDATES; do
      if docker pull --platform "linux/$arch" "$BASE_IMAGE_REPO:$t" >>"$log" 2>&1; then BASE_IMAGE_TAG=$t; break; fi
    done
    [ -n "$BASE_IMAGE_TAG" ] || die "None of the base-image tags could be pulled ($BASE_IMAGE_TAG_CANDIDATES)." "Check network access to Docker Hub; details in $log"
    BASE_IMAGE_DIGEST=$(repo_digest "$BASE_IMAGE_REPO:$BASE_IMAGE_TAG")
    [ -n "$BASE_IMAGE_DIGEST" ] || die "Could not read the digest of $BASE_IMAGE_REPO:$BASE_IMAGE_TAG." "Details in $log"
    set_pin BASE_IMAGE_TAG "$BASE_IMAGE_TAG"; set_pin BASE_IMAGE_DIGEST "$BASE_IMAGE_DIGEST"
  fi
  local base_ref="$BASE_IMAGE_REPO@$BASE_IMAGE_DIGEST"
  docker pull --platform "linux/$arch" "$base_ref" >>"$log" 2>&1 || die "Cannot pull the pinned base image $base_ref." \
    "build-image needs network access to Docker Hub once; details in $log"
  pass "base image $BASE_IMAGE_REPO:$BASE_IMAGE_TAG pinned as $base_ref"

  # 2. geth: official image (digest-pinned, version-checked) or the reproducible from-source build.
  local geth_stage="geth-from-source" geth_desc="" gv
  if [ "$GETH_SOURCE" != "from-source" ]; then
    if [ -z "$GETH_IMAGE_DIGEST" ] && [ "$freeze" = 1 ]; then
      if docker pull --platform "linux/$arch" "$GETH_IMAGE_REPO:$GETH_IMAGE_TAG" >>"$log" 2>&1; then
        GETH_IMAGE_DIGEST=$(repo_digest "$GETH_IMAGE_REPO:$GETH_IMAGE_TAG")
      fi
    fi
    if [ -n "$GETH_IMAGE_DIGEST" ]; then
      local gref="$GETH_IMAGE_REPO@$GETH_IMAGE_DIGEST"
      if docker pull --platform "linux/$arch" "$gref" >>"$log" 2>&1 \
         && gv=$(docker run --rm --network none --platform "linux/$arch" --entrypoint geth "$gref" version 2>>"$log") \
         && printf '%s\n' "$gv" | tee -a "$log" | grep -q "Git Commit: $GETH_COMMIT"; then
        geth_stage="$gref"; geth_desc="official:$gref"
        pass "official geth image $GETH_IMAGE_REPO:$GETH_IMAGE_TAG pinned as $gref (Git Commit $GETH_COMMIT)"
      else
        warn "official geth image $gref could not be verified as $GETH_VERSION ($GETH_COMMIT); see $log"
      fi
    else
      warn "official geth image $GETH_IMAGE_REPO:$GETH_IMAGE_TAG is not available here"
    fi
  fi
  local ctx; ctx=$(mktemp -d)
  cp "$CB_DIR/package.json" "$CB_DIR/package-lock.json" "$CB_DIR/docker/Dockerfile" "$ctx/"
  mkdir "$ctx/geth-from-source"
  use_from_source() {
    local rc=0; prep_from_source_geth "$arch" "$ctx/geth-from-source/geth" || rc=$?
    [ "$rc" = 0 ] || die "No verifiable geth v1.16.9 binary for linux/$arch (official image unavailable; from-source binary missing or wrong sha256)." \
      "Allow Docker Hub access for the official ethereum/client-go image, or build geth with chainbench/geth/build_geth.sh and place it as described in chainbench/docker/pins.env."
    geth_stage="geth-from-source"; geth_desc="from-source:$(sha256_of "$ctx/geth-from-source/geth")"
    info "using the reproducible from-source geth build ($geth_desc)"
  }
  [ "$geth_stage" = geth-from-source ] && use_from_source

  # 3. Build.
  local meta="$IMG_STATE/build-metadata.json"; rm -f "$meta"
  say "building the image (npm ci from chainbench/package-lock.json; a few minutes the first time) ..."
  if ! docker_build "$arch" "$base_ref" "$geth_stage" "$ctx" "$meta" "$log"; then
    if [ "$geth_stage" != geth-from-source ]; then
      warn "image build with the official geth binary failed; retrying with the from-source geth (see $log)"
      use_from_source
      docker_build "$arch" "$base_ref" "$geth_stage" "$ctx" "$meta" "$log" || die "Image build failed." "Details in $log"
    else
      die "Image build failed." "Details in $log"
    fi
  fi
  rm -rf "$ctx"
  IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$LOCAL_TAG")
  BASE_IMAGE_PINNED=$base_ref; GETH_SOURCE_DESC=$geth_desc
  {
    printf 'IMAGE_ID="%s"\n' "$IMAGE_ID"; printf 'BASE_IMAGE_PINNED="%s"\n' "$base_ref"
    printf 'GETH_SOURCE_DESC="%s"\n' "$geth_desc"; printf 'ARCH="%s"\n' "$arch"; printf 'BUILT_AT="%s"\n' "$(utc)"
  } >"$IMG_STATE/image.env"
  pass "image built: $LOCAL_TAG = $IMAGE_ID"

  # 4. Record the toolchain identity (inside the new image, no network) and compare with the accepted toolchain.
  dkr -e "CHAINBENCH_BUILD_METADATA=/repo/build/chainbench/${IMG_STATE##*/}/build-metadata.json" -e "CHAINBENCH_HOST_JSON=$(host_json)" \
    -- identity --out "/repo/build/chainbench/${IMG_STATE##*/}/identity.json" >>"$log" 2>&1 \
    || die "Could not record the toolchain identity of the new image." "Details in $log"
  pass "toolchain identity recorded: ${IMG_STATE#"$REPO"/}/identity.json"
  if dkr -- identity --compare docker/ACCEPTED-TOOLCHAIN.json >"$IMG_STATE/accepted-compare.txt" 2>&1; then
    pass "toolchain matches the accepted readiness toolchain ($(grep -c '^\[PASS\]' "$IMG_STATE/accepted-compare.txt") fields; warn-only: $(grep -c '^\[WARN\]' "$IMG_STATE/accepted-compare.txt"))"
  else
    cat "$IMG_STATE/accepted-compare.txt"
    if [ "$arch" = arm64 ]; then die "The image toolchain differs from the accepted readiness toolchain." "Do not change chainbench/package-lock.json; rebuild from the committed pins."; fi
    warn "architecture $arch differs from the reference (arm64): architecture-specific binaries differ (see above)"
  fi
  if [ "$freeze" = 1 ]; then
    case "$geth_desc" in
      official:*) set_pin GETH_SOURCE official; set_pin GETH_IMAGE_DIGEST "$GETH_IMAGE_DIGEST" ;;
      *) set_pin GETH_SOURCE from-source ;;
    esac
    cp "$IMG_STATE/identity.json" "$CB_DIR/docker/IMAGE.json"
    pass "reference image record written: chainbench/docker/IMAGE.json (commit it together with chainbench/docker/pins.env)"
  fi
}

# ---------------------------------------------------------------- doctor
doctor() {
  FAILS=0
  say "chainbench doctor: checks only, no experiment is run."
  command -v docker >/dev/null 2>&1 || { fail "Docker is installed" "Install Docker Desktop (macOS/Windows) or Docker Engine (Linux): https://docs.docker.com/get-docker/"; say "DOCTOR: cannot continue without Docker."; return 1; }
  docker info >/dev/null 2>&1 || { fail "Docker daemon is reachable" "Start Docker Desktop (or the Docker service on Linux) and re-run."; say "DOCTOR: cannot continue without a running Docker daemon."; return 1; }
  pass "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) is running ($(docker info --format '{{.OperatingSystem}}' 2>/dev/null))"
  local arch; arch=$(docker_arch)
  case "$arch" in
    arm64) pass "architecture linux/arm64 (same as the reference measurements)" ;;
    amd64) warn "architecture linux/amd64: the reference measurements were made on arm64; gas values must still be identical (smoke checks this)" ;;
    *) fail "supported architecture" "Use a linux/arm64 or linux/amd64 Docker engine." ;;
  esac
  local cpus mem
  cpus=$(docker info --format '{{.NCPU}}' 2>/dev/null); mem=$(docker info --format '{{.MemTotal}}' 2>/dev/null)
  if [ "${mem:-0}" -lt 2147483648 ]; then fail "Docker memory ${mem:-?} bytes" "Give Docker at least 4 GiB of memory (Docker Desktop > Settings > Resources)."
  elif [ "${mem:-0}" -lt 4294967296 ] || [ "${cpus:-0}" -lt 2 ]; then warn "Docker resources are low (${cpus} CPUs, $((mem / 1073741824)) GiB); 2+ CPUs and 4+ GiB recommended"
  else pass "Docker resources: ${cpus} CPUs, $((mem / 1073741824)) GiB memory"; fi
  local avail; avail=$(df -Pk "$REPO" | awk 'NR==2 {print $4}')
  if [ "${avail:-0}" -lt 2097152 ]; then fail "free disk space $((avail / 1048576)) GiB" "Free at least 2 GiB (the image needs about 1 GiB; a full run writes a few MB)."
  elif [ "${avail:-0}" -lt 5242880 ]; then warn "free disk space $((avail / 1048576)) GiB (5 GiB recommended)"
  else pass "free disk space $((avail / 1048576)) GiB"; fi
  [ -e "$REPO/.git" ] && pass "repository clone with git metadata ($REPO)" \
    || fail "repository clone with git metadata" "Run chainbench from a git clone of the repository (a downloaded archive has no .git directory)."
  # shellcheck disable=SC1090
  . "$PINS"
  if [ -n "$BASE_IMAGE_DIGEST" ]; then pass "image pins present (base $BASE_IMAGE_REPO@${BASE_IMAGE_DIGEST:0:19}…, geth: ${GETH_SOURCE:-unset})"
  else warn "image pins not yet resolved in chainbench/docker/pins.env (the author pins them with author-freeze)"; fi
  local d
  for d in build/chainbench build/campaigns/chain; do
    if mkdir -p "$REPO/$d" 2>/dev/null && touch "$REPO/$d/.doctor-probe" 2>/dev/null; then rm -f "$REPO/$d/.doctor-probe"; pass "output location writable: $d"
    else fail "output location writable: $d" "Make $REPO/$d writable by your user."; fi
  done
  if [ "$FAILS" -gt 0 ]; then say "DOCTOR: $FAILS host check(s) failed; fix them and re-run (the image and in-container checks were skipped)."; return 1; fi
  if ! image_present; then
    info "the chainbench image is not built on this machine yet: building it now from the committed pins (first run only; needs network access once; about 5 minutes)"
    if ( build_image ); then :; else fail "chainbench image built" "See the message above; then re-run ./chainbench/run.sh doctor."; return 1; fi
  fi
  # shellcheck disable=SC1091
  . "$IMG_STATE/image.env"
  if docker image inspect "$IMAGE_ID" >/dev/null 2>&1; then pass "chainbench image present: $IMAGE_ID (geth ${GETH_SOURCE_DESC%%:*})"
  else fail "chainbench image present ($IMAGE_ID)" "Run ./chainbench/run.sh build-image again."; return 1; fi
  say "--- inside the chainbench container (no network):"
  dkr -- doctor "$@" || FAILS=$((FAILS + 1))
  [ "$FAILS" -eq 0 ]
}

# ---------------------------------------------------------------- smoke
smoke() {
  load_image
  local rid; rid="smoke-${PLATFORM_OVERRIDE:+${PLATFORM_OVERRIDE#linux/}-}$(utc)"
  local out=/repo/build/chainbench/smoke hout="$REPO/build/chainbench/smoke"
  mkdir -p "$hout"
  say "chainbench smoke: $rid (not scientific data; output ${hout#"$REPO"/}/$rid)"
  dkr -e "CHAINBENCH_OUT_ROOT=$out" -- run --plan smoke --env edr --run-id "$rid" >"$hout/$rid.log" 2>&1 && run_ok "$hout/$rid" \
    || { tail -20 "$hout/$rid.log"; die "The smoke run failed." "See ${hout#"$REPO"/}/$rid.log; then run ./chainbench/run.sh doctor."; }
  pass "contracts compiled and the smoke cells ran (Groth16 d5, PLONK d10; 1 proof; all negative controls)"
  dkr -- unit-tests >"$hout/$rid/unit_tests.log" 2>&1 \
    || { tail -20 "$hout/$rid/unit_tests.log"; die "Unit tests failed." "See ${hout#"$REPO"/}/$rid/unit_tests.log"; }
  pass "unit tests: $(grep -Eo '[0-9]+ passing' "$hout/$rid/unit_tests.log" | tail -1)"
  local ref; ref=$(dkr -- smoke-ref | tail -1)
  dkr -- smoke-check "$out/$rid" "$ref" --out "$out/$rid/smoke_check.json" || die "The smoke checks failed." \
    "The environment does not reproduce the accepted measurements; report ${hout#"$REPO"/}/$rid/smoke_check.json and do not run the full experiment."
  say "SMOKE PASS: outputs in ${hout#"$REPO"/}/$rid (not scientific data)"
}

# ---------------------------------------------------------------- shared multi-run procedure
# three_runs <plan> <run-id prefix> <out root in container> <host out root> <log>
three_runs() {
  local plan=$1 rid=$2 out=$3 hout=$4 log=$5 envs=()
  [ "$plan" = full ] || envs=(-e "CHAINBENCH_OUT_ROOT=$out")
  local r
  say "  unit tests (protocol section 12, step 4) ..."
  dkr -- unit-tests >"$hout/$rid.unit_tests.log" 2>&1 \
    || { tail -20 "$hout/$rid.unit_tests.log"; die "Unit tests failed; no run was started." "See ${hout#"$REPO"/}/$rid.unit_tests.log"; }
  pass "unit tests: $(grep -Eo '[0-9]+ passing' "$hout/$rid.unit_tests.log" | tail -1) (${hout#"$REPO"/}/$rid.unit_tests.log)"
  for r in a b; do
    say "  EDR run $r (fresh container, from scratch) ..."
    dkr ${envs[@]+"${envs[@]}"} -- run --plan "$plan" --env edr --run-id "$rid-edr-$r" >>"$log" 2>&1 && run_ok "$hout/$rid-edr-$r" \
      || die "EDR run $r failed or its checks were not accepted." "See ${log#"$REPO"/} and ${hout#"$REPO"/}/$rid-edr-$r/run.json"
    pass "EDR run $r: $(run_line "$rid-edr-$r" "$log")"
  done
  say "  geth cross-client replay (fresh container) ..."
  dkr ${envs[@]+"${envs[@]}"} -- run --plan "$plan" --env geth --run-id "$rid-geth" --reference "$out/$rid-edr-a" >>"$log" 2>&1 && run_ok "$hout/$rid-geth" \
    || die "geth replay failed or its checks were not accepted." "See ${log#"$REPO"/} and ${hout#"$REPO"/}/$rid-geth/run.json"
  pass "geth replay: $(run_line "$rid-geth" "$log")"
  dkr -- compare --mode determinism --a "$out/$rid-edr-a" --b "$out/$rid-edr-b" --out "$out/$rid-edr-b/compare_determinism.json" >>"$log" 2>&1 \
    && pass "determinism: EDR run a = run b on every scientific field" \
    || die "Determinism check failed: the two EDR runs differ." "Inspect ${hout#"$REPO"/}/$rid-edr-b/compare_determinism.json; do not use these runs."
  dkr -- compare --mode crossclient --a "$out/$rid-edr-a" --b "$out/$rid-geth" --out "$out/$rid-geth/compare_crossclient.json" >>"$log" 2>&1 \
    && pass "cross-client: geth = EDR on status, gas, revert reasons, return values, addresses, bytecode" \
    || die "Cross-client check failed: geth and EDR differ." "Inspect ${hout#"$REPO"/}/$rid-geth/compare_crossclient.json; the difference must be diagnosed, not normalised."
  dkr -- summarize "$out/$rid-edr-a" --out "$out/$rid-edr-a/summary.csv" >>"$log" 2>&1 && pass "per-cell summary: ${hout#"$REPO"/}/$rid-edr-a/summary.csv"
}

dry_run() {
  load_image
  local ref_edr="" ref_geth=""
  while [ "$#" -gt 0 ]; do case "$1" in
    --reference-edr) ref_edr=$2; shift 2 ;; --reference-geth) ref_geth=$2; shift 2 ;; *) die "unknown dry-run option $1" ;;
  esac; done
  local rid; rid="dry-$(dkr -- head | tail -1)-$(utc)"
  local out=/repo/build/chainbench/dry-run hout="$REPO/build/chainbench/dry-run"; mkdir -p "$hout"
  local log="$hout/$rid.log"; : >"$log"
  say "chainbench dry-run: $rid (engineering; not scientific data; output ${hout#"$REPO"/})"
  three_runs dry "$rid" "$out" "$hout" "$log"
  if [ -n "$ref_edr" ] && [ -d "$REPO/$ref_edr" ]; then
    dkr -- compare --mode determinism --a "/repo/$ref_edr" --b "$out/$rid-edr-a" --out "$out/$rid-edr-a/compare_vs_reference.json" >>"$log" 2>&1 \
      && pass "packaged EDR run = accepted reference ($ref_edr) on every scientific field" \
      || die "The packaged EDR run differs from the accepted reference $ref_edr." "Inspect ${hout#"$REPO"/}/$rid-edr-a/compare_vs_reference.json"
  elif [ -n "$ref_edr" ]; then warn "reference $ref_edr not present on this machine; comparison skipped"; fi
  if [ -n "$ref_geth" ] && [ -d "$REPO/$ref_geth" ]; then
    dkr -- compare --mode crossclient --a "/repo/$ref_geth" --b "$out/$rid-geth" --out "$out/$rid-geth/compare_vs_reference.json" >>"$log" 2>&1 \
      && pass "packaged geth replay = accepted geth reference ($ref_geth) on every client-independent field" \
      || die "The packaged geth replay differs from the accepted reference $ref_geth." "Inspect ${hout#"$REPO"/}/$rid-geth/compare_vs_reference.json"
  fi
  say "DRY-RUN PASS: $rid (outputs in ${hout#"$REPO"/}; not scientific data)"
  printf '%s\n' "$rid" >"$hout/LATEST"
}

full_local_l1() {
  load_image
  say "chainbench full-local-l1: the frozen scientific procedure (protocol $(dkr -- workload | grep -Eo '"protocol": *"[^"]+"' | head -1 | sed 's/.*: *"//; s/"$//'))"
  local rid; rid="full-$(dkr -- head | tail -1)-$(utc)"
  local out=/repo/build/campaigns/chain hout="$REPO/build/campaigns/chain"
  say "--- pre-flight (doctor, clean sources and baseline tag required; record ${hout#"$REPO"/}/$rid.preflight.json):"
  dkr -e "CHAINBENCH_HOST_JSON=$(host_json)" -- doctor --require-clean --require-baseline --require-archived-image --out "$out/$rid.preflight.json" \
    || die "Pre-flight checks failed; the scientific run was NOT started." "Fix the items above."
  local log="$hout/$rid.log"; : >"$log"
  say "running $rid (outputs in ${hout#"$REPO"/}) ..."
  three_runs full "$rid" "$out" "$hout" "$log"
  say "--- post-flight (same checks after the runs; record ${hout#"$REPO"/}/$rid.postflight.json):"
  dkr -e "CHAINBENCH_HOST_JSON=$(host_json)" -- doctor --require-clean --require-baseline --require-archived-image --skip-envcheck --out "$out/$rid.postflight.json" \
    || die "Post-flight checks failed: sources, baseline tag or image changed during the campaign." "Do not accept $rid; inspect ${hout#"$REPO"/}/$rid.postflight.json."
  say "FULL LOCAL L1 DONE: $rid-edr-a, $rid-edr-b, $rid-geth in ${hout#"$REPO"/}"
}

# ---------------------------------------------------------------- image archive (docker save / docker load)
save_image() {  # save-image <output dir> [--frozen]
  local out=${1:-} frozen=0
  [ "${2:-}" = --frozen ] && frozen=1
  [ -n "$out" ] || die "usage: ./chainbench/run.sh save-image <output dir> [--frozen]"
  load_image
  # shellcheck disable=SC1090
  . "$PINS"
  case "$out" in /*) ;; *) out="$REPO/$out" ;; esac
  mkdir -p "$out/image"
  local arch=$ARCH now
  now=$(docker image inspect --format '{{.Id}}' "$LOCAL_TAG" 2>/dev/null)
  [ "$now" = "$IMAGE_ID" ] || die "$LOCAL_TAG is '$now', not the recorded image $IMAGE_ID." "Rebuild or reload the image before archiving it."
  local f="$out/image/chainbench-l1-$arch.oci.tar" g="$out/image/geth-$GETH_VERSION-$arch.oci.tar" rec="$out/IMAGE-ARCHIVE.$arch.json"
  [ -e "$f" ] && die "$f already exists (archives are never overwritten)."
  say "docker save $LOCAL_TAG ($IMAGE_ID) -> ${f#"$REPO"/}"
  docker save -o "$f" "$LOCAL_TAG" || die "docker save failed for $LOCAL_TAG."
  tar -tf "$f" | LC_ALL=C sort >"${f%.oci.tar}.listing.txt"
  tar -xOf "$f" index.json >"${f%.oci.tar}.index.json"
  local has_idx=false; grep -qx "blobs/sha256/${IMAGE_ID#sha256:}" "${f%.oci.tar}.listing.txt" && has_idx=true
  local gref="" gsave=""
  case "$GETH_SOURCE_DESC" in official:*) gref=${GETH_SOURCE_DESC#official:} ;; esac
  if [ -n "$gref" ]; then
    [ -e "$g" ] && die "$g already exists (archives are never overwritten)."
    say "docker save --platform linux/$arch $gref -> ${g#"$REPO"/}"
    if docker save --platform "linux/$arch" -o "$g" "$gref" 2>/dev/null; then gsave=$gref
    elif [ "$(repo_digest "$GETH_IMAGE_REPO:$GETH_IMAGE_TAG")" = "${gref#*@}" ]; then
      rm -f "$g"; docker save --platform "linux/$arch" -o "$g" "$GETH_IMAGE_REPO:$GETH_IMAGE_TAG" || die "docker save failed for the geth image."
      gsave="$GETH_IMAGE_REPO:$GETH_IMAGE_TAG (= $gref)"
    else die "Cannot save the pinned geth image $gref." "docker pull --platform linux/$arch $gref, then re-run."; fi
    tar -tf "$g" | LC_ALL=C sort >"${g%.oci.tar}.listing.txt"
    tar -xOf "$g" index.json >"${g%.oci.tar}.index.json"
  fi
  {
    printf '{\n'
    printf '  "schema": "chainbench-image-archive/1",\n'
    printf '  "role": "%s",\n' "$([ "$frozen" = 1 ] && echo scientific || echo portability)"
    printf '  "platform": "linux/%s",\n' "$arch"
    printf '  "image_ref": "%s",\n' "$LOCAL_TAG"
    printf '  "image_id": "%s",\n' "$IMAGE_ID"
    printf '  "base_image": "%s",\n' "$BASE_IMAGE_PINNED"
    printf '  "geth_source": "%s",\n' "$GETH_SOURCE_DESC"
    printf '  "archive": "image/%s",\n' "$(basename "$f")"
    printf '  "archive_file": "%s",\n' "${f#"$REPO"/}"
    printf '  "archive_bytes": %s,\n' "$(wc -c <"$f" | tr -d ' ')"
    printf '  "archive_sha256": "%s",\n' "$(sha256_of "$f")"
    printf '  "archive_contains_image_index_blob": %s,\n' "$has_idx"
    printf '  "index_json_sha256": "%s",\n' "$(sha256_of "${f%.oci.tar}.index.json")"
    printf '  "geth_image_ref": "%s",\n' "$gref"
    printf '  "geth_saved_as": "%s",\n' "$gsave"
    if [ -n "$gref" ]; then
      printf '  "geth_archive": "image/%s",\n' "$(basename "$g")"
      printf '  "geth_archive_bytes": %s,\n' "$(wc -c <"$g" | tr -d ' ')"
      printf '  "geth_archive_sha256": "%s",\n' "$(sha256_of "$g")"
      printf '  "geth_index_json_sha256": "%s",\n' "$(sha256_of "${g%.oci.tar}.index.json")"
    fi
    printf '  "docker_client": "%s",\n' "$(docker version --format '{{.Client.Version}}' 2>/dev/null)"
    printf '  "docker_engine": "%s",\n' "$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
    printf '  "saved_utc": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "load_command": "./chainbench/run.sh load-image %s"\n' "${f#"$REPO"/}"
    printf '}\n'
  } >"$rec"
  [ "$has_idx" = true ] || die "The archive does not contain the image index blob ${IMAGE_ID}." "See ${f%.oci.tar}.listing.txt"
  pass "image archive: ${f#"$REPO"/} ($(json_get archive_bytes "$rec") bytes, sha256 $(json_get archive_sha256 "$rec"))"
  [ -n "$gref" ] && pass "geth archive: ${g#"$REPO"/} ($(json_get geth_archive_bytes "$rec") bytes, sha256 $(json_get geth_archive_sha256 "$rec"))"
  if [ "$frozen" = 1 ]; then
    cp "$rec" "$CB_DIR/docker/ARCHIVE.json"
    pass "frozen-image record written: chainbench/docker/ARCHIVE.json (full-local-l1 now requires this exact image on linux/$arch)"
  fi
  say "record: ${rec#"$REPO"/}"
}
load_image_archive() {  # load-image <archive.oci.tar> [<record.json>]
  have_docker
  local f=${1:-} rec=${2:-$CB_DIR/docker/ARCHIVE.json}
  [ -f "$f" ] || die "usage: ./chainbench/run.sh load-image <chainbench-l1-<arch>.oci.tar> [<IMAGE-ARCHIVE record>]"
  [ -f "$rec" ] || die "No archive record $rec." "Pass the IMAGE-ARCHIVE.<arch>.json that belongs to this archive as the second argument."
  local want_sha want_id plat sha
  want_sha=$(json_get archive_sha256 "$rec"); want_id=$(json_get image_id "$rec"); plat=$(json_get platform "$rec")
  say "verifying $(basename "$f") against ${rec#"$REPO"/} ..."
  sha=$(sha256_of "$f")
  [ "$sha" = "$want_sha" ] || die "Archive sha256 $sha does not match the record ($want_sha)." "Use the archive that belongs to ${rec#"$REPO"/}."
  pass "archive sha256 $sha"
  if [ "linux/$(docker_arch)" != "$plat" ]; then
    die "This archive is $plat but the target platform is linux/$(docker_arch)." "Run with CHAINBENCH_PLATFORM=$plat (emulation) or use the archive for your platform."
  fi
  docker load -i "$f" || die "docker load failed."
  docker image inspect "$want_id" >/dev/null 2>&1 || die "After loading, image $want_id is not present." "Check the archive and the record."
  mkdir -p "$IMG_STATE"
  {
    printf 'IMAGE_ID="%s"\n' "$want_id"; printf 'BASE_IMAGE_PINNED="%s"\n' "$(json_get base_image "$rec")"
    printf 'GETH_SOURCE_DESC="%s"\n' "$(json_get geth_source "$rec")"; printf 'ARCH="%s"\n' "${plat#linux/}"
    printf 'BUILT_AT="loaded %s sha256:%s at %s"\n' "$(basename "$f")" "$sha" "$(utc)"
  } >"$IMG_STATE/image.env"
  # shellcheck disable=SC1091
  . "$IMG_STATE/image.env"
  docker tag "$want_id" "$LOCAL_TAG" >/dev/null 2>&1 || true
  dkr -e "CHAINBENCH_HOST_JSON=$(host_json)" -- identity --out "/repo/build/chainbench/${IMG_STATE##*/}/identity.json" >/dev/null 2>&1 \
    || die "Could not record the toolchain identity of the loaded image."
  pass "image loaded: $want_id ($plat); next: ./chainbench/run.sh doctor"
}

author_prefreeze() {  # author only: archive the frozen image, linux/amd64 portability (doctor, smoke), then doctor and smoke
  local out=${1:-}
  [ -n "$out" ] || die "usage: ./chainbench/run.sh author-prefreeze <release dir>"
  [ -z "$PLATFORM_OVERRIDE" ] || die "author-prefreeze runs on the native platform (unset CHAINBENCH_PLATFORM)."
  load_image
  local sum; sum="$REPO/build/chainbench/prefreeze-$(utc).txt"; : >"$sum"
  note() { printf '%s\n' "$*" | tee -a "$sum"; }
  say "=== author-prefreeze: archive the frozen image, portability check, doctor, smoke ==="
  save_image "$out" --frozen
  note "frozen_archive: $(json_get archive_file "$CB_DIR/docker/ARCHIVE.json") sha256 $(json_get archive_sha256 "$CB_DIR/docker/ARCHIVE.json")"
  say "--- load-image round trip on the frozen archive:"
  if "$0" load-image "$REPO/$(json_get archive_file "$CB_DIR/docker/ARCHIVE.json")"; then note "load_image_native: PASS"; else note "load_image_native: FAIL"; fi
  local other=amd64; [ "$(docker_arch)" = amd64 ] && other=arm64
  say "--- portability: linux/$other (emulated; not scientific data)"
  if CHAINBENCH_PLATFORM="linux/$other" "$0" doctor; then note "portability_${other}_doctor: PASS"; else note "portability_${other}_doctor: FAIL"; fi
  if CHAINBENCH_PLATFORM="linux/$other" "$0" smoke; then note "portability_${other}_smoke: PASS"; else note "portability_${other}_smoke: FAIL"; fi
  if CHAINBENCH_PLATFORM="linux/$other" "$0" save-image "$out"; then note "portability_${other}_archive: PASS"; else note "portability_${other}_archive: FAIL"; fi
  say "--- native platform (linux/$(docker_arch)): doctor and smoke"
  if "$0" doctor; then note "native_doctor: PASS"; else note "native_doctor: FAIL"; fi
  if "$0" smoke; then note "native_smoke: PASS"; else note "native_smoke: FAIL"; fi
  say "AUTHOR-PREFREEZE finished; summary: ${sum#"$REPO"/}"
  cat "$sum"
}

author_freeze() {
  say "=== author-freeze: pin + build image, then author-verify ==="
  build_image --freeze
  author_verify
}
author_verify() {  # author only: doctor, smoke, packaged dry run vs the accepted readiness dry run, freeze record (no rebuild)
  say "=== author-verify: doctor, smoke, packaged dry run vs the accepted readiness dry run (existing image) ==="
  load_image
  doctor || die "author-verify stopped at doctor." "Fix the items above and re-run."
  smoke
  local ref_edr ref_geth
  ref_edr=$(dkr -- dry-ref edr | tail -1); ref_geth=$(dkr -- dry-ref geth | tail -1)
  dry_run --reference-edr "$ref_edr" --reference-geth "$ref_geth"
  local fz; fz="$REPO/build/chainbench/freeze/$(utc)"; mkdir -p "$fz"
  dkr -- sources >"$fz/SOURCES.sha256" 2>/dev/null
  cp "$IMG_STATE/image.env" "$IMG_STATE/identity.json" "$fz/" 2>/dev/null
  cp "$PINS" "$fz/pins.env"; cat "$REPO/build/chainbench/dry-run/LATEST" >"$fz/DRY_RUN_ID"
  say "AUTHOR-VERIFY PASS: records in ${fz#"$REPO"/}. Image records: chainbench/docker/pins.env, chainbench/docker/IMAGE.json (commit them if author-freeze changed them)."
}

# ---------------------------------------------------------------- main
cmd=${1:-help}; [ "$#" -gt 0 ] && shift
case "$cmd" in
  build-image)    build_image "$@" ;;
  doctor)         doctor "$@" ;;
  smoke)          smoke ;;
  dry-run)        dry_run "$@" ;;
  full-local-l1)  full_local_l1 ;;
  author-freeze)  author_freeze ;;
  author-verify)  author_verify ;;
  author-prefreeze) author_prefreeze "$@" ;;
  save-image)     save_image "$@" ;;
  load-image)     load_image_archive "$@" ;;
  build-image-l2|doctor-l2|smoke-l2|dry-run-l2|full-local-l2|save-image-l2|load-image-l2|author-l2)
                  exec "$CB_DIR/adapters/eravm/run-l2.sh" "$cmd" "$@" ;;
  help|-h|--help) usage ;;
  *) usage; die "unknown command '$cmd'" "Use one of: doctor, smoke, full-local-l1 (also build-image, dry-run); L2: doctor-l2, smoke-l2, full-local-l2." ;;
esac
