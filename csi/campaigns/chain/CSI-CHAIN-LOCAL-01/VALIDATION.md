# CSI-CHAIN-LOCAL-01: validation of the scientific L1 campaign `full-71a5854-20260925T115726Z`

- **Source (only source of truth):** `results/chain-local-l1-20260925/`, frozen by `SOURCE.sha256`. Produced by `./chainbench/run.sh full-local-l1` at the baseline tag `chain-l1-baseline-20260925` (`71a5854`).
- **Measurement code:** identical to `fbe3794`, the commit of the final packaged dry run (`measurement_code_paths` of the campaign binding).
- **Environment:** archived image `sha256:53d80311c0d3d2ff57b5eca3d8b1ace9eb4c45449fbb8b6596045dbb606e6cb6` (linux/arm64; `docker save` sha256 `bc16b206855bf8d569c41ebe62eb8a8d72fe12ea44ed9aef154142883d11c313`), `--network none`; geth `Geth/v1.16.9-stable-95665d57/linux-arm64/go1.24.13` (binary sha256 `a437c0a5e17d4c74…`).
- **Protocol:** CHAIN-PROTOCOL-v1 with amendments A1, A2, A3, A4, A5, sha256 `086206c5a6df8e78…`.
- **Rows:** 324 per run, as planned (9 cells × 36 rows; K = 8).

| Criterion (section 10) | Result |
|---|---|
| 1. Build: compiles, size limits, staged = committed, PLONK verifier provenance | pass (both profiles, all three runs; pre-flight `export_plonk_verifiers --check-only` 11/11) |
| 2. Proof set: `PROOFSET.sha256`, off-chain verification | pass (128 files; 64/64 proofs verified off-chain with snarkjs 0.7.5) |
| 3. Rows: `check_pass = 1`, runtime = artifact, counts | pass (every row of every run; 324/324) |
| 4. Hardfork (`env_check`) | pass (EDR osaka 4/4, prague control 0/4, geth 4/4) |
| 5. Determinism (EDR a vs b, from scratch) | identical: 16200 field comparisons, 0 differences; build manifests byte-identical |
| 6. Cross-client (EDR a vs geth) | identical: 14256 field comparisons under the §8.4 exclusions, 0 differences; build manifests byte-identical |
| Unit tests (§12 step 4) | 12 passing, 0 failing |
| Pre-flight / post-flight doctor | 0 FAIL / 0 FAIL; head = baseline commit; archived image in use; no network |
| Anti-mixing | every run.json commit = 71a5854 = tag; one image; one protocol; proof-set manifest = committed |

All 85/85 checks of `derived/validation.json` pass. Derived outputs: `derived/` (`scripts/analysis/derive_chain_l1.py`).
