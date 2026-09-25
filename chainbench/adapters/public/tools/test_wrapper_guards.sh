#!/usr/bin/env bash
# CSI-CHAIN-PUBLIC-01: wrapper-level tests of the frozen-image guard and the host key-file rules through ./chainbench/run.sh.
# Host only (needs Docker and the frozen image loaded). No key (test files hold the text "not-a-key"), no network call,
# nothing signed or sent: every live command is refused before its container starts, or stops at the confirmation prompt
# (stdin is /dev/null). Temporarily edits build/chainbench/public/image/image.env (restored on exit) and moves the ledger
# lines it creates to build/chainbench/public/tests/. Refuses to run if a live IMAGE-LEDGER.jsonl already exists.
#   bash chainbench/adapters/public/tools/test_wrapper_guards.sh
set -uo pipefail
TOOLS=$(cd "$(dirname "$0")" && pwd -P); AD=$(cd "$TOOLS/.." && pwd -P); REPO=$(cd "$AD/../../.." && pwd -P)
RUN="$REPO/chainbench/run.sh"; ENVF="$REPO/build/chainbench/public/image/image.env"; LED="$REPO/build/campaigns/chain-public/IMAGE-LEDGER.jsonl"
OUTD="$REPO/build/chainbench/public/tests"; mkdir -p "$OUTD"; STAMP=$(date -u +%Y%m%dT%H%M%SZ)
[ -f "$LED" ] && { echo "[FAIL] $LED exists (live records present); wrapper tests are not run on a live ledger"; exit 2; }
[ -f "$ENVF" ] || { echo "[FAIL] no image.env; load the frozen image first"; exit 2; }
T=$(mktemp -d "${TMPDIR:-/tmp}/cb-wrapper-test.XXXXXX"); chmod 700 "$T"; cp "$ENVF" "$T/image.env.bak"
cleanup() { cp "$T/image.env.bak" "$ENVF"; [ -f "$LED" ] && mv "$LED" "$OUTD/IMAGE-LEDGER.wrapper-test-$STAMP.jsonl"; rmdir "$REPO/build/campaigns/chain-public/CONSOLE" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
unset CHAINBENCH_PUBLIC_KEY_FILE CHAINBENCH_PUBLIC_PRIVATE_KEY CHAINBENCH_PUBLIC_NATIVE CHAINBENCH_PUBLIC_DEVIATION
export CHAINBENCH_PUBLIC_RPC_SEPOLIA=https://127.0.0.1:9 CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA=https://127.0.0.1:9
pass=0; fail=0
t() {  # name, expect-regex, forbid-regex, command...
  local name=$1 want=$2 forbid=$3; shift 3
  local out; out=$("$@" </dev/null 2>&1); local st=$?
  if [ "$st" != 0 ] && printf '%s' "$out" | grep -Eq "$want" && { [ -z "$forbid" ] || ! printf '%s' "$out" | grep -Eq "$forbid"; }; then pass=$((pass+1)); echo "PASS $name"
  else fail=$((fail+1)); echo "FAIL $name (exit $st)"; printf '%s\n' "$out" | tail -4 | sed 's/^/     /'; fi
}
FROZEN=$(sed -n 's/^  "image_id": "\(.*\)",$/\1/p' "$AD/ARCHIVE.json")
out=$("$RUN" verify-image-public 2>&1); st=$?
if [ "$st" = 0 ] && printf '%s' "$out" | grep -q 'selected image (image.env) = the frozen image'; then pass=$((pass+1)); echo "PASS verify-image-public: the loaded and selected image is the frozen image $FROZEN"; else fail=$((fail+1)); echo "FAIL verify-image-public"; printf '%s\n' "$out" | sed 's/^/     /'; fi
NOPROMPT='Type (setup-|S1)'
printf 'IMAGE_ID=sha256:%064d\n' 0 > "$ENVF"
t "run-public-setup with another selected image -> refused before the key and the prompt" 'is not the frozen public image' "$NOPROMPT" "$RUN" run-public-setup sepolia
t "run-public-session with another selected image -> refused" 'is not the frozen public image' "$NOPROMPT" "$RUN" run-public-session S1
t "collect-era-finality with another selected image -> refused" 'is not the frozen public image' '' "$RUN" collect-era-finality
cp "$T/image.env.bak" "$ENVF"
t "run-public-setup natively (CHAINBENCH_PUBLIC_NATIVE=1) -> refused" 'run only in the frozen public image' "$NOPROMPT" env CHAINBENCH_PUBLIC_NATIVE=1 "$RUN" run-public-setup sepolia
out=$(env CHAINBENCH_PUBLIC_KEY_FILE="$T/none.key" "$RUN" run-public-setup sepolia </dev/null 2>&1); st=$?
if [ "$st" != 0 ] && printf '%s' "$out" | grep -q '\[PASS\] frozen public image' && printf '%s' "$out" | grep -q 'key_file_missing' && ! printf '%s' "$out" | grep -Eq "$NOPROMPT"; then
  pass=$((pass+1)); echo "PASS frozen image verified first, then the missing key file is refused (key_file_missing); no prompt"
else fail=$((fail+1)); echo "FAIL image-then-key order (exit $st)"; printf '%s\n' "$out" | tail -4 | sed 's/^/     /'; fi
mkdir -m 700 "$T/k"; printf 'not-a-key\n' > "$T/k/a.key"; chmod 644 "$T/k/a.key"
t "0644 key file -> key_file_permissions (this host's stat)" 'key_file_permissions' "$NOPROMPT" env CHAINBENCH_PUBLIC_KEY_FILE="$T/k/a.key" "$RUN" run-public-setup sepolia
mkdir -m 755 "$T/open"; printf 'not-a-key\n' > "$T/open/b.key"; chmod 600 "$T/open/b.key"
t "0600 key in a 0755 directory -> key_dir_unprotected" 'key_dir_unprotected' "$NOPROMPT" env CHAINBENCH_PUBLIC_KEY_FILE="$T/open/b.key" "$RUN" run-public-setup sepolia
ln -s "$T/k/a.key" "$T/k/link.key"
t "symbolic link as key file -> key_file_symlink" 'key_file_symlink' "$NOPROMPT" env CHAINBENCH_PUBLIC_KEY_FILE="$T/k/link.key" "$RUN" run-public-setup sepolia
chmod 600 "$T/k/a.key"
t "frozen image + acceptable key file: stops at the confirmation prompt (stdin closed), nothing sent" 'not confirmed; nothing was sent' '' env CHAINBENCH_PUBLIC_KEY_FILE="$T/k/a.key" "$RUN" run-public-setup sepolia
n=$(grep -c '"phase":"pre"' "$LED" 2>/dev/null); n=${n:-0}; r=$(grep -c '"result":"refused' "$LED" 2>/dev/null); r=${r:-0}
# 8 commands reached the image check (3 refused on the image, 5 passed it); the native refusal happens before any Docker call
[ "$n" -eq 8 ] && [ "$r" -eq 3 ] && { pass=$((pass+1)); echo "PASS IMAGE-LEDGER.jsonl records every pre-flight image check (8, of which 3 refusals; the native refusal precedes Docker)"; } || { fail=$((fail+1)); echo "FAIL ledger ($n pre, $r refused; expected 8 and 3)"; }
echo "WRAPPER-GUARD-TESTS $STAMP: $pass/$((pass+fail)) pass (frozen image $FROZEN); ledger lines moved to build/chainbench/public/tests/"
[ "$fail" = 0 ]
