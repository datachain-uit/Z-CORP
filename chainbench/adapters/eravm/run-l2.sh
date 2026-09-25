#!/usr/bin/env bash
# chainbench local-EraVM (L2) runner. Called through ./chainbench/run.sh <command>; the only prerequisite is Docker.
#
#   ./chainbench/run.sh build-image-l2      build the pinned chainbench-l2 image (network access once: base image, release binaries, npm)
#   ./chainbench/run.sh doctor-l2           check Docker, resources, image, binaries, inputs, sources, a local EraVM node; runs no experiment
#   ./chainbench/run.sh smoke-l2            short packaging test (2 cells, 1 proof; under a minute; NOT scientific data)
#   ./chainbench/run.sh dry-run-l2          reduced engineering dry run, twice from scratch + validation + determinism (NOT scientific data)
#   ./chainbench/run.sh full-local-l2       the frozen scientific L2 procedure (needs the L2 baseline tag and the archived image)
#
#   ./chainbench/run.sh save-image-l2 DIR [--frozen]   archive the image with docker save (--frozen: record adapters/eravm/ARCHIVE.json)
#   ./chainbench/run.sh load-image-l2 FILE [RECORD]    load an archived image instead of building it
#   ./chainbench/run.sh author-l2 DIR       author only: build + identity record, doctor, smoke (+ reference), dry run x2, archive, amd64 portability
#   CHAINBENCH_PLATFORM=linux/amd64 ./chainbench/run.sh doctor-l2|smoke-l2   portability check on another platform (own image and state)
#
# Every measurement runs in a fresh chainbench-l2 container with --network none and the repository mounted read-only.
# Nothing here contacts a public network at run time, uses a private key, or spends test ETH (dev accounts on a local node).
set -uo pipefail

CB_DIR=$(cd "$(dirname "$0")/../.." && pwd -P)
REPO=$(cd "$CB_DIR/.." && pwd -P)
AD="$CB_DIR/adapters/eravm"
PINS="$AD/pins.env"
IMG_STATE="$REPO/build/chainbench/l2/image"
LOCAL_TAG="chainbench-l2:local"
SMOKE_REF="workloads/zcorp/smoke-reference-l2.csv"
PLATFORM_OVERRIDE=${CHAINBENCH_PLATFORM:-}
case "$PLATFORM_OVERRIDE" in
  "") ;;
  linux/arm64|linux/amd64) IMG_STATE="$REPO/build/chainbench/l2/image-${PLATFORM_OVERRIDE#linux/}"; LOCAL_TAG="chainbench-l2:local-${PLATFORM_OVERRIDE#linux/}" ;;
  *) printf '[FAIL] CHAINBENCH_PLATFORM must be linux/arm64 or linux/amd64 (got %s)\n' "$PLATFORM_OVERRIDE" >&2; exit 1 ;;
esac
FAILS=0
IMAGE_ID="" BASE_IMAGE_PINNED=""

