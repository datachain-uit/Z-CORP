#!/usr/bin/env bash
# CSI-CHAIN-PUBLIC-01 PRE-FREEZE (author side, campaign Mac). Engineering records only. NOTHING is signed, sent or deployed;
# no campaign key is created, read or mounted; no test ether is spent. Records: build/chainbench/public/preflight/records/.
#   bash build/chainbench/public/preflight/tools/prefreeze_mac.sh image       rebuild at HEAD, save-image-public (writes ARCHIVE.json), inventory
#   bash build/chainbench/public/preflight/tools/prefreeze_mac.sh checks      in the frozen image: dry run, reviewer checks, guard tests, audit
#   bash build/chainbench/public/preflight/tools/prefreeze_mac.sh secondary   READ-ONLY compatibility of the Alchemy ZKsync Era Sepolia endpoint
#   bash build/chainbench/public/preflight/tools/prefreeze_mac.sh final       at the final candidate commit: verify image, dry run, reviewer checks, guard tests
set -uo pipefail
unset CHAINBENCH_PUBLIC_KEY_FILE CHAINBENCH_PUBLIC_PRIVATE_KEY CHAINBENCH_PUBLIC_NATIVE CHAINBENCH_PUBLIC_DEVIATION
unset CHAINBENCH_PUBLIC_RPC_SEPOLIA CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA
TOOLS=$(cd "$(dirname "$0")" && pwd -P); REPO=$(cd "$TOOLS/../../../../.." && pwd -P); cd "$REPO" || exit 1
PUB="$REPO/build/chainbench/public"; REC="$PUB/preflight/records"; AD="$REPO/chainbench/adapters/public"; STAMP=$(date -u +%Y%m%dT%H%M%SZ)
say() { printf '%s\n' "$*"; }; die() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || die "Docker is not running"
frozen() { sed -n 's/^  "image_id": "\(.*\)",$/\1/p' "$AD/ARCHIVE.json"; }
step() { local name=$1; shift; say "-- $name"; "$@" > "$D/$name.log" 2>&1; local st=$?; echo "$st" > "$D/$name.exit"; tail -2 "$D/$name.log"; return 0; }

