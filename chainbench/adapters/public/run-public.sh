#!/usr/bin/env bash
# chainbench public-network adapter (CSI-CHAIN-PUBLIC-01, CHAIN-PUBLIC-PROTOCOL-v1). Called through ./chainbench/run.sh.
#
#   ./chainbench/run.sh build-image-public          build the pinned chainbench-public image (network access once)
#   ./chainbench/run.sh doctor-public [--offline]    checks + read-only endpoint observation; NEVER signs or sends
#   ./chainbench/run.sh dry-run-public              engineering dry run: mock endpoints, ephemeral key, --network none
#   ./chainbench/run.sh check-public-inputs         reviewer: frozen inputs vs the controlled study (no key, no network)
#   ./chainbench/run.sh derive-public [ROOT]        reviewer: validation + dated summaries of recorded runs (no key)
#   ./chainbench/run.sh test-guards-public          reviewer: key-file, image-record and runner-guard tests (no key, no network)
#   ./chainbench/run.sh verify-image-public         the loaded image = the frozen image of adapters/public/ARCHIVE.json?
#   ./chainbench/run.sh load-image-public ARCHIVE   load the frozen archive (sha256 checked against ARCHIVE.json first)
#   ./chainbench/run.sh save-image-public           author: archive the built image, write the frozen record ARCHIVE.json
#   ./chainbench/run.sh run-public-setup NETWORK    LIVE: 8 setup transactions on sepolia | era-sepolia (asks to confirm)
#   ./chainbench/run.sh run-public-session S1|S2|S3 LIVE: one frozen verification session on both networks (asks to confirm)
#   ./chainbench/run.sh collect-era-finality        LIVE, read-only: post-hoc Era batch commit/prove/execute times
#
# Live commands run only in the frozen public image: before anything else (before the key file is even checked) the image
# is verified against the versioned record chainbench/adapters/public/ARCHIVE.json (image-index digest = Docker image ID,
# OS, architecture, rootfs layers; the record chains index -> manifest -> config and the archive sha256), the container is
# started by that digest (never by tag) with the verified identity passed in, and the image is verified again afterwards.
# Both checks are appended to <live out root>/IMAGE-LEDGER.jsonl; run.json records the identity.
# Live commands need: CHAINBENCH_PUBLIC_KEY_FILE (the dedicated key, see tools/new_public_key.sh; checked by lib/guards.sh:
# absolute, not a symlink, regular, outside the repository, yours, 0600/0400, directory 0700) or CHAINBENCH_PUBLIC_PRIVATE_KEY;
# CHAINBENCH_PUBLIC_RPC_SEPOLIA / CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA (https; must be the frozen endpoints of the binding).
# CHAINBENCH_PUBLIC_NATIVE=1 runs reviewer commands with the host's Node 22 instead of the image (never live commands).
set -uo pipefail
CB_DIR=$(cd "$(dirname "$0")/../.." && pwd -P)
REPO=$(cd "$CB_DIR/.." && pwd -P)
AD="$CB_DIR/adapters/public"
IMG_STATE="$REPO/build/chainbench/public/image"
RECORD="$AD/ARCHIVE.json"
LIVE_OUT="$REPO/build/campaigns/chain-public"
LOCAL_TAG="chainbench-public:local"
KEY_IN="/run/secrets/chainbench_public_key"
. "$AD/lib/guards.sh"
say()  { printf '%s\n' "$*"; }
die()  { printf '[FAIL] %s\n' "$1" >&2; if [ -n "${2:-}" ]; then printf '       Fix: %s\n' "$2" >&2; fi; exit 1; }
usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }
native() { [ "${CHAINBENCH_PUBLIC_NATIVE:-0}" = 1 ]; }
utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

