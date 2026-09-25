# chainbench public-network adapter (CSI-CHAIN-PUBLIC-01)

A venue-neutral adapter that runs a workload's frozen artifacts on public test networks and records dated observations:
deployability, observed price and paid fee, request→hash and hash→receipt behaviour through a named RPC endpoint,
public-network `gasUsed`, client/RPC failures and, for ZKsync Era, post-hoc batch commit/prove/execute times. It is not a
cost benchmark; the controlled measurements are the local L1 and EraVM arms. Protocol:
`csi/protocols/chain/CHAIN-PUBLIC-PROTOCOL-v1.md`. Campaign binding: `workloads/zcorp/campaigns/CSI-CHAIN-PUBLIC-01.json`.
Workload procedure: `workloads/zcorp/public/procedure.json`.

## Reviewer commands (no key, no RPC credential, no test ether)

```
./chainbench/run.sh load-image-public ARCHIVE # the frozen image (sha256 checked against ARCHIVE.json), or build-image-public for your own
./chainbench/run.sh verify-image-public       # is the loaded image the frozen one (index, manifest, config, archive)?
./chainbench/run.sh doctor-public --offline   # adapter, inputs, schedule, image record, key rules, frozen endpoints (never signs or sends)
./chainbench/run.sh check-public-inputs       # frozen artifacts and proof calldata vs the controlled study
./chainbench/run.sh dry-run-public            # engineering dry run: mock endpoints, --network none, ephemeral key (92 expectations)
./chainbench/run.sh test-guards-public        # key-file rules (GNU and BSD stat), image guard, endpoint policy, VP12/VP13
./chainbench/run.sh derive-public [ROOT]      # validation + dated summaries of recorded public runs
```
`CHAINBENCH_PUBLIC_NATIVE=1` runs the same reviewer commands with a host Node 22 (`npm ci --ignore-scripts` here first)
and python3 instead of the image. Live commands never run natively.

## Frozen image (live commands)

Setup, sessions and finality collection run only in the image recorded in `ARCHIVE.json` (written by
`save-image-public` from the saved OCI archive; image-index digest = Docker image ID, platform manifest, config, archive
sha256, architecture, with the index/manifest/config blobs verbatim). `run-public.sh` verifies the loaded image against
it before anything else, starts the container by digest, passes the verified identity to the runner (which refuses a live
run without it, before loading the key, and records it in `run.json`) and verifies the image again afterwards; both
checks go to `IMAGE-LEDGER.jsonl` in the live output root. `tools/test_wrapper_guards.sh` exercises these refusals through
the wrapper (host with Docker; no key, nothing sent).

## Author commands (live; spend test ether)

The dedicated key is created and checked only with the versioned tools (never printed; only the address is shown):

```
bash chainbench/adapters/public/tools/new_public_key.sh "$HOME/.chainbench-keys/csi-chain-public-01.key"
bash chainbench/adapters/public/tools/verify_public_key.sh "$HOME/.chainbench-keys/csi-chain-public-01.key" 0x<ADDRESS>
```

```
export CHAINBENCH_PUBLIC_KEY_FILE="$HOME/.chainbench-keys/csi-chain-public-01.key"   # host rules: lib/guards.sh
export CHAINBENCH_PUBLIC_RPC_SEPOLIA=https://...        # must hash to the frozen primary (binding endpoints.frozen)
export CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA=https://sepolia.era.zksync.dev
./chainbench/run.sh verify-image-public
./chainbench/run.sh doctor-public                  # read-only observation of both endpoints, signer balance, endpoint roles
./chainbench/run.sh run-public-setup sepolia       # asks you to type setup-sepolia
./chainbench/run.sh run-public-setup era-sepolia
./chainbench/run.sh run-public-session S1          # at the frozen time; S2, S3 later
./chainbench/run.sh collect-era-finality           # later, read-only
```
The recorded provider label is the frozen one (a different `CHAINBENCH_PUBLIC_RPC_LABEL_*` for a frozen URL is refused).
A validated secondary endpoint (`endpoints.secondary`) is used only after a documented failure of the primary, recorded as
a protocol deviation and named by `CHAINBENCH_PUBLIC_DEVIATION` (CHAIN-PUBLIC-PROTOCOL-v1 section 3.3); there is no
automatic fail-over.

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
| `lib/imageid.js`, `lib/endpoints.js`, `lib/guards.sh`, `ARCHIVE.json` | frozen-image record and live guard, frozen endpoints and fallback policy, host key-file and image checks |
| `tools/new_public_key.sh`, `tools/verify_public_key.sh` | the canonical author key tools (key never printed) |
| `tools/image_record.py`, `tools/rpc_compat_public.js` | image record from the saved archive; read-only RPC compatibility probe (primary or secondary) |
| `tools/test_guards_public.sh` (+ `test_keyfile.sh`, `test_guards_public.js`), `tools/test_wrapper_guards.sh` | guard tests (no key, no network); wrapper tests (host with Docker) |
| `../../../scripts/analysis/derive_chain_public.py` | validation and derived summaries |
