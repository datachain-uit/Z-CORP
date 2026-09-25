#!/usr/bin/env bash
# chainbench public-network adapter (CSI-CHAIN-PUBLIC-01, CHAIN-PUBLIC-PROTOCOL-v1). Called through ./chainbench/run.sh.
#
#   ./chainbench/run.sh build-image-public          build the pinned chainbench-public image (network access once)
#   ./chainbench/run.sh doctor-public [--offline]    checks + read-only endpoint observation; NEVER signs or sends
#   ./chainbench/run.sh dry-run-public              engineering dry run: mock endpoints, ephemeral key, --network none
#   ./chainbench/run.sh check-public-inputs         reviewer: frozen inputs vs the controlled study (no key, no network)
#   ./chainbench/run.sh derive-public [ROOT]        reviewer: validation + dated summaries of recorded runs (no key)
#   ./chainbench/run.sh run-public-setup NETWORK    LIVE: 8 setup transactions on sepolia | era-sepolia (asks to confirm)
#   ./chainbench/run.sh run-public-session S1|S2|S3 LIVE: one frozen verification session on both networks (asks to confirm)
#   ./chainbench/run.sh collect-era-finality        post-hoc, read-only Era batch commit/prove/execute times
#
# Live commands need: CHAINBENCH_PUBLIC_KEY_FILE (a dedicated funded key, 0x-hex, outside the repository, chmod 600) or
# CHAINBENCH_PUBLIC_PRIVATE_KEY; CHAINBENCH_PUBLIC_RPC_SEPOLIA / CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA (https) and optional
# CHAINBENCH_PUBLIC_RPC_LABEL_*. CHAINBENCH_PUBLIC_NATIVE=1 runs with the host's Node 22 instead of the image.
set -uo pipefail
CB_DIR=$(cd "$(dirname "$0")/../.." && pwd -P)
REPO=$(cd "$CB_DIR/.." && pwd -P)
AD="$CB_DIR/adapters/public"
IMG_STATE="$REPO/build/chainbench/public/image"
LOCAL_TAG="chainbench-public:local"
KEY_IN="/run/secrets/chainbench_public_key"
say()  { printf '%s\n' "$*"; }
die()  { printf '[FAIL] %s\n' "$1" >&2; if [ -n "${2:-}" ]; then printf '       Fix: %s\n' "$2" >&2; fi; exit 1; }
usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; }
native() { [ "${CHAINBENCH_PUBLIC_NATIVE:-0}" = 1 ]; }

