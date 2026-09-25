#!/usr/bin/env bash
# CSI-CHAIN-PUBLIC-01: reviewer-runnable tests of the pre-freeze guards; no key, no network, no transaction.
#   ./chainbench/run.sh test-guards-public        (in the image, --network none)   or natively:  bash chainbench/adapters/public/tools/test_guards_public.sh
# 1. host key-file rules on the GNU and BSD stat branches (tools/test_keyfile.sh);
# 2. frozen-image record and live image guard, runner/collector refusal order, endpoint/fallback policy, derivation
#    checks VP12/VP13 (tools/test_guards_public.js).
# The wrapper-level image checks that need Docker are in tools/test_wrapper_guards.sh (host only). These tests are
# separate from the 92 dry-run expectations. A JSON result is written to build/chainbench/public/tests/.
set -uo pipefail
TOOLS=$(cd "$(dirname "$0")" && pwd -P); AD=$(cd "$TOOLS/.." && pwd -P); REPO=$(cd "$AD/../../.." && pwd -P)
OUT="$REPO/build/chainbench/public/tests"; mkdir -p "$OUT" 2>/dev/null || OUT=$(mktemp -d)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
bash "$TOOLS/test_keyfile.sh" > "$OUT/keyfile-$STAMP.txt" 2>&1; k=$?
cat "$OUT/keyfile-$STAMP.txt"
(cd "$REPO/chainbench" && CB_GUARD_JSON="$OUT/guards-node-$STAMP.json" node adapters/public/tools/test_guards_public.js) > "$OUT/guards-node-$STAMP.txt" 2>&1; n=$?
cat "$OUT/guards-node-$STAMP.txt"
kp=$(grep -c '^PASS' "$OUT/keyfile-$STAMP.txt"); kt=$(grep -c -E '^(PASS|FAIL)' "$OUT/keyfile-$STAMP.txt")
np=$(grep -c '^PASS' "$OUT/guards-node-$STAMP.txt"); nt=$(grep -c -E '^(PASS|FAIL)' "$OUT/guards-node-$STAMP.txt"); ns=$(grep -c '^SKIP' "$OUT/guards-node-$STAMP.txt")
printf 'GUARD-TESTS %s: key-file %d/%d, image/runner/endpoint/derive %d/%d (%d skipped), node %s -> %s\n' "$STAMP" "$kp" "$kt" "$np" "$nt" "$ns" "$(node --version 2>/dev/null)" "${OUT#$REPO/}"
[ "$k" = 0 ] && [ "$n" = 0 ]
