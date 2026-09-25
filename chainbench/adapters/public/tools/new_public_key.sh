#!/usr/bin/env bash
# CSI-CHAIN-PUBLIC-01: create the dedicated campaign signing key. AUTHOR ONLY, on the campaign host. Canonical command:
#   bash chainbench/adapters/public/tools/new_public_key.sh "$HOME/.chainbench-keys/csi-chain-public-01.key"
# The key is generated inside the frozen public image (verified against chainbench/adapters/public/ARCHIVE.json; run by
# digest with --network none and only the key directory mounted): Node crypto.randomBytes with rejection sampling into
# the secp256k1 range, written straight into the given file, created exclusively (O_CREAT|O_EXCL, never overwritten) with
# mode 0600, in a directory outside the repository that is yours with no group/other access (created 0700 if absent).
# The key is never printed, logged, returned or put on a command line: the only output is the public address (also saved
# as <file>.address). The created file is then checked with the same host rules as the live wrapper (lib/guards.sh).
# Nothing is funded, signed or sent. CHAINBENCH_PUBLIC_NATIVE=1 generates with the host's Node instead (tests only; not
# the canonical procedure).
set -uo pipefail
umask 077
TOOLS=$(cd "$(dirname "$0")" && pwd -P); AD=$(cd "$TOOLS/.." && pwd -P); REPO=$(cd "$AD/../../.." && pwd -P)
. "$AD/lib/guards.sh"
say() { printf '%s\n' "$*"; }
die() { printf '[FAIL] %s\n' "$*" >&2; exit 2; }
KEY=${1:-}
case "$KEY" in /*) ;; *) die "usage: new_public_key.sh /absolute/path/outside/the/repository/<name>.key";; esac
DIR=$(dirname "$KEY"); NAME=$(basename "$KEY")
case "$NAME" in ''|*[!A-Za-z0-9._-]*) die "use a plain file name made of A-Z a-z 0-9 . _ -";; esac
if [ ! -d "$DIR" ]; then mkdir -p "$DIR" && chmod 700 "$DIR" || die "cannot create $DIR"; fi
RDIR=$(cd "$DIR" && pwd -P)
RREPO=$(cd "$REPO" && pwd -P)
case "$RDIR/" in "$RREPO"/*) die "$RDIR is inside the repository; choose a directory outside it";; esac
[ -L "$RDIR/$NAME" ] || [ -e "$RDIR/$NAME" ] && die "$RDIR/$NAME already exists (a key file is never overwritten)"
DM=$(cb_file_mode "$RDIR") || die "cannot read the permissions of $RDIR"
DU=$(cb_file_uid "$RDIR") || die "cannot read the owner of $RDIR"
[ "$DU" = "$(id -u)" ] || die "$RDIR is not owned by you (uid $DU)"
case "$DM" in *[0-7]00) ;; *) die "$RDIR has mode $DM; use a directory with no group/other access (chmod 700), e.g. \$HOME/.chainbench-keys";; esac
GEN='const fs=require("fs"),crypto=require("crypto"),{ethers}=require("ethers");
const N=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;let b,k;
do{b=crypto.randomBytes(32);k=BigInt("0x"+b.toString("hex"));}while(k===0n||k>=N);
const f=process.env.KEYOUT;const a=new ethers.Wallet("0x"+b.toString("hex")).address;
const fd=fs.openSync(f,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
fs.writeSync(fd,"0x"+b.toString("hex")+"\n");fs.fsyncSync(fd);fs.closeSync(fd);fs.chmodSync(f,0o600);b.fill(0);k=0n;
process.stdout.write(a+"\n");'
if [ "${CHAINBENCH_PUBLIC_NATIVE:-0}" = 1 ]; then
  say "TEST MODE (CHAINBENCH_PUBLIC_NATIVE=1): generated with the host's Node, not in the frozen image; not the canonical procedure"
  ADDR=$(cd "$AD" && KEYOUT="$RDIR/$NAME" node -e "$GEN" 2>/dev/null)
else
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || die "Docker is not running"
  V=$(cb_image_verify "$AD/ARCHIVE.json") || die "frozen public image: $V"
  ID=$(cb_json_get image_id "$AD/ARCHIVE.json")
  say "[PASS] frozen public image $ID"
  U=(); [ "$(uname -s)" = Linux ] && U=(--user "$(id -u):$(id -g)")
  ADDR=$(docker run --rm --network none ${U[@]+"${U[@]}"} -e KEYOUT="/keys/$NAME" --mount "type=bind,source=$RDIR,target=/keys" \
    -w /repo/chainbench/adapters/public "$ID" node -e "$GEN" 2>/dev/null)
fi
st=$?
case "$ADDR" in 0x????????????????????????????????????????) ;; *) ADDR="";; esac
if [ "$st" != 0 ] || [ -z "$ADDR" ] || [ ! -f "$RDIR/$NAME" ]; then die "key generation failed (no output is shown; nothing was printed)"; fi
chmod 600 "$RDIR/$NAME"
printf '%s\n' "$ADDR" > "$RDIR/$NAME.address"; chmod 600 "$RDIR/$NAME.address"
CHK=$(cb_key_file_check "$RDIR/$NAME" "$REPO") || die "the key file was created but violates a key-file rule: $CHK (fix it before use)"
say "signer address: $ADDR"
say "key file:       $RDIR/$NAME (mode $(cb_file_mode "$RDIR/$NAME"); the key itself was not printed)"
say "next:           bash chainbench/adapters/public/tools/verify_public_key.sh $RDIR/$NAME $ADDR"