phase_image() {
  D="$REC/prefreeze-image-$STAMP"; mkdir -p "$D"; say "== image phase -> ${D#$REPO/}"
  { say "head $(git rev-parse HEAD)"; git status --porcelain -- chainbench csi/protocols/chain csi/campaigns/chain/CSI-CHAIN-PUBLIC-01 scripts/analysis/derive_chain_public.py; } > "$D/git.txt"
  [ -e "$AD/ARCHIVE.json" ] && die "chainbench/adapters/public/ARCHIVE.json already exists; this phase writes it"
  docker version --format '{{json .}}' > "$D/docker-version.json" 2>&1
  step build-image-public ./chainbench/run.sh build-image-public
  [ "$(cat "$D/build-image-public.exit")" = 0 ] || die "build failed"
  step save-image-public ./chainbench/run.sh save-image-public
  [ "$(cat "$D/save-image-public.exit")" = 0 ] || die "save-image-public failed"
  cp "$AD/ARCHIVE.json" "$D/ARCHIVE.json"; cp "$PUB/image/image.env" "$D/image.env"
  local ID; ID=$(frozen)
  docker image inspect "$ID" > "$D/image-inspect.json"
  docker history --no-trunc --format '{{json .}}' "$ID" > "$D/image-history.jsonl" 2>&1
  docker run --rm --network none --mount "type=bind,source=$TOOLS,target=/tools,readonly" "$ID" node /tools/image_surface.js > "$D/image-surface.json" 2> "$D/image-surface.err"
  docker run --rm --network none "$ID" npm ls --all --json > "$D/npm-ls.json" 2> "$D/npm-ls.err"
  step verify-image-public ./chainbench/run.sh verify-image-public
  say "IMAGE: $ID; records ${D#$REPO/}"
}
phase_checks() {
  D="$REC/prefreeze-checks-$STAMP"; mkdir -p "$D"; say "== checks phase (frozen image $(frozen)) -> ${D#$REPO/}"
  git rev-parse HEAD > "$D/head.txt"; git status --porcelain -- chainbench csi/protocols/chain > "$D/git-status.txt"
  step verify-image-public ./chainbench/run.sh verify-image-public
  local before; before=$(ls -1 "$PUB/dry-run" 2>/dev/null | sort)
  step dry-run-public ./chainbench/run.sh dry-run-public
  comm -13 <(printf '%s\n' "$before") <(ls -1 "$PUB/dry-run" | sort) > "$D/dry-run-id.txt"
  step check-public-inputs ./chainbench/run.sh check-public-inputs
  step doctor-offline ./chainbench/run.sh doctor-public --offline
  step test-guards-image ./chainbench/run.sh test-guards-public
  step test-keyfile-mac-host bash chainbench/adapters/public/tools/test_keyfile.sh
  step test-wrapper-guards bash chainbench/adapters/public/tools/test_wrapper_guards.sh
  local ID; ID=$(frozen)
  step endpoint-rule docker run --rm --network none --mount "type=bind,source=$REPO,target=/repo,readonly" --mount "type=volume,target=/repo/chainbench/adapters/public/node_modules" \
    -w /repo/chainbench "$ID" node /repo/build/chainbench/public/preflight/tools/endpoint_rule_check.js
  docker run --rm --network bridge "$ID" npm audit --json > "$D/npm-audit.json" 2> "$D/npm-audit.err"; echo "$?" > "$D/npm-audit.exit"
  docker run --rm --network bridge "$ID" npm audit signatures > "$D/npm-audit-signatures.txt" 2>&1; echo "$?" > "$D/npm-audit-signatures.exit"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$D/audit_utc.txt"
  say "records ${D#$REPO/}"
}
phase_secondary() {
  local ID; ID=$(frozen); [ -n "$ID" ] || die "no frozen image record yet (run the image phase first)"
  printf 'Alchemy ZKsync Era Sepolia https endpoint (input hidden; never printed or stored; only host + sha256 are recorded): '
  read -r -s CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA_SECONDARY; printf '\n'
  case "$CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA_SECONDARY" in https://*) ;; *) die "the endpoint must start with https://";; esac
  printf 'Provider label (expected: Alchemy): '; read -r CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA_SECONDARY
  [ -n "$CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA_SECONDARY" ] || die "a provider label is required"
  export CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA_SECONDARY CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA_SECONDARY
  D="$REC/prefreeze-secondary-$STAMP"; mkdir -p "$D"; say "== secondary READ-ONLY phase (frozen image $ID; no key; nothing signed or sent) -> ${D#$REPO/}"
  printf 'host_utc_before %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$D/clock.txt"
  docker run --rm --network bridge -e HOME=/tmp -e CHAINBENCH_CAMPAIGN=CSI-CHAIN-PUBLIC-01 -e CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA_SECONDARY -e CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA_SECONDARY \
    -e "CHAINBENCH_PUBLIC_IMAGE_ID=$ID" -e CHAINBENCH_PUBLIC_IMAGE_CHECK=frozen-record-id \
    --mount "type=bind,source=$REPO,target=/repo,readonly" --mount "type=volume,target=/repo/chainbench/adapters/public/node_modules" \
    --mount "type=bind,source=$PUB,target=/repo/build/chainbench/public" -w /repo/chainbench "$ID" \
    node adapters/public/tools/rpc_compat_public.js --networks era-sepolia --secondary --errors --out "/repo/build/chainbench/public/preflight/records/prefreeze-secondary-$STAMP/rpc-compat-secondary.json" > "$D/rpc-compat.log" 2>&1
  echo "$?" > "$D/rpc-compat.exit"; cat "$D/rpc-compat.log"
  printf 'host_utc_after %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$D/clock.txt"
  if grep -rqF -- "$CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA_SECONDARY" "$D" 2>/dev/null; then say "[WARN] the URL text appears in a record; do not share $D"; else say "URL check: the secondary URL does not appear in any record"; fi
}
phase_final() {
  D="$REC/prefreeze-final-$STAMP"; mkdir -p "$D"; say "== final phase at $(git rev-parse --short HEAD) (frozen image $(frozen)) -> ${D#$REPO/}"
  git rev-parse HEAD > "$D/head.txt"; git status --porcelain -- chainbench csi/protocols/chain csi/campaigns/chain/CSI-CHAIN-PUBLIC-01/inputs scripts/analysis/derive_chain_public.py > "$D/git-status.txt"
  step verify-image-public ./chainbench/run.sh verify-image-public
  local before; before=$(ls -1 "$PUB/dry-run" 2>/dev/null | sort)
  step dry-run-public ./chainbench/run.sh dry-run-public
  comm -13 <(printf '%s\n' "$before") <(ls -1 "$PUB/dry-run" | sort) > "$D/dry-run-id.txt"
  step check-public-inputs ./chainbench/run.sh check-public-inputs
  step doctor-offline ./chainbench/run.sh doctor-public --offline
  step test-guards-image ./chainbench/run.sh test-guards-public
  step test-wrapper-guards bash chainbench/adapters/public/tools/test_wrapper_guards.sh
  say "records ${D#$REPO/}"
}
case "${1:-}" in image) phase_image ;; checks) phase_checks ;; secondary) phase_secondary ;; final) phase_final ;; *) sed -n '2,9p' "$0"; exit 2 ;; esac
