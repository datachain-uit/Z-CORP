# CSI-CHAIN-LOCAL-01-L2: validation of the scientific local-EraVM campaign `full-l2-e97b69f-20260925T132901Z`

- **Arm:** the local-EraVM arm of CSI-CHAIN-LOCAL-01 (CHAIN-PROTOCOL-v1 §16, A6, A7). Environment label: *EraVM execution under protocol v29 (anvil-zksync 0.6.11 built-in v29 system contracts; bootloader and default-account hashes differ from live Era Sepolia; no EVM emulator; fixed local fee input)*.
- **Source:** `results/chain-local-l2-20260925/` (the public artifact raw; see *Provenance layers* below), frozen by `SOURCE.sha256`. Produced by `./chainbench/run.sh full-local-l2` at the baseline tag `chain-l2-baseline-20260925` (`e97b69f`).
- **Measurement code:** identical to `3e0f6c8`, the commit of the accepted packaged L2 dry run (`measurement_code_paths` of the L2 binding).
- **Environment:** archived image `sha256:255d0dacac2629988c339d311630e3efa99b6153478378570a63ad1b9a7491cc` (linux/arm64; `docker save` sha256 `8790cf4d90c8380aa348c76b7feeacd973f2a99169c719a2b8288fb2421db2e5`), `--network none`; anvil-zksync 0.6.11, zksolc 1.5.15, era-solc 0.8.20-1.0.2 (sha256-pinned).
- **Protocol:** CHAIN-PROTOCOL-v1 with amendments A1, A2, A3, A4, A5, A6, A7, sha256 `46a4b9eaf8054a95…`.
- **Rows:** 288 per run (200 transactions), as planned (8 cells × 36 rows; K = 8).

| Criterion (§16.6) | Result |
|---|---|
| V1–V13 (re-evaluated by `derive_chain_l2.py` for runs a and b) | pass: V1_schema, V2_counts, V3_cells, V4_sequence, V5_outcomes, V6_tx_fields, V7_fee_accounting, V8_bytecode, V9_size_limit, V10_fresh_chain_per_cell, V11_binaries_pinned, V12_env_check, V13_system_contracts |
| Runner acceptance | both runs accepted; 0 failing rows; 0 transactions failing fee accounting; deployments = compiled bytecode |
| Fee accounting | every transaction has exactly one node fee record; receipt `gasUsed` reproduced exactly from computational gas, pubdata bytes and the fixed fee input |
| Determinism (run a vs b, from scratch) | identical: 15840 field comparisons, 0 differences; build manifests byte-identical; environment probes identical |
| Pre-flight / post-flight doctor-l2 | 0 FAIL / 0 FAIL; head = baseline commit; archived image in use; L2 baseline tag; no network; PS-01 intact |
| Anti-mixing | both run.json commits = e97b69f = tag; one image; one protocol; proof-set manifest = committed PS-01 |

All 82/82 checks of `derived/validation.json` pass. Derived outputs: `derived/` (`scripts/analysis/derive_chain_l2.py`), in EraVM units only.

## Provenance layers (publication hygiene, after acceptance)

- **Acquisition raw:** the exact 70 files emitted by the accepted campaign, validated above. Kept as the deterministic archive `acquisition-raw-full-l2-e97b69f-20260925T132901Z.tar` (sha256 `4f39c48918121497373844e3a2b461c804267485df7c9ee17c6b3351ca2b1773`; manifest aggregate `d891858a2b5461840ac7a5cff7af2cf7f9275f95dda70a0f7317c671ae25606f`), recorded in `ACQUISITION-RAW.json` (hashes only). It is not versioned and not distributed through git, because 18 anvil-zksync start-up logs display the standard public development credentials of the local node.
- **Public artifact raw:** the tracked `results/chain-local-l2-20260925/` (70 files, `SOURCE.sha256` sha256 `a2a2807b9241583cfcf8cd72117f0b53815e547363aee71785c0d11fbe06bba7`). It is not byte-identical to the acquisition raw: in 18 `anvil.stdout` files, 54 start-up-banner lines (the two displayed development private keys and the mnemonic line of each) were replaced by `[REDACTED: STANDARD PUBLIC DEVELOPMENT CREDENTIAL]` (`SANITATION.json`, `scripts/release/sanitize_chain_l2_devcreds.py`). Every other line and file is byte-identical. No scientific script reads `anvil.stdout`.
- **Timing and effect:** the sanitation was applied after acceptance and changes no measurement field. Rerunning parsing, validation and derivation on both layers gives identical results (38/38 requirements, `NEUTRALITY.json`): V1-V13, 82/82, 15,840/15,840, 200/200 receipt reconstructions per run, the fee trace re-parsed identically, byte-identical derived CSVs, `values.tex` and `validation.json`, unchanged identities. `derived/derivation.json` differs only in its input fingerprint (`inputs_sha256`) of the 18 sanitised files.
- **Retained configuration:** the public development mnemonic remains as the value of the anvil-zksync "-m" argument in environment.json of runs a and b (frozen node configuration, read by validate_l2.py, compare_l2.py and derive_chain_l2.py), as it does in the measurement code (chainbench/lib/constants.js, chainbench/adapters/eravm/lib/constants.js) and the protocol; no private key remains.
