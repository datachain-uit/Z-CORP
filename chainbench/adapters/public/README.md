# chainbench public-network adapter (CSI-CHAIN-PUBLIC-01)

A venue-neutral adapter that runs a workload's frozen artifacts on public test networks and records dated observations:
deployability, observed price and paid fee, request→hash and hash→receipt behaviour through a named RPC endpoint,
public-network `gasUsed`, client/RPC failures and, for ZKsync Era, post-hoc batch commit/prove/execute times. It is not a
cost benchmark; the controlled measurements are the local L1 and EraVM arms. Protocol:
`csi/protocols/chain/CHAIN-PUBLIC-PROTOCOL-v1.md`. Campaign binding: `workloads/zcorp/campaigns/CSI-CHAIN-PUBLIC-01.json`.
Workload procedure: `workloads/zcorp/public/procedure.json`.

## Reviewer commands (no key, no test ether)

```
./chainbench/run.sh build-image-public        # once: pinned Node image + npm ci of this package (10 packages)
./chainbench/run.sh doctor-public --offline   # adapter, inputs, schedule, key rules (never signs or sends)
./chainbench/run.sh check-public-inputs       # frozen artifacts and proof calldata vs the controlled study
./chainbench/run.sh dry-run-public            # engineering dry run: mock endpoints, --network none, ephemeral key
./chainbench/run.sh derive-public [ROOT]      # validation + dated summaries of recorded public runs
```
`CHAINBENCH_PUBLIC_NATIVE=1` runs the same commands with a host Node 22 (`npm ci --ignore-scripts` here first) and
python3 instead of the image.

## Author commands (live; spend test ether)

```
export CHAINBENCH_PUBLIC_KEY_FILE=/absolute/path/outside/the/repo/public.key   # 0x-hex key, chmod 600, dedicated
export CHAINBENCH_PUBLIC_RPC_SEPOLIA=https://...  CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA='provider name'
export CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA=https://sepolia.era.zksync.dev  CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA='ZKsync official'
./chainbench/run.sh doctor-public                  # read-only observation of both endpoints, signer balance
./chainbench/run.sh run-public-setup sepolia       # asks you to type setup-sepolia
./chainbench/run.sh run-public-setup era-sepolia
./chainbench/run.sh run-public-session S1          # at the frozen time; S2, S3 later
./chainbench/run.sh collect-era-finality           # later, read-only
```

## What runs, and what does not

- Runtime dependencies: `ethers` 6.13.5 and `zksync-ethers` 6.21.2 only (signing, ABI encoding, EIP-1559 and EIP-712
  serialisation) — the same versions as the frozen EraVM adapter. No Hardhat, compiler or prover at run time: artifacts
  and proof calldata are frozen inputs (`csi/campaigns/chain/CSI-CHAIN-PUBLIC-01/inputs/`, generated once by
  `scripts/build_public_inputs.js`).
- JSON-RPC goes through `node:https` (`lib/rpc.js`): no WebSocket, no ethers provider, no `fetch`/undici. Live endpoints
  must be https; the dry run accepts only `http://127.0.0.1`.
- Key safety (`lib/keysafety.js`): a dedicated raw key from a file outside the repository (0600/0400) or the environment;
  refuses mnemonics, keys inside the repository, readable key files and every known development account; the key never
  leaves the module and every written file passes a secret guard.
- Chain safety (`lib/networks.js`): the endpoint's chain id must equal the profile's (11155111, 300); mainnets, local/dev
  chains and the other network's id are refused before anything is signed.

| File | Role |
|---|---|
| `lib/networks.js`, `lib/rpc.js`, `lib/keysafety.js` | chain-id rules, timed JSON-RPC and endpoint rules, key safety |
| `lib/observe.js`, `lib/feepolicy.js`, `lib/txengine.js` | read-only observations, frozen send policy, one operation → one classified row |
| `lib/plan.js`, `lib/schema.js`, `lib/recorder.js`, `lib/inputs.js` | 40-transaction schedule, raw columns and states, secret-guarded writer, frozen inputs |
| `scripts/run_public.js`, `scripts/doctor_public.js`, `scripts/collect_era_finality.js` | setup/session runner, doctor, Era batch lifecycle |
| `scripts/dry_run_public.js`, `scripts/mock_rpc.js` | engineering dry run with deterministic mock endpoints and injected faults |
| `scripts/build_public_inputs.js`, `scripts/check_public_inputs.py` | frozen inputs (author) and their reviewer check |
| `../../../scripts/analysis/derive_chain_public.py` | validation and derived summaries |
