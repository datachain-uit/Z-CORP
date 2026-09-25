# chainbench: local L1 on-chain verification experiment

**Prerequisite: Docker.** Install Docker Desktop (macOS or Windows) or Docker Engine (Linux) and start it. Nothing else is needed: no Node.js, npm or Hardhat on your machine, no test ETH, no RPC keys, no private key, and no zkSNARK knowledge. Run every command from the root of the repository clone.

### 1. Run the environment check

```
./chainbench/run.sh doctor
```

- **What it checks:** Docker and its resources, the architecture, the toolchain image, the frozen proof set, the contract sources, the git state, the toolchain versions and hashes, and whether the output folders are writable. Each problem is printed as `[FAIL]` with a `Fix:` line.
- **What it does not do:** it never runs an experiment.
- **First run only:** it builds the pinned toolchain image. This needs network access once and takes a few minutes.
- **Or load the archived image** (no build and no network): `./chainbench/run.sh load-image chainbench-l1-arm64.oci.tar`, using the archive deposited with the campaign (its sha256 is in `chainbench/docker/ARCHIVE.json`). On linux/arm64, `full-local-l1` accepts only this exact image; set `CHAINBENCH_ALLOW_REBUILT_IMAGE=1` for a reproduction with a rebuilt image, which is then recorded as such.
- **Afterwards:** a few seconds to a minute.

### 2. Run the smoke test

```
./chainbench/run.sh smoke
```

- **What it runs:** a tiny subset, well under a minute. It compiles the contracts. It verifies one Groth16 proof and one PLONK proof through their managers. It sets up the managers and checks that an unknown root, a tampered proof and a non-issuer root publication are rejected. It writes and validates the CSV and runs the unit tests.
- **Reference check:** every gas value must equal the accepted reference values exactly.
- **Status:** not scientific data.

### 3. Run the full local L1 experiment

```
./chainbench/run.sh full-local-l1
```

This runs the frozen procedure of `csi/protocols/chain/CHAIN-PROTOCOL-v1.md`, in a few minutes:

1. the unit tests;
2. two independent EDR (Hardhat) runs, each from scratch in a fresh container;
3. a geth v1.16.9 `--dev` replay of every operation;
4. the determinism comparison (EDR run a against run b);
5. the cross-client comparison (EDR against geth);
6. a per-cell summary.

It starts only if the doctor passes with a clean checkout of the baseline tag (`git checkout chain-l1-baseline-…`). The doctor's result is saved next to the runs.

### 4. Find the outputs here

| Command | Output folder | Status |
|---|---|---|
| `doctor` | the terminal output | checks only |
| `smoke` | `build/chainbench/smoke/smoke-<time>/` | not data |
| `full-local-l1` | `build/campaigns/chain/full-<commit>-<time>-{edr-a,edr-b,geth}/` | scientific raw data |

- **Per-run files:** `local_l1_ops.csv` (raw rows, one per operation), `run.json`, `environment.json`, `build_manifest.*.json` and `env_check.json`.
- **Summary:** `…-edr-a/summary.csv`.
- **Comparisons:** `…-edr-b/compare_determinism.json` and `…-geth/compare_crossclient.json`.
- **Log and records:** `build/campaigns/chain/full-<commit>-<time>.log`, `….preflight.json` (the doctor) and `….unit_tests.log`.

---

## Time and disk

