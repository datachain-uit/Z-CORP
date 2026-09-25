#!/usr/bin/env bash
# CSI-CHAIN-PUBLIC-01: verify the dedicated key file WITHOUT printing it. AUTHOR ONLY. No network; nothing signed or sent.
#   bash chainbench/adapters/public/tools/verify_public_key.sh "$HOME/.chainbench-keys/csi-chain-public-01.key" 0x<ADDRESS>
# Host side, exactly the live wrapper's rules (lib/guards.sh cb_key_file_check): absolute path, not a symbolic link,
# regular file, outside the repository, owned by you, mode 0600/0400, directory yours with no group/other access; not
# tracked by git. In the frozen public image (--network none, key mounted read-only as run-public.sh does): the runner's
# own lib/keysafety.js loadSigner (0x-hex format, secp256k1 validity, refusal of the first 20 accounts of the development
# mnemonics and the legacy rich wallets); the derived address is compared with EXPECTED_ADDRESS. Only PASS/FAIL lines and
# the public address are printed. CHAINBENCH_PUBLIC_NATIVE=1 uses the host's Node (tests only).
set -uo pipefail
TOOLS=$(cd "$(dirname "$0")" && pwd -P); AD=$(cd "$TOOLS/.." && pwd -P); REPO=$(cd "$AD/../../.." && pwd -P)
. "$AD/lib/guards.sh"
say() { printf '%s\n' "$*"; }
fail=0; chk() { if [ "$1" = ok ]; then say "PASS $2"; else say "FAIL $2"; fail=1; fi; }
KEY=${1:-}; WANT=${2:-}
[ -n "$KEY" ] || { say "usage: verify_public_key.sh /absolute/path/to/key [EXPECTED_ADDRESS]"; exit 2; }
if REAL=$(cb_key_file_check "$KEY" "$REPO"); then
  chk ok "host key-file rules (absolute, not a symlink, regular, outside the repository, yours, mode $(cb_file_mode "$REAL"), directory $(cb_file_mode "$(dirname "$REAL")"))"
else chk no "host key-file rules: $REAL"; say "KEY-VERIFY: FAIL (the key was not printed)"; exit 1; fi
( cd "$REPO" && git ls-files --error-unmatch -- "$REAL" >/dev/null 2>&1 ) && chk no "not tracked by git" || chk ok "not tracked by git"
CHECK='const {loadSigner,devAccounts}=require("./adapters/public/lib/keysafety");
try{const s=loadSigner(process.env.REPOPATH);console.log("SIGNER "+s.address+" "+devAccounts(process.env.REPOPATH).size);}
catch(e){console.log("REFUSED "+(e.code||"error"));process.exit(1);}'
if [ "${CHAINBENCH_PUBLIC_NATIVE:-0}" = 1 ]; then
  say "TEST MODE (CHAINBENCH_PUBLIC_NATIVE=1): host Node, not the frozen image"
  OUT=$(cd "$REPO/chainbench" && env -u CHAINBENCH_PUBLIC_PRIVATE_KEY CHAINBENCH_PUBLIC_KEY_FILE="$REAL" REPOPATH="$REPO" node -e "$CHECK" 2>/dev/null)
else
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || { say "FAIL Docker is not running"; exit 1; }
  if V=$(cb_image_verify "$AD/ARCHIVE.json"); then chk ok "frozen public image $(cb_json_get image_id "$AD/ARCHIVE.json")"; else chk no "frozen public image: $V"; say "KEY-VERIFY: FAIL (the key was not printed)"; exit 1; fi
  ID=$(cb_json_get image_id "$AD/ARCHIVE.json")
  U=(); [ "$(uname -s)" = Linux ] && U=(--user "$(id -u):$(id -g)")
  OUT=$(docker run --rm --network none ${U[@]+"${U[@]}"} -e HOME=/tmp -e REPOPATH=/repo -e CHAINBENCH_PUBLIC_KEY_FILE=/run/secrets/chainbench_public_key \
    --mount "type=bind,source=$REAL,target=/run/secrets/chainbench_public_key,readonly" \
    --mount "type=bind,source=$REPO,target=/repo,readonly" --mount "type=volume,target=/repo/chainbench/adapters/public/node_modules" \
    -w /repo/chainbench "$ID" node -e "$CHECK" 2>/dev/null)
fi
case "$OUT" in
  "SIGNER 0x"*) ADDR=$(printf '%s' "$OUT" | awk '{print $2}'); N=$(printf '%s' "$OUT" | awk '{print $3}')
               case "$ADDR" in 0x????????????????????????????????????????) ;; *) ADDR="";; esac
               [ -n "$ADDR" ] && chk ok "key-safety rules: valid 0x-hex secp256k1 key, not one of $N development accounts; address $ADDR" || chk no "unexpected output (suppressed)";;
  "REFUSED "*) chk no "key-safety rules refused the key: ${OUT#REFUSED }";;
  *) chk no "key-safety check did not run (output suppressed)";;
esac
if [ -n "$WANT" ] && [ -n "${ADDR:-}" ]; then
  [ "$(printf '%s' "$ADDR" | tr 'A-F' 'a-f')" = "$(printf '%s' "$WANT" | tr 'A-F' 'a-f')" ] && chk ok "address equals the expected $WANT" || chk no "address $ADDR differs from the expected $WANT"
fi
[ "$fail" = 0 ] && say "KEY-VERIFY: PASS (the key was not printed)" || say "KEY-VERIFY: FAIL (the key was not printed)"
exit "$fail"