say()  { printf '%s\n' "$*"; }
pass() { printf '[PASS] %s\n' "$*"; }
info() { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$1"; if [ -n "${2:-}" ]; then printf '       Fix: %s\n' "$2"; fi; FAILS=$((FAILS + 1)); }
die()  { printf '[FAIL] %s\n' "$1" >&2; if [ -n "${2:-}" ]; then printf '       Fix: %s\n' "$2" >&2; fi; exit 1; }
utc()  { date -u +%Y%m%dT%H%M%SZ; }
rel()  { printf '%s' "${1#"$REPO"/}"; }
sha256_of() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; else sha256sum "$1" | awk '{print $1}'; fi; }
usage() { sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; }

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
load_image() {
  have_docker
  [ -f "$IMG_STATE/image.env" ] || die "No chainbench-l2 image has been built on this machine yet." \
    "Run ./chainbench/run.sh build-image-l2 (needs network access once; a few minutes), or load-image-l2 an archived image."
  # shellcheck disable=SC1091
  . "$IMG_STATE/image.env"
  docker image inspect "$IMAGE_ID" >/dev/null 2>&1 || die "The recorded chainbench-l2 image ($IMAGE_ID) is no longer present in Docker." \
    "Run ./chainbench/run.sh build-image-l2 again (or load-image-l2 the archive)."
}
image_present() {
  [ -f "$IMG_STATE/image.env" ] || return 1
  local id; id=$(sed -n 's/^IMAGE_ID="\(.*\)"$/\1/p' "$IMG_STATE/image.env")
  [ -n "$id" ] && docker image inspect "$id" >/dev/null 2>&1
}
json_get() { sed -n "s/^ *\"$1\": *\"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\} *\$/\1/p" "$2" | head -1; }
run_ok() { [ -f "$1/run.json" ] && grep -q '"accepted_checks": true' "$1/run.json"; }
run_line() { grep "\"run\":\"$1\"" "$2" | tail -1; }
host_json() {
  printf '{"os":"%s","os_version":"%s","arch":"%s","docker_server":"%s","docker_os":"%s","docker_cpus":"%s","docker_mem_bytes":"%s"}' \
    "$(uname -s)" "$(sw_vers -productVersion 2>/dev/null || uname -r)" "$(uname -m)" \
    "$(docker version --format '{{.Server.Version}}' 2>/dev/null)" "$(docker info --format '{{.OperatingSystem}}' 2>/dev/null | tr -d '"')" \
    "$(docker info --format '{{.NCPU}}' 2>/dev/null)" "$(docker info --format '{{.MemTotal}}' 2>/dev/null)"
}
# dkr [-e VAR=value ...] -- <in-container command ...>: one fresh container; repository read-only at /repo, the image's
# node_modules on an anonymous volume, a tmpfs work directory, writable L2 output roots only, and no network.
dkr() {
  local envs=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do envs+=("$1"); shift; done
  [ "$#" -gt 0 ] && shift
  mkdir -p "$REPO/chainbench/node_modules" "$REPO/chainbench/.work" "$REPO/build/chainbench/l2" "$REPO/build/campaigns/chain-l2"
  local user=() plat=()
  if [ "$(uname -s)" = Linux ]; then user=(--user "$(id -u):$(id -g)"); fi
  if [ -n "$PLATFORM_OVERRIDE" ]; then plat=(--platform "$PLATFORM_OVERRIDE"); fi
  docker run --rm --network none ${user[@]+"${user[@]}"} ${plat[@]+"${plat[@]}"} \
    -e HOME=/tmp -e CHAINBENCH_NETWORK=none -e CHAINBENCH_IMAGE_ID="$IMAGE_ID" -e CHAINBENCH_IMAGE_REF="$LOCAL_TAG" \
    -e CHAINBENCH_BASE_IMAGE="$BASE_IMAGE_PINNED" ${envs[@]+"${envs[@]}"} \
    --mount "type=bind,source=$REPO,target=/repo,readonly" \
    --mount "type=volume,target=/repo/chainbench/node_modules" \
    --mount "type=tmpfs,target=/repo/chainbench/.work,tmpfs-mode=1777" \
    --mount "type=bind,source=$REPO/build/chainbench/l2,target=/repo/build/chainbench/l2" \
    --mount "type=bind,source=$REPO/build/campaigns/chain-l2,target=/repo/build/campaigns/chain-l2" \
    -w /repo/chainbench "$IMAGE_ID" bash adapters/eravm/incontainer.sh "$@"
}

