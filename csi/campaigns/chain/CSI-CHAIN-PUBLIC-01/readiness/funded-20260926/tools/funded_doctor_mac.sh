#!/usr/bin/env bash
# CSI-CHAIN-PUBLIC-01, pre-baseline funding verification (engineering record; not scientific data). AUTHOR, campaign Mac.
#   bash csi/campaigns/chain/CSI-CHAIN-PUBLIC-01/readiness/funded-20260926/tools/funded_doctor_mac.sh <expected HEAD commit>
# Strictly read-only: key check (no network), frozen image check, then ./chainbench/run.sh doctor-public, which only reads
# chain id, blocks, fees, the signer's balance and nonces. Nothing is signed, sent or deployed; no eth_sendRawTransaction.
# The Sepolia URL is read with hidden input, checked against the frozen host and URL sha256 before use, passed to the
# container by name only, never printed or stored; afterwards every output is searched for it and for its last path segment.
set -uo pipefail
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel) || exit 1
cd "$REPO" || exit 1
SIGNER=0x6C58f325404dFF6c860034ceDA59D1de789Ac2E3
KEY="$HOME/.chainbench-keys/csi-chain-public-01.key"
SEP_HOST=eth-sepolia.g.alchemy.com
SEP_SHA=d020365e52fcb294a6f7da7658481c30fb2f4144d2cac3fdd97697cbe33dee10
ERA_URL=https://sepolia.era.zksync.dev
EXPECT=${1:-}
OUT="build/chainbench/public/funded-doctor/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT" || exit 1
LOG="$OUT/funded-doctor.log"
say() { printf '%s\n' "$*" | tee -a "$LOG"; }
die() { U=; K=; unset CHAINBENCH_PUBLIC_RPC_SEPOLIA; say "STOP: $*"; exit 1; }
unset CHAINBENCH_PUBLIC_PRIVATE_KEY CHAINBENCH_PUBLIC_RPC_SEPOLIA CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA \
      CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA CHAINBENCH_PUBLIC_DEVIATION CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA_SECONDARY \
      CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA_SECONDARY CHAINBENCH_PUBLIC_NATIVE
say "funded doctor $(date -u +%Y-%m-%dT%H:%M:%SZ) host $(uname -sm)"

# 0. commit and clean tracked campaign state
HEAD=$(git rev-parse HEAD)
[ -n "$EXPECT" ] || die "give the expected HEAD commit as the first argument"
[ "$HEAD" = "$(git rev-parse "$EXPECT^{commit}" 2>/dev/null)" ] || die "HEAD $HEAD is not the expected commit $EXPECT"
# a superset of the binding's tracked_paths (all of chainbench/), plus the entry directory and the registry
DIRTY=$(git status --porcelain -- contracts chainbench csi/protocols/chain/CHAIN-PUBLIC-PROTOCOL-v1.md csi/campaigns/chain/CSI-CHAIN-PUBLIC-01 \
        csi/campaigns/chain/CSI-CHAIN-LOCAL-01/inputs/proofset scripts/analysis/derive_chain_public.py csi/campaign-index.csv)
[ -z "$DIRTY" ] || die "tracked campaign paths are not clean: $(printf '%s' "$DIRTY" | head -3 | tr '\n' ' ')"
say "PASS HEAD $HEAD; campaign paths clean (contracts, chainbench/, protocol, entry directory, PS-01, derivation, registry)"

# 1. key (tracked tool; no network; only PASS/FAIL lines and the address are printed)
bash chainbench/adapters/public/tools/verify_public_key.sh "$KEY" "$SIGNER" 2>&1 | tee -a "$LOG"
[ "${PIPESTATUS[0]}" = 0 ] || die "key verification failed"

# 2. frozen public image
./chainbench/run.sh verify-image-public 2>&1 | tee -a "$LOG"
[ "${PIPESTATUS[0]}" = 0 ] || die "frozen public image verification failed"

# 3. the Sepolia URL: hidden input, checked before use
printf 'Ethereum Sepolia URL (the same Alchemy URL validated on 2026-09-25; input is hidden): '
IFS= read -r -s U; printf '\n'
case "$U" in https://*) ;; *) die "the URL must start with https:// (nothing was used)";; esac
H=$(printf '%s' "$U" | sed -E 's#^https://([^/:?]+).*#\1#')
S=$(printf '%s' "$U" | shasum -a 256 | awk '{print $1}')
[ "$H" = "$SEP_HOST" ] || die "host $H is not the frozen $SEP_HOST (nothing was used)"
[ "$S" = "$SEP_SHA" ] || die "the URL does not hash to the frozen sha256 (got ${S:0:12}…; nothing was used)"
K=${U##*/}
say "PASS Sepolia URL = frozen primary: host $H, sha256 $S (the URL itself is not printed or stored)"

# 4. funded read-only doctor (frozen primaries only; no secondary, no deviation)
export CHAINBENCH_PUBLIC_KEY_FILE="$KEY" CHAINBENCH_PUBLIC_RPC_SEPOLIA="$U" CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA="$ERA_URL"
./chainbench/run.sh doctor-public 2>&1 | tee -a "$LOG"
RC=${PIPESTATUS[0]}
unset CHAINBENCH_PUBLIC_RPC_SEPOLIA
REPORT=$(grep -o 'report build/chainbench/public/doctor/doctor-[0-9TZ]*\.json' "$LOG" | tail -1 | awk '{print $2}')

# 5. the URL must appear nowhere
LEAK=0
for f in "$LOG" build/chainbench/public/doctor build/campaigns/chain-public; do
  [ -e "$f" ] || continue
  grep -rqF -f <(printf '%s\n' "$U") "$f" 2>/dev/null && LEAK=1          # pattern via a file descriptor, never on a command line
  [ "${#K}" -ge 12 ] && grep -rqF -f <(printf '%s\n' "$K") "$f" 2>/dev/null && LEAK=1
done
U=; K=
[ "$LEAK" = 0 ] || die "the URL text appears in an output: do not share $OUT, build/chainbench/public/doctor or build/campaigns/chain-public; tell Claude"
say "PASS the Sepolia URL and its key segment appear in no output"
[ -n "$REPORT" ] && [ -f "$REPORT" ] || die "doctor report not found (doctor exit $RC)"
cp "$REPORT" "$OUT/" && (cd "$OUT" && shasum -a 256 ./*.json | tee -a funded-doctor.log)
say "doctor exit $RC; report $REPORT; copy and log in $OUT"
say "Nothing was signed or sent. Reply to Claude: đã chạy xong"
