# Experiment 4: PLONK prover-side performance

This experiment generates PLONK proof artifacts and measures input generation,
witness generation, proof generation, off-chain verification, and total
execution time for Merkle-tree depths 5–15.

## Generate PLONK artifacts

```bash
node scripts/proving/prove_all_depths-plonk.js
```

Pipeline:

```text
inputs -> plonk setup -> witness -> plonk prove -> export vkey -> local verify
```

Outputs for each depth `N` and index `0`:

| Artifact | Path |
|---|---|
| PLONK zkey | `data/plonk-zkeys/CredentialVerifier_Depth{N}_plonk.zkey` |
| Witness | `data/plonk-witness/witness_depth_{N}_index_0.wtns` |
| Proof | `data/plonk-public-proof/proof_depth_{N}_index_0.json` |
| Public signals | `data/plonk-public-proof/public_depth_{N}_index_0.json` |
| Verification key | `data/plonk-vkeys/CredentialVerifier_Depth{N}_plonk_vkey.json` |

Equivalent setup example for depth 11:

```bash
snarkjs plonk setup \
  data/zkp-circuits/CredentialVerifier_Depth11/CredentialVerifier_Depth11.r1cs \
  pot16_final.ptau \
  data/plonk-zkeys/CredentialVerifier_Depth11_plonk.zkey
```

## Run the benchmark

PLONK zkeys must exist before this command is run.

```bash
node scripts/proving/benchmark-plonk.js
```

Result file:

```text
results/proving/{timestamp}-depth5-15-plonk-index0.csv
```

The result contains input-generation, witness-generation, proving,
off-chain-verification, total-time, and execution-status fields.

## Published artifacts

The measurements collected on the three evaluation environments and Figure 8
are documented in:

[results/proving/4.2.3-PLONK-Prover-Side-performance](../../results/proving/4.2.3-PLONK-Prover-Side-performance/)