| Step | Time | Disk |
|---|---|---|
| Image build (first `doctor` only) | 1–5 min, depending on the network (45 s on the author's machine) | about 1 GB image (the npm dependencies alone are about 400 MB) |
| `doctor` | about 15 s | – |
| `smoke` | about 15 s | < 1 MB |
| `full-local-l1` | about 2–5 min (estimated from the packaged dry run) | a few MB |

The times were measured on an Apple M5 Mac with Docker Desktop (Engine 29.8; 10 vCPUs, 16 GB). The packaged dry run took 20 s for its three runs.

Docker needs at least 2 CPUs and 4 GB of memory. Keep 5 GB of disk free.

**Tested platforms.**

- **linux/arm64** (native, Apple M5, Docker Desktop): the platform of the scientific campaign.
- **linux/amd64** (Docker Desktop emulation on the same Mac): `doctor` and `smoke` pass. The smoke rows equal the arm64 rows on every field except the run ID.
- **Not tested:** a native x86-64 host.

On amd64 the native EDR binary differs from arm64 (`edr-linux-x64-gnu`), so the doctor reports architecture warnings. In the smoke subset, the gas values were identical to arm64. The archived images and their sha256 are listed in `csi/campaigns/chain/CSI-CHAIN-LOCAL-01/notes/PORTABILITY.md`.

## What is measured, and what is fixed

- **What is measured.** Gas for deployment, root publication and credential verification of the Z-CORP contracts: snarkjs Groth16 and PLONK verifiers behind a root-registry manager. The inputs are the frozen proof set PS-01 (64 proofs, `csi/campaigns/chain/CSI-CHAIN-LOCAL-01/inputs/proofset/`) on a local Osaka-rules chain. Gas is a deterministic function of code, inputs and fork rules, so two runs and two clients must agree exactly. The comparisons report any difference; they never normalise it.
- **What is frozen.** The protocol, the proof set, the contracts in `contracts/` and `contracts/chain/`, the compiler settings, the fork, the operation order, the raw-data schema and the validation rules. Do not change these files. The runner refuses a scientific run from a modified tree.
- **Why no network.** The measurement containers run with `--network none`. The doctor checks it: no interface except loopback is up, and there are no routes. Every run records the same check in its `environment.json`. The repository is mounted read-only, and every run uses a fresh container and a fresh work directory. Only the image build uses the network.

## Toolchain identity

| Component | Pinned as | Record |
|---|---|---|
| Base image | `node` 22.23.2 (Debian bookworm slim), by digest | `chainbench/docker/pins.env` |
| npm dependencies | `npm ci` from `chainbench/package-lock.json`: Hardhat 2.29.1, EDR 0.12.0-next.23, solc 0.8.20 (npm `soljson`), snarkjs 0.7.5, ethers 6.13.5, OpenZeppelin 4.9.0 | lockfile sha256 in `chainbench/docker/IMAGE.json` |
| geth | v1.16.9, commit `95665d57`: the official `ethereum/client-go` image, digest-pinned and version-checked. The fallback is the reproducible from-source build (`chainbench/geth/`). | `pins.env` and `IMAGE.json` |
| Full identity | node, npm, package versions, EDR native binary sha256, soljson sha256, geth sha256 and version, OS packages | `chainbench/docker/IMAGE.json` (the reference). The doctor compares the running image with it. |

- **About the EDR version.** Hardhat's `web3_clientVersion` reports `HardhatNetwork/2.29.1/@nomicfoundation/edr/0.3.8`. The npm package, and the authoritative version, is `@nomicfoundation/edr` **0.12.0-next.23**. The `0.3.8` is the version of the EDR Rust workspace crate (`edr_provider`, `CARGO_PKG_VERSION`) compiled into that npm release. Both are recorded in every `environment.json` (`edr_identity`), together with the sha256 of the native binary.

## Troubleshooting

- **Docker.** `docker: command not found`: install Docker. `daemon is not running`: start Docker Desktop.
- **Memory.** `Docker memory … bytes`: raise the memory limit in Docker Desktop > Settings > Resources.
- **Toolchain.** `toolchain differs`: rebuild the image with `./chainbench/run.sh build-image`, and do not edit `chainbench/package-lock.json`.
- **Dirty sources.** `measurement sources clean` fails: run `git status`, then discard local changes or check out the baseline tag.
- **Smoke.** A smoke failure means this environment does not reproduce the accepted measurements. Keep `build/chainbench/smoke/<run>/smoke_check.json` and report it. Do not run the full experiment.

## Other commands

| Command | Purpose |
|---|---|
| `./chainbench/run.sh build-image` | Rebuild the image from the committed pins. |
| `./chainbench/run.sh dry-run` | Reduced engineering dry run: Groth16 d5 and d11, PLONK d10 and d11, the bridge cell, 2 proofs. Same procedure as the full run. The output goes to `build/chainbench/dry-run/`. |
| `./chainbench/run.sh author-freeze` | Author only. Pins new image digests and builds the image, then runs `author-verify`. |
| `./chainbench/run.sh load-image <archive> [<record>]` | Load an archived image (`docker save` file) after checking its sha256 against `chainbench/docker/ARCHIVE.json` (or the given `IMAGE-ARCHIVE.<arch>.json`). |
| `./chainbench/run.sh save-image <dir> [--frozen]` | Archive the current image and its geth image with `docker save`, with sizes, sha256 values and OCI index. `--frozen` records the archive as the one that `full-local-l1` requires. |
| `CHAINBENCH_PLATFORM=linux/amd64 ./chainbench/run.sh doctor` (or `smoke`) | Portability check on another platform through emulation. It uses its own image and state; not scientific data. |
| `./chainbench/run.sh author-prefreeze <dir>` | Author only. Archives the frozen image, loads it back, runs the linux/amd64 portability doctor and smoke, then the native doctor and smoke. |
| `./chainbench/run.sh author-verify` | Author only. Runs doctor, smoke and a packaged dry run against the accepted readiness dry run, and writes a freeze record. It uses the existing image and does not rebuild. |

## Layout and reuse

chainbench separates a workload- and venue-neutral core from the workloads it measures:

- **Core:** chain start-up, compilation, transaction recording, gas decomposition, cross-client replay, comparisons, provenance, the container and the checks.
- **Workloads:** in `workloads/<name>/`. This experiment is the workload `zcorp`.
- **Venue metadata:** a campaign binding such as `workloads/zcorp/campaigns/CSI-CHAIN-LOCAL-01.json`.

See `chainbench/core/README.md` and `chainbench/workloads/README.md`.

## Local EraVM arm (L2)

The same workload also runs on a local EraVM node (anvil-zksync 0.6.11, protocol v29; zksolc 1.5.15 with era-solc
0.8.20-1.0.2) in its own pinned image, with its own binding (`workloads/zcorp/campaigns/CSI-CHAIN-LOCAL-01-L2.json`)
and protocol section (CHAIN-PROTOCOL-v1 section 16, amendment A6). Commands: `./chainbench/run.sh doctor-l2`,
`smoke-l2`, `dry-run-l2`, `full-local-l2`. Details and the metric definitions: `chainbench/adapters/eravm/README.md`;
adapter layout: `chainbench/adapters/README.md`.

The L1 campaign above is frozen at the tag `chain-l1-baseline-20260925`; reproduce it from that tag.