# ---------------------------------------------------------------- build-image-l2
build_image() {
  local freeze=0; [ "${1:-}" = "--freeze" ] && freeze=1
  have_docker
  local arch; arch=$(docker_arch)
  [ "$arch" != unknown ] || die "Unsupported Docker engine architecture." "chainbench-l2 images are built for linux/arm64 or linux/amd64."
  mkdir -p "$IMG_STATE"
  local log; log="$IMG_STATE/build-$(utc).log"; : >"$log"
  # shellcheck disable=SC1090
  . "$PINS"
  say "chainbench build-image-l2: platform linux/$arch (log: $(rel "$log"))"
  [ -n "$BASE_IMAGE_DIGEST" ] || die "The base-image digest is not pinned in chainbench/adapters/eravm/pins.env." "git checkout -- chainbench/adapters/eravm/pins.env"
  local base_ref="$BASE_IMAGE_REPO@$BASE_IMAGE_DIGEST"
  docker pull --platform "linux/$arch" "$base_ref" >>"$log" 2>&1 || die "Cannot pull the pinned base image $base_ref." \
    "build-image-l2 needs network access to Docker Hub once; details in $(rel "$log")"
  pass "base image $BASE_IMAGE_REPO:$BASE_IMAGE_TAG pinned as $base_ref"
  local ctx; ctx=$(mktemp -d)
  cp "$AD/package.json" "$AD/package-lock.json" "$AD/Dockerfile" "$AD/pins.env" "$ctx/"
  local meta="$IMG_STATE/build-metadata.json"; rm -f "$meta"
  say "building the image (release binaries checked by sha256; npm ci from adapters/eravm/package-lock.json) ..."
  if docker buildx version >/dev/null 2>&1; then
    docker buildx build --load --progress plain --metadata-file "$meta" --platform "linux/$arch" \
      --build-arg "BASE_IMAGE=$base_ref" --build-arg "ERAVM_ARCH=$arch" -t "$LOCAL_TAG" "$ctx" >>"$log" 2>&1
  else
    DOCKER_BUILDKIT=1 docker build --progress plain --platform "linux/$arch" \
      --build-arg "BASE_IMAGE=$base_ref" --build-arg "ERAVM_ARCH=$arch" -t "$LOCAL_TAG" "$ctx" >>"$log" 2>&1
  fi || { rm -rf "$ctx"; tail -25 "$log"; die "Image build failed (a sha256 mismatch of a downloaded binary also stops it here)." "Details in $(rel "$log")"; }
  rm -rf "$ctx"
  IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$LOCAL_TAG"); BASE_IMAGE_PINNED=$base_ref
  {
    printf 'IMAGE_ID="%s"\n' "$IMAGE_ID"; printf 'BASE_IMAGE_PINNED="%s"\n' "$base_ref"
    printf 'ARCH="%s"\n' "$arch"; printf 'BUILT_AT="%s"\n' "$(utc)"
  } >"$IMG_STATE/image.env"
  pass "image built: $LOCAL_TAG = $IMAGE_ID"
  local st="/repo/build/chainbench/l2/${IMG_STATE##*/}"
  dkr -e "CHAINBENCH_BUILD_METADATA=$st/build-metadata.json" -e "CHAINBENCH_HOST_JSON=$(host_json)" -- identity --out "$st/identity.json" >>"$log" 2>&1 \
    || die "Could not record the toolchain identity of the new image." "Details in $(rel "$log")"
  pass "toolchain identity recorded: $(rel "$IMG_STATE")/identity.json"
  if [ -f "$AD/IMAGE.json" ] && [ "$freeze" = 0 ]; then
    if dkr -- identity --compare adapters/eravm/IMAGE.json >"$IMG_STATE/accepted-compare.txt" 2>&1; then
      pass "toolchain matches the accepted L2 toolchain (adapters/eravm/IMAGE.json; $(grep -c '^\[PASS\]' "$IMG_STATE/accepted-compare.txt") fields)"
    else
      grep '^\[FAIL\]' "$IMG_STATE/accepted-compare.txt" | head -12
      [ "$arch" = arm64 ] && die "The image toolchain differs from the accepted L2 toolchain." "Do not change adapters/eravm/package-lock.json or pins.env; rebuild from the committed files."
      warn "architecture $arch differs from the reference (arm64): architecture-specific binaries differ (see above)"
    fi
  fi
  if [ "$freeze" = 1 ]; then
    [ "$arch" = arm64 ] || die "The reference L2 image record is taken on linux/arm64 only."
    cp "$IMG_STATE/identity.json" "$AD/IMAGE.json"
    pass "reference image record written: chainbench/adapters/eravm/IMAGE.json (commit it)"
  fi
}

