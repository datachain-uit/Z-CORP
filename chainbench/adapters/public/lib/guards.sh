# shellcheck shell=bash
# chainbench public adapter: host-side guards shared by run-public.sh and tools/*.sh. bash 3.2+; macOS/BSD and GNU/Linux.
#   cb_file_mode PATH             permission bits in octal (e.g. 600); GNU `stat -c %a`, else BSD `stat -f %Lp`; fails closed
#   cb_file_uid PATH              numeric owner uid (GNU `stat -c %u`, else BSD `stat -f %u`); fails closed
#   cb_sha256 FILE | cb_sha256_str STRING   sha256 hex (sha256sum or shasum -a 256)
#   cb_key_file_check PATH REPO   host key-file rules (below); prints the resolved path, or "<code>: <message>" and returns 1
#   cb_json_get KEY FILE          a top-level scalar of a 2-space-indented JSON record (the image record)
#   cb_image_verify RECORD        the loaded Docker image = the frozen image of RECORD; prints "pass" or "<code>: <message>"
# GNU is tried first on purpose: on GNU/Linux `stat -f` is the file-system query and succeeds with unrelated output, so
# trying the BSD form first (the old run-public.sh behaviour) rejected valid 0600 key files. Every value is validated
# (octal / decimal) before use; anything else fails closed.

cb_file_mode() {
  local m
  m=$(stat -c '%a' -- "$1" 2>/dev/null) && [[ $m =~ ^[0-7]{3,4}$ ]] && { printf '%s\n' "$m"; return 0; }
  m=$(stat -f '%Lp' -- "$1" 2>/dev/null) && [[ $m =~ ^[0-7]{3,4}$ ]] && { printf '%s\n' "$m"; return 0; }
  return 1
}
cb_file_uid() {
  local u
  u=$(stat -c '%u' -- "$1" 2>/dev/null) && [[ $u =~ ^[0-9]+$ ]] && { printf '%s\n' "$u"; return 0; }
  u=$(stat -f '%u' -- "$1" 2>/dev/null) && [[ $u =~ ^[0-9]+$ ]] && { printf '%s\n' "$u"; return 0; }
  return 1
}
cb_sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
cb_sha256_str() { if command -v sha256sum >/dev/null 2>&1; then printf '%s' "$1" | sha256sum | cut -d' ' -f1; else printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; fi; }

# Key file rules (host side; lib/keysafety.js repeats format, secp256k1 validity and the development-account refusal):
# absolute path; not a symbolic link; exists; regular file; resolved path outside the repository; owned by the invoking
# user; mode 0600 or 0400; its directory owned by the invoking user with no group/other permissions (e.g. 0700).
cb_key_file_check() {
  local f=${1:-} repo=${2:-} me dir real rrepo mode uid dmode duid
  me=$(id -u)
  [ -n "$f" ] || { echo "key_file_missing: no key file given"; return 1; }
  case "$f" in /*) ;; *) echo "key_file_not_absolute: the key file must be given as an absolute path outside the repository"; return 1;; esac
  if [ -L "$f" ]; then echo "key_file_symlink: the key file must not be a symbolic link"; return 1; fi
  [ -e "$f" ] || { echo "key_file_missing: the key file does not exist"; return 1; }
  [ -f "$f" ] || { echo "key_file_not_regular: the key file is not a regular file"; return 1; }
  dir=$(cd "$(dirname "$f")" 2>/dev/null && pwd -P) || { echo "key_file_missing: the key file's directory cannot be resolved"; return 1; }
  real="$dir/$(basename "$f")"
  if [ -n "$repo" ]; then
    rrepo=$(cd "$repo" 2>/dev/null && pwd -P) || rrepo=$repo
    case "$real" in "$rrepo"/*) echo "key_file_in_repository: the key file is inside the repository; keep it outside (it must never be committed)"; return 1;; esac
  fi
  mode=$(cb_file_mode "$real") || { echo "key_file_stat: the key file's permissions cannot be read"; return 1; }
  uid=$(cb_file_uid "$real") || { echo "key_file_stat: the key file's owner cannot be read"; return 1; }
  [ "$uid" = "$me" ] || { echo "key_file_owner: the key file is owned by uid $uid, not by you (uid $me)"; return 1; }
  case "$mode" in 600|400|0600|0400) ;; *) echo "key_file_permissions: the key file mode is $mode; chmod 600 it"; return 1;; esac
  dmode=$(cb_file_mode "$dir") || { echo "key_file_stat: the key directory's permissions cannot be read"; return 1; }
  duid=$(cb_file_uid "$dir") || { echo "key_file_stat: the key directory's owner cannot be read"; return 1; }
  [ "$duid" = "$me" ] || { echo "key_dir_owner: the key directory $dir is owned by uid $duid, not by you (uid $me)"; return 1; }
  case "$dmode" in *[0-7]00) ;; *) echo "key_dir_unprotected: the key directory $dir has mode $dmode; chmod 700 it (no group/other access)"; return 1;; esac
  printf '%s\n' "$real"
}

cb_json_get() { sed -n "s/^  \"$1\": \"\{0,1\}\([^\"]*\)\"\{0,1\},\{0,1\}\$/\1/p" "$2" | head -n 1; }

# The loaded image equals the frozen record: docker's content-addressed image ID (= the OCI image-index digest under the
# containerd image store) must be present, and its OS, architecture and rootfs layer list must equal the record's.
cb_image_verify() {
  local rec=$1 want got exp
  [ -f "$rec" ] || { echo "image_record_missing: no frozen public image record ($rec)"; return 1; }
  want=$(cb_json_get image_id "$rec")
  [[ $want =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "image_record_inconsistent: the record has no image_id"; return 1; }
  got=$(docker image inspect --format '{{.Id}}|{{.Os}}|{{.Architecture}}|{{json .RootFS.Layers}}' "$want" 2>/dev/null) \
    || { echo "image_absent: the frozen image $want is not loaded (./chainbench/run.sh load-image-public <archive>)"; return 1; }
  exp="$want|$(cb_json_get platform "$rec" | cut -d/ -f1)|$(cb_json_get architecture "$rec")"
  [ "${got%%|\[*}" = "$exp" ] || { echo "image_mismatch: docker reports ${got%%|\[*}, the record $exp"; return 1; }
  [ "$(cb_sha256_str "${got#*|*|*|}")" = "$(cb_json_get rootfs_layers_json_sha256 "$rec")" ] || { echo "image_mismatch: the rootfs layers of $want differ from the record"; return 1; }
  echo pass
}
