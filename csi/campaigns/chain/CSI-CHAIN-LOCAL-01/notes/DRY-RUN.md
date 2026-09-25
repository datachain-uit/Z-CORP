# CSI-CHAIN-LOCAL-01: engineering dry run (not evidence)

- **Commit:** `e141816`, clean tree. **Plan:** `dry`, i.e. Groth16 d5 and d11, PLONK d10 and d11, and the bridge cell (Groth16 d11, July configuration), with 2 frozen proofs per cell and all negative controls.
- **Runs:** two from-scratch EDR runs, `dry-e141816-edr-a` and `dry-e141816-edr-b`, and a geth v1.16.9 `--dev` replay, `dry-e141816-geth`. Each has 90 rows, the planned number, and every row passes its check.
- **Determinism (a against b):** identical = True. 90 rows (65 transactions, 25 calls) × 50 fields = 4500 comparisons, with 0 differences. Both build manifests are byte-identical.
- **Cross-client (EDR a against geth):** identical = True. 3960 comparisons (excluding block_number, chain_id, client_version, env, gas_price_wei, run_id, tx_hash), with 0 differences, including `gas_used` of all 65 transactions and the negative controls. The build manifests are identical.
- **Hardfork verification:** EDR `osaka` and geth show all four Osaka markers; the EDR `prague` control shows none. The unit tests give 12 passing and 0 failing.

## Per-cell summary (run a; gas units; engineering values)

| cell | verifier deploy | manager deploy | setIssuer | addRoot | verifyCredential (min–max) | direct verifyProof (min–max) | verifier runtime B | manager runtime B | negatives |
|---|---|---|---|---|---|---|---|---|---|
| primary-groth16-d5 | 350,084 | 565,248 | 47,900 | 47,334 | 223,946–223,958 | 214,585–214,597 | 1374 | 2140 | all as expected |
| primary-groth16-d11 | 349,628 | 565,248 | 47,900 | 47,334 | 223,946–223,958 | 214,585–214,597 | 1372 | 2140 | all as expected |
| primary-plonk-d10 | 1,222,173 | 541,930 | 47,900 | 47,346 | 298,613–300,791 | 289,614–291,792 | 5413 | 2032 | all as expected |
| primary-plonk-d11 | 1,226,937 | 541,930 | 47,900 | 47,334 | 299,880–300,026 | 290,881–291,027 | 5435 | 2032 | all as expected |
| bridge-groth16-d11 | 384,793 | 1,525,514 | 48,410 | 51,326 | 239,229–239,241 | 214,794–214,806 | 1535 | 6531 | all as expected |

These are dry-run values, with 2 of the 8 frozen proofs per cell. They are not scientific results. The full matrix (protocol §6) has not been run.
