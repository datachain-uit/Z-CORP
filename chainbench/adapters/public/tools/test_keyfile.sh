#!/usr/bin/env bash
# CSI-CHAIN-PUBLIC-01: deterministic tests of the host key-file rules (lib/guards.sh cb_key_file_check) on both stat
# branches. Uses no key: the test files hold the text "not-a-key". Runs natively (macOS/BSD or GNU/Linux) and in the image.
#   bash chainbench/adapters/public/tools/test_keyfile.sh
# Flavors: the real `stat`, and PATH shims that make any host behave like GNU stat (where `stat -f` is the file-system
# query and succeeds with unrelated text) or like BSD stat (where `-c` and `--version` are illegal options), plus an
# owner shim (another uid) and a broken shim (unparsable output: must fail closed).
set -uo pipefail
TOOLS=$(cd "$(dirname "$0")" && pwd -P); AD=$(cd "$TOOLS/.." && pwd -P)
. "$AD/lib/guards.sh"
REAL_STAT=$(command -v stat); REAL_FLAVOR=bsd; "$REAL_STAT" --version >/dev/null 2>&1 && REAL_FLAVOR=gnu
T=$(mktemp -d "${TMPDIR:-/tmp}/cb-keyfile-test.XXXXXX"); chmod 700 "$T"
trap 'chmod -R u+rwx "$T" 2>/dev/null; rm -rf "$T"' EXIT
pass=0; fail=0; FAILED=()
ok() { pass=$((pass+1)); printf 'PASS %s\n' "$1"; }
ko() { fail=$((fail+1)); FAILED+=("$1"); printf 'FAIL %s -- %s\n' "$1" "$2"; }
mkshim() {  # name body
  mkdir -p "$T/shim-$1"; { printf '#!/usr/bin/env bash\nR=%q; F=%q\n' "$REAL_STAT" "$REAL_FLAVOR"; cat; } > "$T/shim-$1/stat"; chmod 755 "$T/shim-$1/stat"
}
mkshim gnu <<'SH'
case "$1" in
  --version) echo "stat (GNU coreutils) test shim"; exit 0;;
  -c) fmt=$2; shift 2; [ "${1:-}" = -- ] && shift
      if [ "$F" = gnu ]; then exec "$R" -c "$fmt" -- "$@"; fi
      case "$fmt" in '%a') exec "$R" -f '%Lp' "$@";; '%u') exec "$R" -f '%u' "$@";; esac; exit 1;;
  -f) printf '  File: "%s"\n    ID: 0 Namelen: 255 Type: ext2/ext3\nBlock size: 4096\n' "${4:-$3}"; exit 1;;
esac
exit 1
SH
mkshim bsd <<'SH'
case "$1" in
  --version|-c) echo "stat: illegal option -- ${1#-}" >&2; exit 1;;
  -f) fmt=$2; shift 2; [ "${1:-}" = -- ] && shift
      if [ "$F" = bsd ]; then exec "$R" -f "$fmt" "$@"; fi
      case "$fmt" in '%Lp') exec "$R" -c '%a' "$@";; '%u') exec "$R" -c '%u' "$@";; esac; exit 1;;
esac
exit 1
SH
mkshim owner <<'SH'
case "$1" in
  -c|-f) if [ "$2" = '%u' ]; then echo 4242; exit 0; fi
         shift 2; [ "${1:-}" = -- ] && shift
         if [ "$F" = gnu ]; then exec "$R" -c '%a' "$@"; else exec "$R" -f '%Lp' "$@"; fi;;
esac
exit 1
SH
mkshim broken <<'SH'
echo "?"; exit 0
SH