# ---------------------------------------------------------------- doctor-l2
doctor() {
  FAILS=0
  say "chainbench doctor-l2: checks only, no experiment is run."
  command -v docker >/dev/null 2>&1 || { fail "Docker is installed" "Install Docker Desktop (macOS/Windows) or Docker Engine (Linux): https://docs.docker.com/get-docker/"; return 1; }
  docker info >/dev/null 2>&1 || { fail "Docker daemon is reachable" "Start Docker Desktop (or the Docker service on Linux) and re-run."; return 1; }
  pass "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) is running ($(docker info --format '{{.OperatingSystem}}' 2>/dev/null))"
  local arch; arch=$(docker_arch)
  case "$arch" in
    arm64) pass "architecture linux/arm64 (same as the reference L2 measurements)" ;;
    amd64) warn "architecture linux/amd64: the reference L2 measurements are arm64; values must still be identical (smoke-l2 checks this)" ;;
    *) fail "supported architecture" "Use a linux/arm64 or linux/amd64 Docker engine." ;;
  esac
  local cpus mem avail
  cpus=$(docker info --format '{{.NCPU}}' 2>/dev/null); mem=$(docker info --format '{{.MemTotal}}' 2>/dev/null)
  if [ "${mem:-0}" -lt 2147483648 ]; then fail "Docker memory ${mem:-?} bytes" "Give Docker at least 4 GiB of memory (Docker Desktop > Settings > Resources)."
  elif [ "${mem:-0}" -lt 4294967296 ] || [ "${cpus:-0}" -lt 2 ]; then warn "Docker resources are low (${cpus} CPUs, $((mem / 1073741824)) GiB); 2+ CPUs and 4+ GiB recommended"
  else pass "Docker resources: ${cpus} CPUs, $((mem / 1073741824)) GiB memory"; fi
  avail=$(df -Pk "$REPO" | awk 'NR==2 {print $4}')
  if [ "${avail:-0}" -lt 2097152 ]; then fail "free disk space $((avail / 1048576)) GiB" "Free at least 2 GiB (the image needs about 0.6 GiB)."
  else pass "free disk space $((avail / 1048576)) GiB"; fi
  [ -e "$REPO/.git" ] && pass "repository clone with git metadata ($REPO)" \
    || fail "repository clone with git metadata" "Run chainbench from a git clone of the repository (a downloaded archive has no .git directory)."
  local d
  for d in build/chainbench/l2 build/campaigns/chain-l2; do
    if mkdir -p "$REPO/$d" 2>/dev/null && touch "$REPO/$d/.doctor-probe" 2>/dev/null; then rm -f "$REPO/$d/.doctor-probe"; pass "output location writable: $d"
    else fail "output location writable: $d" "Make $REPO/$d writable by your user."; fi
  done
  if [ "$FAILS" -gt 0 ]; then say "DOCTOR-L2: $FAILS host check(s) failed; fix them and re-run."; return 1; fi
  if ! image_present; then
    info "the chainbench-l2 image is not built on this machine yet: building it now from the committed pins (first run only; network access once)"
    if ( build_image ); then :; else fail "chainbench-l2 image built" "See the message above; then re-run ./chainbench/run.sh doctor-l2."; return 1; fi
  fi
  # shellcheck disable=SC1091
  . "$IMG_STATE/image.env"
  if docker image inspect "$IMAGE_ID" >/dev/null 2>&1; then pass "chainbench-l2 image present: $IMAGE_ID"
  else fail "chainbench-l2 image present ($IMAGE_ID)" "Run ./chainbench/run.sh build-image-l2 again."; return 1; fi
  say "--- inside the chainbench-l2 container (no network):"
  dkr -e "CHAINBENCH_HOST_JSON=$(host_json)" -- doctor "$@" || FAILS=$((FAILS + 1))
  [ "$FAILS" -eq 0 ]
}

