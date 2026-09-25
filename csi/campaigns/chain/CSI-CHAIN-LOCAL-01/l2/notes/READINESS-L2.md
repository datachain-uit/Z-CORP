# Local-EraVM arm: readiness record (not scientific data)

Records of the packaging and reduced dry run that preceded amendment A6 (CHAIN-PROTOCOL-v1 §15.1, §16). Copies of
the run records are in `../readiness/` (raw dry-run and smoke data on the author's machine under `build/chainbench/l2/`).
None of these values is an L2 result; the scientific L2 matrix has not been run.

| Step (campaign Mac, Docker Desktop 29.8.0, linux/arm64, 2026-09-25) | Result |
|---|---|
| Live observation (read-only, `observe-public.sh`) | Era Sepolia minor version 29; class B (`../observation/CLASSIFICATION.md`) |
| `build-image-l2 --freeze` | image `sha256:255d0dac…91cc`; identity `chainbench/adapters/eravm/IMAGE.json` (glibc 2.36, Node v22.23.2, npm 10.9.8, pinned binaries) |
| `doctor-l2` | all checks passed (warnings only: no L2 amendment yet, untracked records, no L2 baseline tag, no archive yet) |
| `smoke-l2` #1 | 30/30 rows accepted, validation 13/13; created `chainbench/workloads/zcorp/smoke-reference-l2.csv` from `smoke-l2-20260925T125836Z` |
| `smoke-l2` #2 | equal to the reference on all 30 rows × 17 fields |
| `dry-run-l2` `dry-l2-3e0f6c8-20260925T125852Z` | runs a and b (Groth16 d5, d11; PLONK d10, d11; p0, p1): 72 rows (52 transactions, 20 calls) each; validation 13/13 each; a = b on all 3,960 field values; build manifests byte-identical (sha256 `60f5f731…a504`); environment and probe identical |
| `save-image-l2 --frozen` | `chainbench-l2-arm64.oci.tar`, 205,223,936 bytes, sha256 `8790cf4d…e2e5`; record `chainbench/adapters/eravm/ARCHIVE.json`; `load-image-l2` round trip passed |
| linux/amd64 (emulated) `doctor-l2`, `smoke-l2` | image `sha256:4ea75def…7942` with the amd64 binaries; doctor passed; smoke equal to the arm64 reference on all 30 rows × 17 fields; zksolc output identical (sha256 `04aba3ac…15db`) |
| arm64 with the archived image: `doctor-l2`, `smoke-l2` | doctor passed (archived image in use); smoke equal to the reference |

Cross-environment check (engineering): the same reduced dry run executed natively in the campaign VM (Ubuntu 22.04,
glibc 2.35, same pinned binaries and lockfile, no container) was identical to the container run a on all 3,960 field
values, with the same build manifest; only the environment check differed (the container adds the network check).

Engineering observations from the dry run (not results):
- Both verifiers and both managers compile with zksolc and execute on EraVM v29: every valid proof verifies through the
  manager and directly; tampered, cross-depth and unknown-root proofs are rejected as specified; the non-issuer is
  rejected. EraVM bytecode: Groth16 verifiers 3,040 B, PLONK verifiers 41,824 B (d5–d10) and 42,208 B (d11–d15),
  managers 6,752 B (Groth16) and 6,624 B (PLONK).
- Per transaction, the node's fee record reproduced the receipt `gasUsed` exactly for all 52 transactions of each run.
- A direct Groth16 verification spends most of its computational gas in one 4-pair `ecPairing` precompile call; a
  PLONK verification uses a 2-pair pairing and 18 `ecMul` and 18 `ecAdd` calls. This is why the two backends have
  similar EraVM computational gas per verification here; it is not interpreted before the scientific run.
- An early probe that let zksync-ethers estimate the gas limit produced a direct `verifyProof` transaction that
  succeeded with too little gas for the pairing and so returned `false`. The frozen procedure therefore uses fixed gas
  limits and requires `return_value = true` for direct verifier transactions.
