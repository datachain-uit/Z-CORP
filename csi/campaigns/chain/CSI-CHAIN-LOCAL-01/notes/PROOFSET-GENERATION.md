# PS-01 proof set: generation record (CHAIN-PROTOCOL-v1 §3)

## Frozen proof set

- **Location:** `inputs/proofset/`, 64 proofs = 2 backends × 4 depths {5, 10, 11, 15} × K = 8.
- **Leaf indices:** i_j = (2j + 1) · 2^(d−4).
- **Manifest:** `PROOFSET.csv`, `PROOFSET.sha256` and `PROOFSET.json`.
- **Generation:** `chainbench/scripts/gen_proofset.js` (resumable version), in three invocations from 2026-09-25T09:36:52Z to 09:43:40Z, at commit `a7482a1` (the protocol freeze). Invocation details are in `PROOFSET.json`.
- **Environment:** the Claude desktop Linux VM on the campaign host (Ubuntu 22.04, aarch64, 4 vCPU), Node v22.23.2, and snarkjs 0.7.5 / ffjavascript 0.3.1 from the chainbench lockfile.
- **Checks:**
  - every proof verified off-chain against the committed vkey;
  - every public signal equals the committed root for its depth;
  - the zkey, wasm, vkey and committed public files were checked against `ARTIFACTS.sha256` before generation.

## Two interrupted earlier attempts (discarded, never frozen or used)

The first generator version started one background process and returned. The desktop VM's execution environment ends every process of a shell call when that call returns, including detached ones. Both attempts were therefore terminated mid-run:

| Attempt | Started (UTC) | Proofs written before termination | Disposition |
|---|---|---|---|
| 1 | 2026-09-25T09:33:16.788Z | 15 (G16 and PLK d5 p0–p6; G16 d5 p7). All verified in the log. | Staging directory deleted, unused |
| 2 | 2026-09-25T09:35:35.431Z | 1 (G16-d5-p0) | Staging directory deleted, unused |

- **Nothing from these attempts was used.** Neither staging directory was renamed to `inputs/proofset/`, and none of their proofs were frozen, deployed, or examined for calldata or gas.
- **The selection rule was not changed.** The generator was then made resumable, so that each shell call finishes its work within the time limit. The frozen set is the first complete generation.
- **The replacement proofs differ.** Because Groth16 and PLONK proofs are randomised, the frozen proofs are different from the discarded ones. Under protocol §3.3 this is not a regeneration of a frozen proof.
