# chainbench execution adapters

chainbench separates what is measured (a *workload*: contracts, inputs, cell procedure; `workloads/<name>/`) from where
it is executed (an *adapter*: node start-up, compiler, transaction mechanics, gas accounting). The reusable,
venue-neutral parts are in `core/` and `lib/` (workload binding, network-isolation check, JSON-RPC access, hashing and
git provenance, raw CSV writing).

| Adapter | Venue | Where it lives | Status |
|---|---|---|---|
| `evm` | local L1 (EVM): Hardhat EDR (Osaka) and a geth `--dev` replay | the original L1 paths (`lib/`, `scripts/run_l1.js`, `docker/`, `run.sh`), see `evm/README.md` | frozen at `chain-l1-baseline-20260925` (CSI-CHAIN-LOCAL-01 L1, validated) |
| `eravm` | local EraVM: anvil-zksync 0.6.11 (protocol v29) + zksolc 1.5.15 / era-solc 0.8.20-1.0.2 | `eravm/` | readiness (CHAIN-PROTOCOL-v1 section 16, A6) |

Both adapters run the same workload (`workloads/zcorp`: the same contracts, depths, proof set PS-01 and cell procedure)
in their own pinned Docker image, with `--network none` and the repository mounted read-only.
