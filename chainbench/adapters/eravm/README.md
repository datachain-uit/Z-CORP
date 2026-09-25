# EraVM adapter (local-EraVM arm, L2)

Thin adapter that runs the zcorp workload on a local EraVM node. Protocol: CHAIN-PROTOCOL-v1 section 16 (amendment A6).
Binding: `workloads/zcorp/campaigns/CSI-CHAIN-LOCAL-01-L2.json`.

## Reviewer commands (Docker only)

```
./chainbench/run.sh doctor-l2      # host + in-container checks; builds the image on first use; runs no experiment
./chainbench/run.sh smoke-l2       # 2 cells (Groth16 d5, PLONK d10), 1 proof, all negative controls; < 1 min; NOT scientific data
./chainbench/run.sh dry-run-l2     # 4 cells, 2 proofs, twice from scratch, validation and determinism; NOT scientific data
./chainbench/run.sh full-local-l2  # the frozen scientific procedure; refuses to start without the L2 baseline tag and the archived image
```

No global Node, zksolc or solc, no private key, no test ETH, no public RPC: everything runs in the `chainbench-l2`
image (base `node:22.23.2-bookworm-slim` by digest; anvil-zksync, zksolc and era-solc release binaries accepted only by
sha256, `pins.env`; npm dependencies from `package-lock.json`) with `--network none`, on local dev accounts.

## What is measured, and what is not

Per transaction, from the node's own fee computation (zksync-era multivm `compute_refund`, emitted at TRACE level and
parsed from the per-cell node log `nodes/<cell>/anvil.log`):

- `computational_gas`: EraVM gas charged for computation (gas limit minus the bootloader refund minus the pubdata charge);
- `pubdata_bytes`: bytes of pubdata the transaction published (state diffs, L2-to-L1 messages, compressed bytecode);
- `pubdata_gas` = `pubdata_bytes` x `gas_per_pubdata` (84 under the fixed local fee input);
- `gas_used`: the receipt value, reported only as derived under the local fee input; every row must reproduce it exactly
  from `computational_gas`, `pubdata_bytes` and the fee input (`gas_used_derived`, `accounting_ok`);
- outcome (status, revert reason, return value), EraVM bytecode size and versioned hash, calldata size.

Not measured, never claimed: live fees, live `gasPerPubdata`, L1 publication cost, latency, finality, batch or proving
cost. EraVM gas is not EVM gas: no L2 number is compared numerically with an L1 number.

The fee input is fixed by anvil-zksync 0.6.11 itself: without a fork its fee model uses built-in defaults, and the
`--l1-gas-price`, `--l2-gas-price` and `--l1-pubdata-price` options only change the start-up banner
(`crates/core/src/node/fee_model.rs`, verified by identical receipts). See `lib/constants.js`.

## Files

`lib/constants.js` (frozen parameters), `lib/anvil.js` (fresh node per cell; fee-record parser), `lib/compile.js`
(zksolc standard JSON; build manifest), `lib/ops.js` (section 7 sequence as EIP-712 transactions), `lib/plan.js`,
`lib/schema.js`; `scripts/run_l2.js` (runner: init, build, envcheck, exec, finish), `scripts/validate_l2.py`,
`scripts/compare_l2.py`, `scripts/check_smoke_l2.py`, `scripts/summarize_l2.py`, `scripts/identity_l2.js`;
`doctor/doctor_l2.js`; `Dockerfile`, `pins.env`, `incontainer.sh`, `run-l2.sh`; `observe-public.sh` (read-only live
observation, run once on the campaign host, never during a measurement).

## Evidence entry and scientific image

The L2 arm is registered as its own CSI evidence entry, `CSI-CHAIN-LOCAL-01-L2` (records in
`csi/campaigns/chain/CSI-CHAIN-LOCAL-01-L2/`, protocol amendment A7). `full-local-l2` runs only in the archived scientific
image recorded in `ARCHIVE.json` (linux/arm64, image `sha256:255d0dac…91cc`); it refuses a rebuilt or other image and any
emulated platform. To use the archive on a new machine:

```
./chainbench/run.sh load-image-l2 csi/release/CSI-CHAIN-LOCAL-01-L2/image/chainbench-l2-arm64.oci.tar csi/release/CSI-CHAIN-LOCAL-01-L2/IMAGE-ARCHIVE.arm64.json
```

The archive is not versioned (Zenodo deposit); its sha256 and the sha256 of the binaries inside it are in
`csi/release/CSI-CHAIN-LOCAL-01-L2/IMAGE-ARCHIVE.json`. Derivations: `scripts/analysis/derive_chain_l2.py` (fixed before the
scientific run; EraVM units only).