have_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed." "Install Docker, or run reviewer commands with CHAINBENCH_PUBLIC_NATIVE=1 and Node 22 (npm ci --ignore-scripts in chainbench/adapters/public)."
  docker info >/dev/null 2>&1 || die "The Docker daemon is not running." "Start Docker Desktop / the Docker service and re-run."
}
build_image() {
  have_docker
  . "$AD/pins.env"
  mkdir -p "$IMG_STATE"
  docker build --build-arg "BASE_IMAGE=${BASE_IMAGE_REPO}@${BASE_IMAGE_DIGEST}" -t "$LOCAL_TAG" "$AD" || die "image build failed"
  local id; id=$(docker image inspect --format '{{.Id}}' "$LOCAL_TAG")
  printf 'IMAGE_ID=%s\nBASE_IMAGE=%s@%s\nBUILT_UTC=%s\n' "$id" "$BASE_IMAGE_REPO" "$BASE_IMAGE_DIGEST" "$(utc)" > "$IMG_STATE/image.env"
  say "[PASS] chainbench-public image $id"
  [ -f "$RECORD" ] && [ "$(cb_json_get image_id "$RECORD")" != "$id" ] && say "[NOTE] this is not the frozen public image $(cb_json_get image_id "$RECORD") (live commands refuse it; reviewer commands accept it)"
  return 0
}
image_id() {
  [ -f "$IMG_STATE/image.env" ] || die "No chainbench-public image yet." "Run ./chainbench/run.sh build-image-public (or load-image-public ARCHIVE), or CHAINBENCH_PUBLIC_NATIVE=1."
  sed -n 's/^IMAGE_ID=//p' "$IMG_STATE/image.env"
}
# environment passed to the container: the identity of the image it runs in (verified = the frozen record, or not)
image_env() {
  IMGENV=(-e "CHAINBENCH_PUBLIC_IMAGE_ID=$1" -e "CHAINBENCH_PUBLIC_IMAGE_CHECK=$2" -e "CHAINBENCH_PUBLIC_IMAGE_CHECK_UTC=$(utc)")
  if [ "$2" = pass ]; then
    IMGENV+=(-e "CHAINBENCH_PUBLIC_IMAGE_MANIFEST=$(cb_json_get manifest_digest "$RECORD")" -e "CHAINBENCH_PUBLIC_IMAGE_CONFIG=$(cb_json_get config_digest "$RECORD")"
             -e "CHAINBENCH_PUBLIC_IMAGE_ARCHIVE_SHA256=$(cb_json_get archive_sha256 "$RECORD")" -e "CHAINBENCH_PUBLIC_IMAGE_ARCH=$(cb_json_get architecture "$RECORD")"
             -e "CHAINBENCH_PUBLIC_IMAGE_PLATFORM=$(cb_json_get platform "$RECORD")")
  fi
}
ledger() {  # phase command result image [run ids]
  mkdir -p "$LIVE_OUT"
  printf '{"utc":"%s","phase":"%s","command":"%s","result":"%s","image_id":"%s","record_sha256":"%s","run_ids":[%s]}\n' \
    "$(utc)" "$1" "$2" "$3" "$4" "$( [ -f "$RECORD" ] && cb_sha256 "$RECORD")" "${5:-}" >> "$LIVE_OUT/IMAGE-LEDGER.jsonl"
}
# live commands: the frozen image, verified before anything else; refuses native runs and any other image
FROZEN_ID=""
frozen_image_pre() {
  native && die "live commands run only in the frozen public image (CHAINBENCH_PUBLIC_NATIVE=1 is for reviewer commands)."
  have_docker
  local v; v=$(cb_image_verify "$RECORD") || { ledger pre "$1" "refused ${v%%:*}" ""; die "frozen public image: $v" "Load the frozen archive: ./chainbench/run.sh load-image-public <chainbench-public-<arch>.oci.tar>; nothing was signed or sent."; }
  FROZEN_ID=$(cb_json_get image_id "$RECORD")
  local cur; cur=$(image_id 2>/dev/null) || cur="(none)"
  [ "$cur" = "$FROZEN_ID" ] || { ledger pre "$1" "refused image_env_mismatch" "$cur"; die "the selected image ($cur, build/chainbench/public/image/image.env) is not the frozen public image $FROZEN_ID" "./chainbench/run.sh load-image-public <archive> selects it; nothing was signed or sent."; }
  ledger pre "$1" pass "$FROZEN_ID"
  say "[PASS] frozen public image $FROZEN_ID ($(cb_json_get platform "$RECORD"); archive sha256 $(cb_json_get archive_sha256 "$RECORD" | cut -c1-16)…)"
}
frozen_image_post() {  # command, console log
  local v ids; ids=$(sed -nE 's/^(RUN|FINALITY) ([^:]*):.*/"\2"/p' "$2" | paste -sd, -)
  if v=$(cb_image_verify "$RECORD") && [ "$(cb_json_get image_id "$RECORD")" = "$FROZEN_ID" ]; then ledger post "$1" pass "$FROZEN_ID" "$ids"; say "[PASS] post-flight: the frozen public image is unchanged ($FROZEN_ID)"
  else ledger post "$1" "failed ${v%%:*}" "$FROZEN_ID" "$ids"; say "[FAIL] post-flight image check: $v (recorded in IMAGE-LEDGER.jsonl)"; return 1; fi
}
# host-side key checks before anything is mounted (lib/guards.sh; the runner repeats format, validity and dev accounts)
key_mount() {
  KEYARGS=()
  if [ -n "${CHAINBENCH_PUBLIC_KEY_FILE:-}" ]; then
    local real; real=$(cb_key_file_check "$CHAINBENCH_PUBLIC_KEY_FILE" "$REPO") || die "key file refused: $real" "Create and verify the dedicated key with chainbench/adapters/public/tools/new_public_key.sh and verify_public_key.sh."
    KEYARGS=(--mount "type=bind,source=$real,target=$KEY_IN,readonly" -e "CHAINBENCH_PUBLIC_KEY_FILE=$KEY_IN")
  elif [ -n "${CHAINBENCH_PUBLIC_PRIVATE_KEY:-}" ]; then
    KEYARGS=(-e CHAINBENCH_PUBLIC_PRIVATE_KEY)   # passed by name: the value never appears on a command line
  fi
}
docker_run() {  # net image cmd...
  local net="$1" id="$2"; shift 2
  mkdir -p "$REPO/build/chainbench/public" "$LIVE_OUT"
  local user=(); if [ "$(uname -s)" = Linux ]; then user=(--user "$(id -u):$(id -g)"); fi
  local envs=(-e HOME=/tmp -e CHAINBENCH_CAMPAIGN=CSI-CHAIN-PUBLIC-01)
  for v in CHAINBENCH_PUBLIC_RPC_SEPOLIA CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA CHAINBENCH_PUBLIC_DEVIATION; do
    [ -n "${!v:-}" ] && envs+=(-e "$v")
  done
  docker run --rm --network "$net" ${user[@]+"${user[@]}"} "${envs[@]}" ${IMGENV[@]+"${IMGENV[@]}"} ${KEYARGS[@]+"${KEYARGS[@]}"} \
    --mount "type=bind,source=$REPO,target=/repo,readonly" \
    --mount "type=volume,target=/repo/chainbench/adapters/public/node_modules" \
    --mount "type=bind,source=$REPO/build/chainbench/public,target=/repo/build/chainbench/public" \
    --mount "type=bind,source=$LIVE_OUT,target=/repo/build/campaigns/chain-public" \
    -w /repo/chainbench "$id" "$@"
}
# reviewer commands: in the selected image (any build; its identity is passed in and reported) or natively
run_in() {
  local net="$1"; shift
  if native; then (cd "$CB_DIR" && "$@"); return $?; fi
  have_docker
  local id v; id=$(image_id) || exit 1
  if [ -f "$RECORD" ] && [ "$(cb_json_get image_id "$RECORD")" = "$id" ] && v=$(cb_image_verify "$RECORD"); then image_env "$id" pass; else image_env "$id" not-frozen; fi
  docker_run "$net" "$id" "$@"
}
# live commands: in the frozen image by digest, console captured, post-flight image check
run_live() {
  local what="$1"; shift
  image_env "$FROZEN_ID" pass
  mkdir -p "$LIVE_OUT/CONSOLE"
  local log; log="$LIVE_OUT/CONSOLE/$(date -u +%Y%m%dT%H%M%SZ)-${what// /-}.log"
  docker_run bridge "$FROZEN_ID" "$@" 2>&1 | tee "$log"; local st=${PIPESTATUS[0]}
  frozen_image_post "$what" "$log" || st=1
  return "$st"
}
confirm() {
  local want="$1"
  say "LIVE: this sends real transactions on public test networks with the dedicated key (test ether is spent)."
  printf 'Type %s to continue: ' "$want"; local got; read -r got
  [ "$got" = "$want" ] || die "not confirmed; nothing was sent."
}
save_image() {  # author: archive the built image and write the frozen record (ARCHIVE.json) from the archive itself
  have_docker
  local id arch dir f layers; id=$(image_id) || exit 1
  [ "$(docker image inspect --format '{{.Id}}' "$LOCAL_TAG" 2>/dev/null)" = "$id" ] || die "$LOCAL_TAG is not the recorded image $id" "Rebuild with build-image-public first."
  arch=$(docker image inspect --format '{{.Architecture}}' "$id"); dir="$REPO/build/chainbench/public/release/image"; mkdir -p "$dir"
  f="$dir/chainbench-public-$arch.oci.tar"
  [ -e "$f" ] && die "$f already exists (archives are never overwritten)" "Move the old archive aside first."
  say "docker save $LOCAL_TAG ($id) -> ${f#$REPO/}"
  docker save -o "$f" "$LOCAL_TAG" || die "docker save failed"
  layers=$(docker image inspect --format '{{json .RootFS.Layers}}' "$id")
  . "$AD/pins.env"
  docker run --rm --network none --mount "type=bind,source=$f,target=/archive.tar,readonly" --mount "type=bind,source=$AD/tools,target=/tools,readonly" \
    "$id" python3 /tools/image_record.py --archive /archive.tar --archive-path "${f#$REPO/}" --image-id "$id" --layers-json "$layers" \
      --base-image "${BASE_IMAGE_REPO}@${BASE_IMAGE_DIGEST}" --docker-client "$(docker version --format '{{.Client.Version}}')" \
      --docker-engine "$(docker version --format '{{.Server.Version}}')" --built-utc "$(sed -n 's/^BUILT_UTC=//p' "$IMG_STATE/image.env")" \
    > "$RECORD.tmp" || { rm -f "$RECORD.tmp"; die "could not derive the image record from the archive"; }
  [ "$(cb_sha256 "$f")" = "$(cb_json_get archive_sha256 "$RECORD.tmp")" ] || { rm -f "$RECORD.tmp"; die "archive sha256 mismatch while recording"; }
  mv "$RECORD.tmp" "$RECORD"
  tar -tf "$f" | LC_ALL=C sort > "${f%.oci.tar}.listing.txt"; tar -xOf "$f" index.json > "${f%.oci.tar}.index.json"
  local v; v=$(cb_image_verify "$RECORD") || die "the new record does not verify: $v"
  say "[PASS] frozen public image record written: chainbench/adapters/public/ARCHIVE.json (image $id, archive sha256 $(cb_json_get archive_sha256 "$RECORD")); commit it"
}
load_image() {  # ARCHIVE: verify its sha256 against the record, docker load, select it
  have_docker
  local f=${1:-}; [ -f "$f" ] || die "usage: ./chainbench/run.sh load-image-public <chainbench-public-<arch>.oci.tar>"
  [ -f "$RECORD" ] || die "no frozen image record $RECORD"
  local want; want=$(cb_json_get archive_sha256 "$RECORD")
  [ "$(cb_sha256 "$f")" = "$want" ] || die "the archive's sha256 is not the frozen archive_sha256 $want"
  docker load -i "$f" || die "docker load failed"
  local v; v=$(cb_image_verify "$RECORD") || die "the loaded image does not verify: $v"
  mkdir -p "$IMG_STATE"
  printf 'IMAGE_ID=%s\nBASE_IMAGE=%s\nLOADED_UTC=%s\nARCHIVE_SHA256=%s\n' "$(cb_json_get image_id "$RECORD")" "$(cb_json_get base_image "$RECORD")" "$(utc)" "$want" > "$IMG_STATE/image.env"
  say "[PASS] frozen public image loaded and selected: $(cb_json_get image_id "$RECORD")"
}
verify_image() {
  have_docker
  local v; v=$(cb_image_verify "$RECORD") || die "frozen public image: $v"
  local cur; cur=$(image_id 2>/dev/null) || cur="(none)"
  say "[PASS] frozen public image present: $(cb_json_get image_id "$RECORD") ($(cb_json_get platform "$RECORD"))"
  say "       manifest $(cb_json_get manifest_digest "$RECORD")"
  say "       config   $(cb_json_get config_digest "$RECORD")"
  say "       archive  sha256 $(cb_json_get archive_sha256 "$RECORD")"
  [ "$cur" = "$(cb_json_get image_id "$RECORD")" ] && say "[PASS] selected image (image.env) = the frozen image" || die "the selected image $cur is not the frozen image" "./chainbench/run.sh load-image-public <archive>"
}
KEYARGS=(); IMGENV=()
cmd=${1:-help}; [ "$#" -gt 0 ] && shift
case "$cmd" in
  build-image-public)   build_image ;;
  save-image-public)    save_image ;;
  load-image-public)    load_image "$@" ;;
  verify-image-public)  verify_image ;;
  doctor-public)        key_mount; run_in bridge node adapters/public/scripts/doctor_public.js "$@" ;;
  dry-run-public)       run_in none node adapters/public/scripts/dry_run_public.js "$@" ;;
  check-public-inputs)  run_in none python3 adapters/public/scripts/check_public_inputs.py ;;
  test-guards-public)   run_in none bash adapters/public/tools/test_guards_public.sh "$@" ;;
  derive-public)        root=${1:-build/campaigns/chain-public}; run_in none python3 ../scripts/analysis/derive_chain_public.py --root "../$root" --out "../$root/derived" --mode live ;;
  run-public-setup)     [ "$#" -ge 1 ] || die "usage: run-public-setup sepolia|era-sepolia"
                        frozen_image_pre "run-public-setup $1"; key_mount; confirm "setup-$1"
                        run_live "run-public-setup $1" node adapters/public/scripts/run_public.js --mode live --phase setup --network "$1" --confirm "setup-$1" ;;
  run-public-session)   [ "$#" -ge 1 ] || die "usage: run-public-session S1|S2|S3"
                        frozen_image_pre "run-public-session $1"; key_mount; confirm "$1"
                        run_live "run-public-session $1" node adapters/public/scripts/run_public.js --mode live --phase session --session "$1" --confirm "$1" ;;
  collect-era-finality) frozen_image_pre "collect-era-finality"
                        run_live "collect-era-finality" node adapters/public/scripts/collect_era_finality.js --mode live --root build/campaigns/chain-public "$@" ;;
  help|-h|--help)       usage ;;
  *) usage; die "unknown command '$cmd'" ;;
esac
