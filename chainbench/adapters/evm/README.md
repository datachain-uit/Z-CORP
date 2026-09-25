# EVM adapter (local L1)

The EVM adapter was written before the adapter split and is frozen with the L1 campaign, so its files were not moved:

| Part | Files |
|---|---|
| Node start-up | `lib/rpc.js` (in-process EDR, HTTP), `lib/geth.js` (fresh `geth --dev` per cell), `hardhat.config.js` |
| Compilation | `lib/build.js`, `lib/stage.js` (solc 0.8.20 via Hardhat) |
| Hardfork check | `lib/envcheck.js`, `scripts/env_check.js` |
| Gas accounting | `lib/gas.js` (intrinsic, floor, create, code-deposit gas) |
| Runner, schema | `scripts/run_l1.js`, `lib/schema.js`, `lib/ops.js` (the workload's cell procedure) |
| Image, orchestration | `docker/`, `run/incontainer.sh`, `run.sh` (`doctor`, `smoke`, `dry-run`, `full-local-l1`) |

To reproduce the L1 campaign, check out `chain-l1-baseline-20260925`: at later commits `doctor --require-baseline`
reports the files added for the L2 arm as changes since the L1 baseline tag, by design.