# ---------------------------------------------------------------- smoke-l2
LAST_SMOKE=""
smoke() {
  load_image
  local rid; rid="smoke-l2-${PLATFORM_OVERRIDE:+${PLATFORM_OVERRIDE#linux/}-}$(utc)"
  local out=/repo/build/chainbench/l2/smoke hout="$REPO/build/chainbench/l2/smoke"
  mkdir -p "$hout"
  say "chainbench smoke-l2: $rid (NOT scientific data; output $(rel "$hout")/$rid)"
  dkr -e "CHAINBENCH_OUT_ROOT=$out" -- run --plan smoke --run-id "$rid" >"$hout/$rid.log" 2>&1 && run_ok "$hout/$rid" \
    || { tail -20 "$hout/$rid.log"; die "The L2 smoke run failed." "See $(rel "$hout")/$rid.log; then run ./chainbench/run.sh doctor-l2."; }
  pass "contracts compiled with zksolc and the smoke cells ran on a fresh local EraVM node each (Groth16 d5, PLONK d10; 1 proof; all negative controls)"
  dkr -- smoke-check "$out/$rid" "$SMOKE_REF" --out "$out/$rid/smoke_check.json" || die "The L2 smoke checks failed." \
    "The environment does not reproduce the accepted L2 values; report $(rel "$hout")/$rid/smoke_check.json and do not run the full L2 experiment."
  LAST_SMOKE=$rid
  say "SMOKE-L2 PASS: $(rel "$hout")/$rid (NOT scientific data)"
}

# ---------------------------------------------------------------- two runs from scratch: validation + determinism
# two_runs <plan> <run-id prefix> <out root in container> <host out root> <log>
two_runs() {
  local plan=$1 rid=$2 out=$3 hout=$4 log=$5 envs=() r
  [ "$plan" = full ] || envs=(-e "CHAINBENCH_OUT_ROOT=$out")
  for r in a b; do
    say "  run $r (fresh container, fresh build, fresh EraVM node per cell) ..."
    dkr ${envs[@]+"${envs[@]}"} -- run --plan "$plan" --run-id "$rid-$r" >>"$log" 2>&1 && run_ok "$hout/$rid-$r" \
      || die "L2 run $r failed or its checks were not accepted." "See $(rel "$log") and $(rel "$hout")/$rid-$r/run.json"
    pass "run $r: $(run_line "$rid-$r" "$log")"
    dkr -- validate "$out/$rid-$r" --out "$out/$rid-$r/validation.json" >>"$log" 2>&1 \
      && pass "run $r: $(grep '^VALIDATION' "$log" | tail -1) ($(rel "$hout")/$rid-$r/validation.json)" \
      || die "Validation of run $r failed." "Inspect $(rel "$hout")/$rid-$r/validation.json; do not use these runs."
  done
  dkr -- compare --a "$out/$rid-a" --b "$out/$rid-b" --out "$out/$rid-b/compare_determinism.json" >>"$log" 2>&1 \
    && pass "determinism: run a = run b on every raw field (except run_id), build manifest, environment and probe" \
    || die "Determinism check failed: the two runs differ." "Inspect $(rel "$hout")/$rid-b/compare_determinism.json; the difference must be diagnosed, not normalised."
  dkr -- summarize "$out/$rid-a" --out "$out/$rid-a/summary.csv" --sizes "$out/$rid-a/compile_sizes.csv" >>"$log" 2>&1 \
    && pass "per-cell summary (EraVM units): $(rel "$hout")/$rid-a/summary.csv"
}
dry_run() {
  load_image
  local rid; rid="dry-l2-$(dkr -- head | tail -1)-$(utc)"
  local out=/repo/build/chainbench/l2/dry-run hout="$REPO/build/chainbench/l2/dry-run"; mkdir -p "$hout"
  local log="$hout/$rid.log"; : >"$log"
  say "chainbench dry-run-l2: $rid (engineering; NOT scientific data; output $(rel "$hout"))"
  two_runs dry "$rid" "$out" "$hout" "$log"
  say "DRY-RUN-L2 PASS: $rid-a, $rid-b (outputs in $(rel "$hout"); NOT scientific data)"
  printf '%s\n' "$rid" >"$hout/LATEST"
}
full_local_l2() {
  load_image
  say "chainbench full-local-l2: the frozen scientific L2 procedure (CHAIN-PROTOCOL-v1 section 16, amendment A6)"
  local rid; rid="full-l2-$(dkr -- head | tail -1)-$(utc)"
  local out=/repo/build/campaigns/chain-l2 hout="$REPO/build/campaigns/chain-l2"
  say "--- pre-flight (doctor-l2; clean sources, L2 baseline tag and the archived image required):"
  dkr -e "CHAINBENCH_HOST_JSON=$(host_json)" -- doctor --require-clean --require-baseline --require-archived-image --out "$out/$rid.preflight.json" \
    || die "Pre-flight checks failed; the scientific L2 run was NOT started." "Fix the items above."
  local log="$hout/$rid.log"; : >"$log"
  two_runs full "$rid" "$out" "$hout" "$log"
  dkr -e "CHAINBENCH_HOST_JSON=$(host_json)" -- doctor --require-clean --require-baseline --require-archived-image --out "$out/$rid.postflight.json" \
    || die "Post-flight checks failed: sources, baseline tag or image changed during the campaign." "Do not accept $rid."
  say "FULL LOCAL L2 DONE: $rid-a, $rid-b in $(rel "$hout")"
}

