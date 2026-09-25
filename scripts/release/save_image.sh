#!/bin/bash
# Archive the exact benchmark image of a prover campaign with `docker save` (rerun protocol v3, P8)
# and record its checksum. Run on the campaign host, from the repository root:
#
#   bash scripts/release/save_image.sh [results/postcorr-20260925] [csi/release/CSI-PROVER-01]
#
# Refuses unless the local tag zcorp-bench:<campaign_id> still points to the image ID recorded in
# the campaign's CAMPAIGN.json. Writes (in the output directory):
#   image/zcorp-bench-<campaign_id>.oci.tar   the archive (not versioned; see csi/release/.gitignore)
#   image/index.json                           the archive's OCI index (small, versioned)
#   image/archive-listing.txt                  `tar -tf` of the archive (versioned)
#   IMAGE-ARCHIVE.json                         checksum and identity record (versioned)
# Nothing in the campaign directory is changed.
set -euo pipefail
C="${1:-results/postcorr-20260925}"
OUT="${2:-csi/release/CSI-PROVER-01}"
jget() { sed -n "s/.*\"$1\": \"\([^\"]*\)\".*/\1/p" "$C/CAMPAIGN.json" | head -1; }
ID="$(jget campaign_id)"; IMG="$(jget built_image_id)"
[ -n "$ID" ] && [ -n "$IMG" ] || { echo "ABORT: cannot read campaign_id/built_image_id from $C/CAMPAIGN.json"; exit 1; }
BUILDLOG="$(ls "$C"/environment/docker-build-*.log | head -1)"
MAN="$(sed -n 's/.*exporting manifest \(sha256:[0-9a-f]*\) done.*/\1/p' "$BUILDLOG" | head -1)"
CFG="$(sed -n 's/.*exporting config \(sha256:[0-9a-f]*\) done.*/\1/p' "$BUILDLOG" | head -1)"
TAG="zcorp-bench:$ID"
NOW="$(docker image inspect --format '{{.Id}}' "$TAG" 2>/dev/null || true)"
[ "$NOW" = "$IMG" ] || { echo "ABORT: $TAG is '$NOW', the campaign used $IMG"; exit 1; }
mkdir -p "$OUT/image"
F="$OUT/image/zcorp-bench-$ID.oci.tar"
[ -e "$F" ] && { echo "ABORT: $F already exists (not overwritten)"; exit 1; }
echo "docker save $TAG -> $F"
docker save -o "$F" "$TAG"
SHA="$(shasum -a 256 "$F" | cut -d' ' -f1)"
BYTES="$(wc -c < "$F" | tr -d ' ')"
tar -tf "$F" | LC_ALL=C sort > "$OUT/image/archive-listing.txt"
tar -xOf "$F" index.json > "$OUT/image/index.json"
has() { grep -qx "blobs/sha256/${1#sha256:}" "$OUT/image/archive-listing.txt" && echo true || echo false; }
MOK="$(has "$MAN")"; COK="$(has "$CFG")"; IOK="$(has "$IMG")"
IDX="$(shasum -a 256 "$OUT/image/index.json" | cut -d' ' -f1)"
cat > "$OUT/IMAGE-ARCHIVE.json" <<EOF
{
  "campaign_id": "$ID",
  "image_tag": "$TAG",
  "image_id_per_build": "$IMG",
  "image_manifest": "$MAN",
  "image_config": "$CFG",
  "archive": "image/zcorp-bench-$ID.oci.tar",
  "archive_sha256": "$SHA",
  "archive_bytes": $BYTES,
  "archive_contains_image_manifest_blob": $MOK,
  "archive_contains_image_config_blob": $COK,
  "archive_contains_per_build_index_blob": $IOK,
  "index_json_sha256": "$IDX",
  "docker_client": "$(docker version --format '{{.Client.Version}}')",
  "docker_engine": "$(docker version --format '{{.Server.Version}}')",
  "saved_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "command": "docker save -o $F $TAG"
}
EOF
cat "$OUT/IMAGE-ARCHIVE.json"
[ "$MOK$COK" = truetrue ] && echo "image archive: OK" || { echo "image archive: manifest/config blob missing"; exit 1; }