mk() {  # dir-mode file-mode -> path of a fresh key-like file
  local d; d=$(mktemp -d "$T/k.XXXXXX"); printf 'not-a-key\n' > "$d/key"; chmod "$2" "$d/key"; chmod "$1" "$d"; printf '%s\n' "$d/key"
}
expect() {  # label want(pass|<code>) path repo
  local out code
  if out=$(cb_key_file_check "$3" "$4"); then code=pass; else code=${out%%:*}; fi
  [ "$code" = "$2" ] && ok "$1 -> $2" || ko "$1" "expected $2, got $code ($out)"
}
suite() {  # flavor label
  local L=$1 f
  f=$(mk 700 600); expect "[$L] valid 0600 key in a 0700 directory" pass "$f" /nonexistent-repo
  f=$(mk 700 400); expect "[$L] valid 0400 key" pass "$f" /nonexistent-repo
  f=$(mk 700 644); expect "[$L] 0644 key" key_file_permissions "$f" /nonexistent-repo
  f=$(mk 700 640); expect "[$L] 0640 key" key_file_permissions "$f" /nonexistent-repo
  f=$(mk 700 700); expect "[$L] 0700 key" key_file_permissions "$f" /nonexistent-repo
  expect "[$L] relative path" key_file_not_absolute "relative/key" /nonexistent-repo
  f=$(mk 700 600); ln -s "$f" "$(dirname "$f")/link"; expect "[$L] symbolic link to a valid key" key_file_symlink "$(dirname "$f")/link" /nonexistent-repo
  f=$(mk 700 600); mkdir "$(dirname "$f")/adir"; expect "[$L] a directory" key_file_not_regular "$(dirname "$f")/adir" /nonexistent-repo
  expect "[$L] missing file" key_file_missing "$T/none/key" /nonexistent-repo
  f=$(mk 700 600); expect "[$L] key inside the repository" key_file_in_repository "$f" "$T"
  f=$(mk 755 600); expect "[$L] directory 0755" key_dir_unprotected "$f" /nonexistent-repo
  f=$(mk 750 600); expect "[$L] directory 0750" key_dir_unprotected "$f" /nonexistent-repo
  f=$(mk 711 600); expect "[$L] directory 0711" key_dir_unprotected "$f" /nonexistent-repo
}
suite "real stat ($REAL_FLAVOR)"
for fl in gnu bsd; do (PATH="$T/shim-$fl:$PATH"; hash -r; suite "$fl shim") ; done > "$T/out.txt"; cat "$T/out.txt"
pass=$((pass + $(grep -c '^PASS' "$T/out.txt"))); fail=$((fail + $(grep -c '^FAIL' "$T/out.txt")))
while read -r l; do FAILED+=("${l#FAIL }"); done < <(grep '^FAIL' "$T/out.txt")
f=$(mk 700 600)
m=$(PATH="$T/shim-gnu:$PATH"; hash -r; cb_file_mode "$f"); [ "$m" = 600 ] && ok "[gnu shim] cb_file_mode reads 600 (GNU form tried first)" || ko "[gnu shim] cb_file_mode" "got '$m'"
old=$(PATH="$T/shim-gnu:$PATH"; hash -r; stat -f '%Lp' "$f" 2>/dev/null || stat -c '%a' "$f")
[ "$old" != 600 ] && ok "[gnu shim] the old run-public.sh form (stat -f first) mis-reads a 0600 file (defect reproduced)" || ko "[gnu shim] old form" "unexpectedly read 600"
m=$(PATH="$T/shim-bsd:$PATH"; hash -r; cb_file_mode "$f"); [ "$m" = 600 ] && ok "[bsd shim] cb_file_mode reads 600 (BSD fallback)" || ko "[bsd shim] cb_file_mode" "got '$m'"
out=$(PATH="$T/shim-owner:$PATH"; hash -r; cb_key_file_check "$f" /nonexistent-repo); [ "${out%%:*}" = key_file_owner ] && ok "[owner shim] key owned by another uid -> key_file_owner" || ko "[owner shim]" "$out"
out=$(PATH="$T/shim-broken:$PATH"; hash -r; cb_key_file_check "$f" /nonexistent-repo); [ "${out%%:*}" = key_file_stat ] && ok "[broken shim] unparsable stat output -> key_file_stat (fails closed)" || ko "[broken shim]" "$out"
printf 'KEYFILE-TESTS: %d/%d pass (real stat: %s)\n' "$pass" "$((pass+fail))" "$REAL_FLAVOR"
[ "$fail" = 0 ]