# ---------------------------------------------------------------- image archive
save_image() {  # save-image-l2 <output dir> [--frozen]
  local out=${1:-} frozen=0
  [ "${2:-}" = --frozen ] && frozen=1
  [ -n "$out" ] || die "usage: ./chainbench/run.sh save-image-l2 <output dir> [--frozen]"
  load_image
  case "$out" in /*) ;; *) out="$REPO/$out" ;; esac
  mkdir -p "$out/image"
  local arch=$ARCH now f rec
  now=$(docker image inspect --format '{{.Id}}' "$LOCAL_TAG" 2>/dev/null)
  [ "$now" = "$IMAGE_ID" ] || die "$LOCAL_TAG is '$now', not the recorded image $IMAGE_ID." "Rebuild or reload the image before archiving it."
  f="$out/image/chainbench-l2-$arch.oci.tar"; rec="$out/IMAGE-ARCHIVE-L2.$arch.json"
  [ -e "$f" ] && die "$f already exists (archives are never overwritten)."
  say "docker save $LOCAL_TAG ($IMAGE_ID) -> $(rel "$f")"
  docker save -o "$f" "$LOCAL_TAG" || die "docker save failed for $LOCAL_TAG."
  tar -tf "$f" | LC_ALL=C sort >"${f%.oci.tar}.listing.txt"
  tar -xOf "$f" index.json >"${f%.oci.tar}.index.json"
  local has_idx=false; grep -qx "blobs/sha256/${IMAGE_ID#sha256:}" "${f%.oci.tar}.listing.txt" && has_idx=true
  {
    printf '{\n'
    printf '  "schema": "chainbench-image-archive/1",\n'
    printf '  "arm": "L2-EraVM",\n'
    printf '  "role": "%s",\n' "$([ "$frozen" = 1 ] && echo scientific || echo portability)"
    printf '  "platform": "linux/%s",\n' "$arch"
    printf '  "image_ref": "%s",\n' "$LOCAL_TAG"
    printf '  "image_id": "%s",\n' "$IMAGE_ID"
    printf '  "base_image": "%s",\n' "$BASE_IMAGE_PINNED"
    printf '  "archive": "image/%s",\n' "$(basename "$f")"
    printf '  "archive_file": "%s",\n' "$(rel "$f")"
    printf '  "archive_bytes": %s,\n' "$(wc -c <"$f" | tr -d ' ')"
    printf '  "archive_sha256": "%s",\n' "$(sha256_of "$f")"
    printf '  "archive_contains_image_index_blob": %s,\n' "$has_idx"
    printf '  "index_json_sha256": "%s",\n' "$(sha256_of "${f%.oci.tar}.index.json")"
    printf '  "docker_client": "%s",\n' "$(docker version --format '{{.Client.Version}}' 2>/dev/null)"
    printf '  "docker_engine": "%s",\n' "$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
    printf '  "saved_utc": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "load_command": "./chainbench/run.sh load-image-l2 %s"\n' "$(rel "$f")"
    printf '}\n'
  } >"$rec"
  [ "$has_idx" = true ] || die "The archive does not contain the image index blob ${IMAGE_ID}." "See ${f%.oci.tar}.listing.txt"
  pass "L2 image archive: $(rel "$f") ($(json_get archive_bytes "$rec") bytes, sha256 $(json_get archive_sha256 "$rec"))"
  if [ "$frozen" = 1 ]; then
    cp "$rec" "$AD/ARCHIVE.json"
    pass "frozen-image record written: chainbench/adapters/eravm/ARCHIVE.json (full-local-l2 requires this exact image on linux/$arch)"
  fi
}
load_image_archive() {  # load-image-l2 <archive.oci.tar> [<record.json>]
  have_docker
  local f=${1:-} rec=${2:-$AD/ARCHIVE.json}
  [ -f "$f" ] || die "usage: ./chainbench/run.sh load-image-l2 <chainbench-l2-<arch>.oci.tar> [<IMAGE-ARCHIVE-L2 record>]"
  [ -f "$rec" ] || die "No archive record $rec." "Pass the IMAGE-ARCHIVE-L2.<arch>.json that belongs to this archive as the second argument."
  local want_sha want_id plat sha
  want_sha=$(json_get archive_sha256 "$rec"); want_id=$(json_get image_id "$rec"); plat=$(json_get platform "$rec")
  say "verifying $(basename "$f") against $(rel "$rec") ..."
  sha=$(sha256_of "$f")
  [ "$sha" = "$want_sha" ] || die "Archive sha256 $sha does not match the record ($want_sha)." "Use the archive that belongs to $(rel "$rec")."
  pass "archive sha256 $sha"
  [ "linux/$(docker_arch)" = "$plat" ] || die "This archive is $plat but the target platform is linux/$(docker_arch)." "Run with CHAINBENCH_PLATFORM=$plat (emulation) or use the archive for your platform."
  docker load -i "$f" || die "docker load failed."
  docker image inspect "$want_id" >/dev/null 2>&1 || die "After loading, image $want_id is not present." "Check the archive and the record."
  mkdir -p "$IMG_STATE"
  {
    printf 'IMAGE_ID="%s"\n' "$want_id"; printf 'BASE_IMAGE_PINNED="%s"\n' "$(json_get base_image "$rec")"
    printf 'ARCH="%s"\n' "${plat#linux/}"; printf 'BUILT_AT="loaded %s sha256:%s at %s"\n' "$(basename "$f")" "$sha" "$(utc)"
  } >"$IMG_STATE/image.env"
  # shellcheck disable=SC1091
  . "$IMG_STATE/image.env"
  docker tag "$want_id" "$LOCAL_TAG" >/dev/null 2>&1 || true
  dkr -e "CHAINBENCH_HOST_JSON=$(host_json)" -- identity --out "/repo/build/chainbench/l2/${IMG_STATE##*/}/identity.json" >/dev/null 2>&1 \
    || die "Could not record the toolchain identity of the loaded image."
  pass "L2 image loaded: $want_id ($plat); next: ./chainbench/run.sh doctor-l2"
}

