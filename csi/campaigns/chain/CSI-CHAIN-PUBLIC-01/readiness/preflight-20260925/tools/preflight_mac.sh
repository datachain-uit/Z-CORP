#!/usr/bin/env bash
# CSI-CHAIN-PUBLIC-01 FINAL PRE-FLIGHT (author side, campaign Mac). Engineering records only. NOTHING is signed, sent or
# deployed, no key is created, read or mounted, and no test ether is spent. Run from anywhere; records go to
# build/chainbench/public/preflight/records/<phase>-<UTC stamp>/ (git-ignored).
#   bash build/chainbench/public/preflight/tools/preflight_mac.sh image    final image: build, identity, dependency graph, docker save
#   bash build/chainbench/public/preflight/tools/preflight_mac.sh checks   in the final image: dry-run-public, check-public-inputs,
#                                                                          doctor-public --offline, endpoint rule, npm audit
#   bash build/chainbench/public/preflight/tools/preflight_mac.sh live     live READ-ONLY doctor-public + RPC compatibility probe
# 'live' asks for the Sepolia https endpoint without echoing it (the URL may contain an API key; only its host and sha256
# are recorded) and for its provider label; Era Sepolia uses the binding default https://sepolia.era.zksync.dev.
set -uo pipefail
unset CHAINBENCH_PUBLIC_KEY_FILE CHAINBENCH_PUBLIC_PRIVATE_KEY CHAINBENCH_PUBLIC_NATIVE CHAINBENCH_PUBLIC_DEVIATION
TOOLS=$(cd "$(dirname "$0")" && pwd -P)
REPO=$(cd "$TOOLS/../../../../.." && pwd -P)
cd "$REPO" || exit 1
PUB="$REPO/build/chainbench/public"
REC="$PUB/preflight/records"
TAG="chainbench-public:local"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
say()  { printf '%s\n' "$*"; }
die()  { printf '[FAIL] %s\n' "$*" >&2; exit 1; }
image_id() { sed -n 's/^IMAGE_ID=//p' "$PUB/image/image.env" 2>/dev/null; }
need_image() {
  ID=$(image_id); [ -n "$ID" ] || die "no chainbench-public image recorded; run the 'image' phase first"
  [ "$(docker image inspect --format '{{.Id}}' "$TAG" 2>/dev/null)" = "$ID" ] || die "$TAG is not the recorded image $ID"
}
# the same mounts as run-public.sh run_in (repository read-only; node_modules from the image; public build dir writable)
drun() {
  local net=$1; shift
  docker run --rm --network "$net" -e HOME=/tmp -e CHAINBENCH_CAMPAIGN=CSI-CHAIN-PUBLIC-01 "${ENVS[@]}" \
    --mount "type=bind,source=$REPO,target=/repo,readonly" \
    --mount "type=volume,target=/repo/chainbench/adapters/public/node_modules" \
    --mount "type=bind,source=$PUB,target=/repo/build/chainbench/public" \
    -w /repo/chainbench "$ID" "$@"
}
ENVS=(-e CHAINBENCH_PUBLIC_PREFLIGHT=1)
command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || die "Docker is not running"