have_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed." "Install Docker, or run with CHAINBENCH_PUBLIC_NATIVE=1 and Node 22 (npm ci --ignore-scripts in chainbench/adapters/public)."
  docker info >/dev/null 2>&1 || die "The Docker daemon is not running." "Start Docker Desktop / the Docker service and re-run."
}
build_image() {
  have_docker
  . "$AD/pins.env"
  mkdir -p "$IMG_STATE"
  docker build --build-arg "BASE_IMAGE=${BASE_IMAGE_REPO}@${BASE_IMAGE_DIGEST}" -t "$LOCAL_TAG" "$AD" || die "image build failed"
  local id; id=$(docker image inspect --format '{{.Id}}' "$LOCAL_TAG")
  printf 'IMAGE_ID=%s\nBASE_IMAGE=%s@%s\nBUILT_UTC=%s\n' "$id" "$BASE_IMAGE_REPO" "$BASE_IMAGE_DIGEST" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$IMG_STATE/image.env"
  say "[PASS] chainbench-public image $id"
}
image_id() {
  [ -f "$IMG_STATE/image.env" ] || die "No chainbench-public image yet." "Run ./chainbench/run.sh build-image-public first (or CHAINBENCH_PUBLIC_NATIVE=1)."
  sed -n 's/^IMAGE_ID=//p' "$IMG_STATE/image.env"
}
# host-side key checks before anything is mounted (the runner repeats them inside)
key_mount() {
  KEYARGS=()
  if [ -n "${CHAINBENCH_PUBLIC_KEY_FILE:-}" ]; then
    local f="$CHAINBENCH_PUBLIC_KEY_FILE"
    case "$f" in /*) ;; *) die "CHAINBENCH_PUBLIC_KEY_FILE must be an absolute path outside the repository.";; esac
    [ -f "$f" ] || die "the key file does not exist."
    local real; real=$(cd "$(dirname "$f")" && pwd -P)/$(basename "$f")
    case "$real" in "$REPO"|"$REPO"/*) die "the key file is inside the repository; keep it outside (it must never be committed).";; esac
    local mode; mode=$(stat -f '%Lp' "$f" 2>/dev/null || stat -c '%a' "$f")
    case "$mode" in 600|400) ;; *) die "the key file mode is $mode; chmod 600 it.";; esac
    KEYARGS=(--mount "type=bind,source=$real,target=$KEY_IN,readonly" -e "CHAINBENCH_PUBLIC_KEY_FILE=$KEY_IN")
  elif [ -n "${CHAINBENCH_PUBLIC_PRIVATE_KEY:-}" ]; then
    KEYARGS=(-e CHAINBENCH_PUBLIC_PRIVATE_KEY)   # passed by name: the value never appears on a command line
  fi
}
# run a node/python command of the adapter: in the image (default) or natively
run_in() {
  local net="$1"; shift
  if native; then (cd "$CB_DIR" && "$@"); return $?; fi
  have_docker
  local id; id=$(image_id)
  mkdir -p "$REPO/build/chainbench/public" "$REPO/build/campaigns/chain-public"
  local user=(); if [ "$(uname -s)" = Linux ]; then user=(--user "$(id -u):$(id -g)"); fi
  local envs=(-e HOME=/tmp -e CHAINBENCH_CAMPAIGN=CSI-CHAIN-PUBLIC-01)
  for v in CHAINBENCH_PUBLIC_RPC_SEPOLIA CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA CHAINBENCH_PUBLIC_DEVIATION; do
    [ -n "${!v:-}" ] && envs+=(-e "$v")
  done
  docker run --rm --network "$net" ${user[@]+"${user[@]}"} "${envs[@]}" ${KEYARGS[@]+"${KEYARGS[@]}"} \
    --mount "type=bind,source=$REPO,target=/repo,readonly" \
    --mount "type=volume,target=/repo/chainbench/adapters/public/node_modules" \
    --mount "type=bind,source=$REPO/build/chainbench/public,target=/repo/build/chainbench/public" \
    --mount "type=bind,source=$REPO/build/campaigns/chain-public,target=/repo/build/campaigns/chain-public" \
    -w /repo/chainbench "$id" "$@"
}
confirm() {
  local want="$1"
  say "LIVE: this sends real transactions on public test networks with the dedicated key (test ether is spent)."
  printf 'Type %s to continue: ' "$want"; local got; read -r got
  [ "$got" = "$want" ] || die "not confirmed; nothing was sent."
}
KEYARGS=()
cmd=${1:-help}; [ "$#" -gt 0 ] && shift
case "$cmd" in
  build-image-public)   build_image ;;
  doctor-public)        key_mount; run_in bridge node adapters/public/scripts/doctor_public.js "$@" ;;
  dry-run-public)       run_in none node adapters/public/scripts/dry_run_public.js "$@" ;;
  check-public-inputs)  run_in none python3 adapters/public/scripts/check_public_inputs.py ;;
  derive-public)        root=${1:-build/campaigns/chain-public}; run_in none python3 ../scripts/analysis/derive_chain_public.py --root "../$root" --out "../$root/derived" --mode live ;;
  run-public-setup)     [ "$#" -ge 1 ] || die "usage: run-public-setup sepolia|era-sepolia"; key_mount; confirm "setup-$1"
                        run_in bridge node adapters/public/scripts/run_public.js --mode live --phase setup --network "$1" --confirm "setup-$1" ;;
  run-public-session)   [ "$#" -ge 1 ] || die "usage: run-public-session S1|S2|S3"; key_mount; confirm "$1"
                        run_in bridge node adapters/public/scripts/run_public.js --mode live --phase session --session "$1" --confirm "$1" ;;
  collect-era-finality) run_in bridge node adapters/public/scripts/collect_era_finality.js --mode live --root build/campaigns/chain-public "$@" ;;
  help|-h|--help)       usage ;;
  *) usage; die "unknown command '$cmd'" ;;
esac
