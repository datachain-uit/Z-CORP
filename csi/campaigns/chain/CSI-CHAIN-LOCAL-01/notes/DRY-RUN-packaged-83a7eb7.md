# CSI-CHAIN-LOCAL-01: packaged engineering dry run (not evidence)

> **Superseded.** This first packaged dry run passed at `83a7eb7`, but the run procedure changed after it. Commit `7f14936` added the §12 step-4 unit tests to the run procedure and made each runner step one invocation (§15 A3). The dry run was therefore repeated at `fbe3794` (`DRY-RUN.md`), and the baseline tag was moved from `35443d0` to the commit that records that repeat. The measured values here equal those of the repeat and of the readiness dry run.

- **Commit:** `83a7eb7`, clean tracked paths. **Baseline tag:** `chain-l1-baseline-20260925`. **Plan:** `dry`, i.e. Groth16 d5 and d11, PLONK d10 and d11, and the bridge cell (Groth16 d11, July configuration), with proofs p0 and p1 and all negative controls.
- **Environment:** the chainbench container `sha256:53d80311c0d3…` (base `node@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9`; geth `official:ethereum/client-go@sha256:2dd7ef210a1a3fb87887676f7ead1b98161af83810928cdf6fc5b84bcdcc8ef4`), platform linux/arm64, run with `--network none` (only loopback up, no routes; checked per run), repository mounted read-only, one fresh container per run.
- **Runs:** two from-scratch EDR runs, `dry-83a7eb7-20260925T111609Z-edr-a` and `dry-83a7eb7-20260925T111609Z-edr-b`, and a geth v1.16.9 `--dev` replay, `dry-83a7eb7-20260925T111609Z-geth`. Each has 90 rows, the planned number, and every row passes its check.
- **Determinism (a against b):** identical = True. 90 rows × 50 fields = 4500 comparisons, 0 differences; build manifests byte-identical.
- **Cross-client (EDR a against geth):** identical = True. 3960 comparisons (excluding block_number, chain_id, client_version, env, gas_price_wei, run_id, tx_hash), 0 differences.
- **Against the accepted readiness dry run:** EDR a against `build/campaigns/chain/dry-e141816-edr-a`: identical = True (4500 comparisons, 0 differences, build manifests byte-identical). geth against `build/campaigns/chain/dry-e141816-geth`: identical = True (3960 comparisons).
- **Why the geth comparison uses the cross-client exclusions:** the geth binaries differ. The readiness run used `5551bdb5cbfe…` (the from-source build); the packaged run used `a437c0a5e17d…` (official:ethereum/client-go). Both report v1.16.9 at commit 95665d57, so `client_version` differs (the Go version). `block_number` and `gas_price_wei` are geth dev-mode scheduling fields; they also vary between two runs of the same geth binary. `gas_used`, status, revert data, return values, addresses, bytecode and `tx_hash` are identical.
- **Hardfork verification:** EDR `osaka` and geth show all four Osaka markers; the EDR `prague` control shows none. Unit tests: 12 passing, 0 failing. Smoke check: pass.

## Per-cell summary (run a; gas units; engineering values)

| cell | verifier deploy | manager deploy | setIssuer | addRoot | verifyCredential (min–max) | direct verifyProof (min–max) | verifier runtime B | manager runtime B | negatives |
|---|---|---|---|---|---|---|---|---|---|
| primary-groth16-d5 | 350,084 | 565,248 | 47,900 | 47,334 | 223,946–223,958 | 214,585–214,597 | 1374 | 2140 | all as expected |
| primary-groth16-d11 | 349,628 | 565,248 | 47,900 | 47,334 | 223,946–223,958 | 214,585–214,597 | 1372 | 2140 | all as expected |
| primary-plonk-d10 | 1,222,173 | 541,930 | 47,900 | 47,346 | 298,613–300,791 | 289,614–291,792 | 5413 | 2032 | all as expected |
| primary-plonk-d11 | 1,226,937 | 541,930 | 47,900 | 47,334 | 299,880–300,026 | 290,881–291,027 | 5435 | 2032 | all as expected |
| bridge-groth16-d11 | 384,793 | 1,525,514 | 48,410 | 51,326 | 239,229–239,241 | 214,794–214,806 | 1535 | 6531 | all as expected |

These are dry-run values, with 2 of the 8 frozen proofs per cell. They are not scientific results. The full matrix (protocol §6) has not been run.
