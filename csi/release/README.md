# CSI release archives

Built on demand; the archives themselves are not versioned (see `.gitignore`), their checksums are.

Per campaign (`CSI-PROVER-01/`):

| File | Content | Made by |
|---|---|---|
| `campaign-<campaign_id>.tar` | The source campaign directory, byte-for-byte, in a deterministic tar (sorted paths, mtime 0, uid/gid 0, mode 0644). | `scripts/release/build_csi_bundle.py --release` |
| `code-<commit>.tar` | `git archive` of the campaign paths (`bench scripts/setup circuits contracts test ARTIFACTS.sha256 PROVENANCE.md`) at the campaign commit. | same |
| `image/zcorp-bench-<campaign_id>.oci.tar` | `docker save` of the exact benchmark image the campaign ran (protocol v3, P8). | `scripts/release/save_image.sh` on the campaign host |
| `image/index.json`, `image/archive-listing.txt` | The archive's OCI index and file listing (versioned). | same |
| `IMAGE-ARCHIVE.json` | Image identity (tag, per-build ID, manifest, config) and the archive's sha256 (versioned). | same |
| `RELEASE.sha256` | sha256 of every file above (versioned). | `build_csi_bundle.py --release` |

The manifest-covered proving artifacts (`data/`, `pot16_final.ptau`; see `ARTIFACTS.sha256`) are not
included here; they belong to the data deposit and are identified by the artifact manifest digest
recorded in each campaign record.
