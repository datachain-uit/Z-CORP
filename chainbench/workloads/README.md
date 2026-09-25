# Workloads

A workload plugs a contract set and a cell procedure into the chainbench core. To add one, create `workloads/<name>/` with the files below.

- **`workload.json`** declares:
  - `modules`: paths to the workload's modules:
    - `constants`: must export `EDR_NETWORK`, `HARDFORK`, `EDR_CHAIN_ID`, `FEES`, `MNEMONIC`, `HD_BASE`, `BLOCK_GAS_LIMIT` and the workload's own parameters;
    - `profiles`: compile profiles, i.e. solc settings and the source files to stage;
    - `plan`: must export `PLANS` and `expectedRows(plan)`;
    - `ops`: must export `runCell(ctx, cell, proofs, inputs)` and `wallets()`;
    - `proofset`: must export `load()`, the frozen inputs of the workload.
  - `scripts`: the workload's scripts (`summarize`, `unit_tests`, `verifier_check`; optionally `record_campaign`, `make_smoke_reference`).
  - `plans`: the plans, with their output roots.
  - `default_campaign`: the binding used when none is selected.
- **`campaigns/<campaign-id>.json`** holds the venue or campaign metadata: campaign id, venue and registry record, protocol path, frozen-input locations, `tracked_paths` (clean-tree check before a run), `measurement_paths` (baseline-tag and record checks), the baseline-tag prefix, and the accepted reference dry run. Keep venue metadata here, never in the core.
- **Selection:** `CHAINBENCH_WORKLOAD=<name>` (default `zcorp`) and `CHAINBENCH_CAMPAIGN=<campaign-id>` (default: the workload's `default_campaign`).

The core does not change between workloads: `run.sh`, `run/`, `doctor/`, `docker/`, `lib/rpc.js`, `lib/geth.js`, `lib/envcheck.js`, `lib/gas.js`, `lib/schema.js`, `lib/build.js`, `lib/stage.js`, `scripts/run_l1.js`, `scripts/env_check.js`, `scripts/compare_runs.py`. See `core/README.md`.
