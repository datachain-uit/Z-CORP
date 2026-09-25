# chainbench core: what is generic and what belongs to a workload

chainbench measures contract deployment and call gas on local EVM chains, deterministically, and replays every operation on a second execution client. The **core** has no knowledge of any particular contract set, proof system or publication venue. A **workload** (`workloads/<name>/`) supplies those, and a **campaign binding** (`workloads/<name>/campaigns/<id>.json`) supplies the venue or campaign metadata.

## Layers

| Layer | Files | Role |
|---|---|---|
| Reviewer entry point | `run.sh` | Host side; the only prerequisite is Docker. Commands: `doctor`, `smoke`, `full-local-l1` (also `build-image`, `dry-run`, and `author-freeze`, which is for the author only). Starts one fresh container per run with `--network none`. |
| Container | `docker/Dockerfile`, `docker/pins.env`, `docker/identity.js`, `docker/IMAGE.json`, `docker/ACCEPTED-TOOLCHAIN.json` | The pinned toolchain image: digest-pinned base, `npm ci` from `package-lock.json`, and geth. It also records the toolchain identity and compares it with a reference. The image contains no harness code, contracts or inputs; those are mounted read-only from the repository. |
| In-container dispatcher | `run/incontainer.sh` | Maps the reviewer commands to scripts. Workload scripts are resolved through the binding. |
| Checks | `doctor/doctor.js`, `smoke/check_smoke.py` | Pre-flight checks, which never run an experiment, and the packaging smoke check. |
| Binding loader and helpers | `core/workload.js`, `core/index.js`, `core/sources.js`, `core/netcheck.js` | Selects the workload and campaign (`CHAINBENCH_WORKLOAD`, `CHAINBENCH_CAMPAIGN`), resolves workload modules and scripts, lists source hashes, and checks network isolation. |
| Measurement core | `lib/rpc.js`, `lib/geth.js`, `lib/envcheck.js`, `lib/gas.js`, `lib/schema.js`, `lib/build.js`, `lib/stage.js`, `lib/common.js`, `hardhat.config.js`, `scripts/run_l1.js`, `scripts/env_check.js`, `scripts/compare_runs.py` | Deterministic local EVM start-up: in-process EDR (Hardhat), and a fresh `geth --dev` per cell. Also fresh-directory compilation with a build manifest, transaction recording with receipts and revert data, gas decomposition, and behavioural hardfork checks. Determinism and cross-client comparison report differences and never normalise them. Provenance: git state, hashes, and the run and environment records. |
| Workload (`zcorp`) | `lib/constants.js`, `lib/profiles.js`, `lib/plan.js`, `lib/ops.js`, `lib/proofset.js`, `scripts/summarize_l1.py`, `scripts/test.js`, `scripts/export_plonk_verifiers.js`, `scripts/gen_proofset.js`, `workloads/zcorp/*` | Z-CORP contracts, the cell procedure, frozen proof set, compile profiles, summaries and the campaign record. They stay at their original paths (the measured code was not moved) and are reached through `workloads/zcorp/workload.json`. The Z-CORP artifact-path helper `art()` also stays in `lib/common.js` for the same reason. |
| Campaign binding | `workloads/zcorp/campaigns/CSI-CHAIN-LOCAL-01.json` | Campaign id, venue, protocol path, frozen-input locations, tracked and measurement paths, baseline-tag prefix, accepted reference dry run. |

The core modules read campaign identity only from the binding: `lib/common.js` exports `CAMPAIGN_ID`, `PROTOCOL_REL` and `PROOFSET_DIR` from it, and `run_l1.js` records `workload` and `campaign_binding` in every `run.json`. They read workload parameters only through `core/workload.js` (`W.module('constants' | 'profiles' | 'plan' | 'ops' | 'proofset')`).

## Run layout

| Plan | Output root | Status |
|---|---|---|
| `smoke` | `build/chainbench/smoke/<run>` | packaging check, not data |
| `dry` | `build/chainbench/dry-run/<run>-{edr-a,edr-b,geth}` | engineering, not data |
| `full` | `build/campaigns/chain/<run>-{edr-a,edr-b,geth}` | scientific; the runner refuses any other root for this plan |

Each run is one container. Inside it, each step is one runner invocation (protocol §12, §15 A3):

1. `init` writes `run.json` and `environment.json` (toolchain, EDR identity, container image, network interfaces).
2. `build` stages the committed sources byte-for-byte into a tmpfs work directory and compiles them. It writes `build_manifest.<profile>.json`.
3. `envcheck` runs the behavioural hardfork markers.
4. `exec` runs the cells, each on a fresh chain, and writes `cells/*.json`.
5. `finish` writes `local_l1_ops.csv` and the accepted-checks verdict.

The unit tests run first, in their own container. After the runs, `compare_runs.py` checks determinism (EDR a against b) and cross-client agreement (EDR a against geth).

## Adding a workload

See `workloads/README.md`. The core files above do not change. A new venue for an existing workload is a new file in `workloads/<name>/campaigns/`.
