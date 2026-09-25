# CSI-CHAIN-LOCAL-01: reviewer platforms and the archived images

The scientific L1 campaign runs **only on linux/arm64**, in the archived image recorded in `chainbench/docker/ARCHIVE.json`
(CHAIN-PROTOCOL-v1 §15 A5). The linux/amd64 check below is a reviewer-portability check. It is not scientific data, its
timing is not recorded, and it was not compared with the scientific runs.

## Archived images (`docker save`, not versioned; identities in `csi/release/CSI-CHAIN-LOCAL-01/IMAGE-ARCHIVE.json`)

| Image | Platform | Role | Image index | Platform manifest / config | Archive bytes | Archive sha256 |
|---|---|---|---|---|---|---|
| `chainbench-l1:local` | linux/arm64 | **scientific** | `sha256:53d80311c0d3d2ff57b5eca3d8b1ace9eb4c45449fbb8b6596045dbb606e6cb6` | `sha256:70c74b85b999…` / `sha256:1064fae8b2f6…` | 299,819,008 | `bc16b206855bf8d569c41ebe62eb8a8d72fe12ea44ed9aef154142883d11c313` |
| `ethereum/client-go@sha256:2dd7ef21…` (geth v1.16.9) | linux/arm64 | the geth image the scientific image was built from | (index not in the archive; saved with `--platform`) | `sha256:8e4ea9e38df1…` / `sha256:f0c8143bbf2b…` | 22,351,360 | `b438bdabd72518def96346d4b927d521b3467966696b38691ab9fd9a093e3bde` |
| `chainbench-l1:local-amd64` | linux/amd64 | portability | `sha256:89026482802da564fcab3a044b29ea6234ba26f67fbb1d07c62d19b0747aadd3` | `sha256:3cff98758e38…` / `sha256:af64d4eb061f…` | 290,817,024 | `e50bdb38ab308fd481c380a25f7fcb6ce6a73f1ab6f437cdd8e58110a66d0b37` |
| `ethereum/client-go@sha256:2dd7ef21…` (geth v1.16.9) | linux/amd64 | portability | (saved with `--platform`) | `sha256:d7f80607a4c8…` / `sha256:78563624329d…` | 23,296,512 | `ec1ec8d537ec5b77728be6fd8b1c05ab51e2da6ad1a4546e888b397792e2a932` |

**Checks**, run by `scripts/release/chain_image_record.py` on the archives:

- **Hashes:** each archive's recomputed sha256 and size equal the host record.
- **Index:** the chainbench archive's OCI index is the image ID that the runs record.
- **Frozen archive:** the arm64 archive is the one in `chainbench/docker/ARCHIVE.json`.
- **geth:** `/opt/geth/geth` in each chainbench image equals `/usr/local/bin/geth` in the archived geth image of the same platform:
  - arm64: `a437c0a5e17d4c74…`, the binary in `chainbench/docker/IMAGE.json`;
  - amd64: `8c474e73d98fb74d…`.

**Loading.** `./chainbench/run.sh load-image <archive>` verifies the sha256 against the record, runs `docker load`, and checks that the recorded image is present. On the campaign host, `author-prefreeze` loaded the frozen arm64 archive back through this path: PASS.

## linux/amd64 portability check (Docker Desktop emulation on the Apple M5 campaign host, 2026-09-25)

| Item | Result |
|---|---|
| Image build | Built from the committed pins with `CHAINBENCH_PLATFORM=linux/amd64`: the same node base index digest and the same official geth index digest, with Git Commit `95665d57` verified. `npm ci` ran from the unchanged lockfile. |
| Native dependencies | `@nomicfoundation/edr-linux-x64-gnu` 0.12.0-next.23 (sha256 `cf163a301fca…`) loads, and Hardhat 2.29.1 runs. The npm solc `soljson.js` is identical (`033dc42a…`). geth v1.16.9 linux/amd64 runs (Go 1.24.13). |
| Doctor | No FAIL. The warnings are expected: the arm64 reference (native binaries differ by architecture), the archived image being linux/arm64, and, at that moment, the uncommitted `ARCHIVE.json` and the old tag position. It also passed: no network, the proof set (128 files), the PLONK verifier provenance (11/11), and the Osaka markers (EDR 4/4, Prague control 0/4, geth 4/4). |
| Smoke | **PASS** (`smoke-amd64-20260925T114936Z`): unit tests 12/12, 30/30 rows, all 9 smoke checks. |
| Row equality | The 30 amd64 smoke rows equal the arm64 smoke rows on **every** field except `run_id`, including `gas_used`, calldata, deployed bytecode and `client_version`. |

**Tested reviewer platforms:** linux/arm64 (native; the scientific platform) and linux/amd64 (emulated on Apple silicon). A native x86-64 host was not tested.
