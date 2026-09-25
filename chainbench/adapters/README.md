# chainbench execution adapters

chainbench separates what is measured (a *workload*: contracts, inputs, cell procedure; `workloads/<name>/`) from where
it is executed (an *adapter*: node start-up, compiler, transaction mechanics, gas accounting). The reusable,
venue-neutral parts are in `core/` and `lib/` (workload binding, network-isolation check, JSON-RPC access, hashing and
git provenance, raw CSV writing).

| Adapter | Venue | Where it lives | Status |
|---|---|---|---|
| `evm` | local L1 (EVM): Hardhat EDR (Osaka) and a geth `--dev` replay | the original L1 paths (`lib/`, `scripts/run_l1.js`, `docker/`, `run.sh`), see `evm/README.md` | frozen at `chain-l1-baseline-20260925` (CSI-CHAIN-LOCAL-01 L1, validated) |
| `eravm` | local EraVM: anvil-zksync 0.6.11 (protocol v29) + zksolc 1.5.15 / era-solc 0.8.20-1.0.2 | `eravm/` | frozen at `chain-l2-baseline-20260925` (CSI-CHAIN-LOCAL-01-L2, validated) |
| `public` | public test networks: Ethereum Sepolia and ZKsync Era Sepolia (dated case study, not a cost benchmark) | `public/` | planned (CHAIN-PUBLIC-PROTOCOL-v1; CSI-CHAIN-PUBLIC-01) |

The two local adapters run the same workload (`workloads/zcorp`: the same contracts, depths, proof set PS-01 and cell
procedure) in their own pinned Docker image, with `--network none` and the repository mounted read-only. The `public`
adapter deploys the same workload's frozen artifacts and proof calldata on public test networks (its dry run uses mock
endpoints and `--network none`; only its live commands use the network).