phase_image() {
  local D="$REC/image-$STAMP"; mkdir -p "$D"
  say "== image phase -> ${D#$REPO/}"
  { say "head $(git rev-parse HEAD)"; say "branch $(git rev-parse --abbrev-ref HEAD)"; say "status of tracked paths:";
    git status --porcelain -- chainbench csi/protocols/chain csi/campaigns/chain/CSI-CHAIN-PUBLIC-01 scripts/analysis/derive_chain_public.py; } > "$D/git.txt"
  docker version --format '{{json .}}' > "$D/docker-version.json" 2>&1
  docker info --format '{{json .ServerVersion}} {{json .OperatingSystem}} {{json .Architecture}} {{json .Driver}} {{json .DriverStatus}} {{json .NCPU}} {{json .MemTotal}}' > "$D/docker-info.txt" 2>&1
  . "$REPO/chainbench/adapters/public/pins.env"
  say "-- build-image-public (network: apt + npm registry once)"
  ./chainbench/run.sh build-image-public > "$D/build.log" 2>&1; local st=$?
  tail -3 "$D/build.log"
  [ "$st" = 0 ] || die "image build failed; see ${D#$REPO/}/build.log"
  cp "$PUB/image/image.env" "$D/image.env"
  need_image
  docker image inspect "$BASE_IMAGE_REPO@$BASE_IMAGE_DIGEST" > "$D/base-image-inspect.json" 2>&1
  docker image inspect "$ID" > "$D/image-inspect.json"
  docker history --no-trunc --format '{{json .}}' "$ID" > "$D/image-history.jsonl" 2>&1
  shasum -a 256 chainbench/adapters/public/package-lock.json chainbench/adapters/public/package.json chainbench/adapters/public/Dockerfile chainbench/adapters/public/pins.env > "$D/repo-files.sha256"
  say "-- inventory of the image itself (no repository mount, no network)"
  docker run --rm --network none --mount "type=bind,source=$TOOLS,target=/tools,readonly" "$ID" node /tools/image_surface.js > "$D/image-surface.json" 2> "$D/image-surface.err"
  docker run --rm --network none "$ID" npm ls --all --json > "$D/npm-ls.json" 2> "$D/npm-ls.err"
  docker run --rm --network none "$ID" npm ls --all --parseable --long > "$D/npm-ls.txt" 2>> "$D/npm-ls.err"
  local ARCH; ARCH=$(docker image inspect --format '{{.Architecture}}' "$ID")
  local ADIR="$PUB/release/image" F; mkdir -p "$ADIR"; F="$ADIR/chainbench-public-$ARCH.oci.tar"
  [ -e "$F" ] && die "${F#$REPO/} already exists (archives are never overwritten); move it aside first"
  say "-- docker save $TAG ($ID) -> ${F#$REPO/} (git-ignored)"
  docker save -o "$F" "$TAG" || die "docker save failed"
  shasum -a 256 "$F" | sed "s#$REPO/##" > "$D/archive.sha256"
  wc -c < "$F" | tr -d ' ' > "$D/archive.bytes"
  tar -tvf "$F" > "$D/archive-listing.txt"
  tar -xOf "$F" index.json > "$D/archive-index.json" 2>/dev/null
  tar -xOf "$F" manifest.json > "$D/archive-manifest.json" 2>/dev/null
  printf '%s\n' "${F#$REPO/}" > "$D/archive.path"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$D/saved_utc.txt"
  say "IMAGE: $ID ($ARCH); archive $(cat "$D/archive.bytes") bytes sha256 $(cut -d' ' -f1 "$D/archive.sha256")"
  say "records: ${D#$REPO/}"
}

phase_checks() {
  need_image
  local D="$REC/checks-$STAMP"; mkdir -p "$D"
  say "== checks phase in image $ID -> ${D#$REPO/}"
  git rev-parse HEAD > "$D/head.txt"
  say "-- dry-run-public (container, --network none)"
  local before; before=$(ls -1 "$PUB/dry-run" 2>/dev/null | sort)
  env -u CHAINBENCH_PUBLIC_RPC_SEPOLIA -u CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA ./chainbench/run.sh dry-run-public > "$D/dry-run.log" 2>&1; echo "$?" > "$D/dry-run.exit"
  comm -13 <(printf '%s\n' "$before") <(ls -1 "$PUB/dry-run" | sort) > "$D/dry-run-id.txt"
  tail -2 "$D/dry-run.log"
  say "-- check-public-inputs (container, --network none)"
  ./chainbench/run.sh check-public-inputs > "$D/check-public-inputs.log" 2>&1; echo "$?" > "$D/check-public-inputs.exit"; tail -1 "$D/check-public-inputs.log"
  say "-- doctor-public --offline (container, no key, no endpoint)"
  env -u CHAINBENCH_PUBLIC_RPC_SEPOLIA -u CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA -u CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA -u CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA \
    ./chainbench/run.sh doctor-public --offline > "$D/doctor-offline.log" 2>&1; echo "$?" > "$D/doctor-offline.exit"; tail -1 "$D/doctor-offline.log"
  say "-- endpoint rule in the image (ws/wss/http/loopback refused)"
  drun none node /repo/build/chainbench/public/preflight/tools/endpoint_rule_check.js > "$D/endpoint-rule.log" 2>&1; echo "$?" > "$D/endpoint-rule.exit"; tail -1 "$D/endpoint-rule.log"
  say "-- dependency audit in the image (npm registry only)"
  docker run --rm --network bridge "$ID" npm audit --json > "$D/npm-audit.json" 2> "$D/npm-audit.err"; echo "$?" > "$D/npm-audit.exit"
  docker run --rm --network bridge "$ID" npm audit signatures > "$D/npm-audit-signatures.txt" 2>&1; echo "$?" > "$D/npm-audit-signatures.exit"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$D/audit_utc.txt"
  say "records: ${D#$REPO/}"
}