# ---------------------------------------------------------------- author-l2 (readiness; NOT the scientific run)
author_l2() {  # author-l2 <release dir>
  local out=${1:-}
  [ -n "$out" ] || die "usage: ./chainbench/run.sh author-l2 <release dir, e.g. build/chainbench/l2/release>"
  [ -z "$PLATFORM_OVERRIDE" ] || die "author-l2 runs on the native platform (unset CHAINBENCH_PLATFORM)."
  local sum; sum="$REPO/build/chainbench/l2/author-l2-$(utc).txt"; mkdir -p "${sum%/*}"; : >"$sum"
  note() { printf '%s\n' "$*" | tee -a "$sum"; }
  say "=== author-l2: build + identity record, doctor, smoke (+ reference), dry run x2, archive, amd64 portability ==="
  build_image --freeze
  note "image: $IMAGE_ID (linux/$(docker_arch)) base $BASE_IMAGE_PINNED"
  if doctor; then note "native_doctor: PASS"; else note "native_doctor: FAIL"; die "author-l2 stopped at doctor-l2."; fi
  if [ -f "$CB_DIR/$SMOKE_REF" ]; then
    smoke; note "native_smoke_vs_reference: PASS ($LAST_SMOKE)"
  else
    smoke; note "native_smoke_1: PASS ($LAST_SMOKE; no reference yet)"
    dkr -- make-smoke-ref "/repo/build/chainbench/l2/smoke/$LAST_SMOKE" --out "/repo/build/chainbench/l2/smoke-reference-l2.csv" \
      && cp "$REPO/build/chainbench/l2/smoke-reference-l2.csv" "$CB_DIR/$SMOKE_REF" \
      && note "smoke_reference: written chainbench/$SMOKE_REF from $LAST_SMOKE (commit it)" || die "Could not write the L2 smoke reference."
    smoke; note "native_smoke_2_vs_reference: PASS ($LAST_SMOKE)"
  fi
  dry_run; note "dry_run: PASS ($(cat "$REPO/build/chainbench/l2/dry-run/LATEST"): runs a and b validated, identical)"
  save_image "$out" --frozen; note "frozen_archive: $(json_get archive_file "$AD/ARCHIVE.json") sha256 $(json_get archive_sha256 "$AD/ARCHIVE.json") image $(json_get image_id "$AD/ARCHIVE.json")"
  say "--- load-image-l2 round trip on the frozen archive:"
  if "$0" load-image-l2 "$REPO/$(json_get archive_file "$AD/ARCHIVE.json")"; then note "load_image_native: PASS"; else note "load_image_native: FAIL"; fi
  local other=amd64; [ "$(docker_arch)" = amd64 ] && other=arm64
  say "--- portability: linux/$other (emulated; NOT scientific data)"
  if CHAINBENCH_PLATFORM="linux/$other" "$0" doctor-l2; then note "portability_${other}_doctor: PASS"; else note "portability_${other}_doctor: FAIL"; fi
  if CHAINBENCH_PLATFORM="linux/$other" "$0" smoke-l2; then note "portability_${other}_smoke_vs_reference: PASS"; else note "portability_${other}_smoke_vs_reference: FAIL"; fi
  say "--- native platform (linux/$(docker_arch)) with the archived image: doctor-l2 and smoke-l2"
  if "$0" doctor-l2; then note "native_doctor_archived_image: PASS"; else note "native_doctor_archived_image: FAIL"; fi
  if "$0" smoke-l2; then note "native_smoke_archived_image_vs_reference: PASS"; else note "native_smoke_archived_image_vs_reference: FAIL"; fi
  say "AUTHOR-L2 finished; summary: $(rel "$sum")"
  cat "$sum"
}

# ---------------------------------------------------------------- main
cmd=${1:-help}; [ "$#" -gt 0 ] && shift
case "$cmd" in
  build-image-l2)  build_image "$@" ;;
  doctor-l2)       doctor "$@" ;;
  smoke-l2)        smoke ;;
  dry-run-l2)      dry_run ;;
  full-local-l2)   full_local_l2 ;;
  save-image-l2)   save_image "$@" ;;
  load-image-l2)   load_image_archive "$@" ;;
  author-l2)       author_l2 "$@" ;;
  help|-h|--help)  usage ;;
  *) usage; die "unknown L2 command '$cmd'" "Use one of: doctor-l2, smoke-l2, full-local-l2 (also build-image-l2, dry-run-l2)." ;;
esac