phase_live() {
  need_image
  if [ -z "${CHAINBENCH_PUBLIC_RPC_SEPOLIA:-}" ]; then
    printf 'Sepolia https endpoint (input hidden; not printed or recorded, only host + sha256): '
    read -r -s CHAINBENCH_PUBLIC_RPC_SEPOLIA; printf '\n'
  fi
  case "$CHAINBENCH_PUBLIC_RPC_SEPOLIA" in https://*) ;; *) die "the Sepolia endpoint must start with https://";; esac
  if [ -z "${CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA:-}" ]; then printf 'Sepolia provider label (e.g. the provider name): '; read -r CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA; fi
  [ -n "$CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA" ] || die "a Sepolia provider label is required"
  unset CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA   # Era Sepolia: the binding default https://sepolia.era.zksync.dev (no substitution)
  export CHAINBENCH_PUBLIC_RPC_SEPOLIA CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA
  [ -n "${CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA:-}" ] && export CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA
  local D="$REC/live-$STAMP"; mkdir -p "$D"
  say "== live READ-ONLY phase in image $ID -> ${D#$REPO/} (no key; nothing is signed or sent)"
  printf 'host_utc_before %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$D/clock.txt"
  say "-- doctor-public (live, read-only)"
  local before; before=$(ls -1 "$PUB/doctor" 2>/dev/null | sort)
  ./chainbench/run.sh doctor-public > "$D/doctor-live.log" 2>&1; echo "$?" > "$D/doctor-live.exit"
  comm -13 <(printf '%s\n' "$before") <(ls -1 "$PUB/doctor" | sort) > "$D/doctor-report.txt"
  while read -r f; do [ -n "$f" ] && cp "$PUB/doctor/$f" "$D/"; done < "$D/doctor-report.txt"
  cat "$D/doctor-live.log"
  say "-- RPC compatibility probe (read-only; keyless probe address)"
  ENVS=(-e CHAINBENCH_PUBLIC_RPC_SEPOLIA -e CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA)
  [ -n "${CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA:-}" ] && ENVS+=(-e CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA)
  drun bridge node /repo/build/chainbench/public/preflight/tools/rpc_probe.js --out "/repo/build/chainbench/public/preflight/records/live-$STAMP/rpc-probe.json" > "$D/rpc-probe.log" 2>&1
  echo "$?" > "$D/rpc-probe.exit"
  cat "$D/rpc-probe.log"
  printf 'host_utc_after %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$D/clock.txt"
  if grep -rqF -- "$CHAINBENCH_PUBLIC_RPC_SEPOLIA" "$D" "$PUB/doctor" 2>/dev/null; then say "[WARN] the Sepolia URL text appears in a record; do not share $D before checking"; else say "URL check: the Sepolia URL does not appear in any record"; fi
  say "records: ${D#$REPO/}"
}

case "${1:-}" in
  image)  phase_image ;;
  checks) phase_checks ;;
  live)   phase_live ;;
  *) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
