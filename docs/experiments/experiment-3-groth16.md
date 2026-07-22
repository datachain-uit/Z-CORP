# Experiment 3: Groth16 prover-side performance

This experiment generates Groth16 proof artifacts and measures input generation,
witness generation, proof generation, off-chain verification, and total
execution time for Merkle-tree depths 5–15.

## Generate Groth16 artifacts

```bash
node scripts/proving/prove_all_depths-groth16.js
```

Pipeline:

```text
inputs -> witness -> groth16 prove -> export vkey -> local verify
```

Outputs for each depth `N` and index `0`:

| Artifact | Path |
|---|---|
| Witness | `data/groth16-witness/witness_depth_{N}_index_0.wtns` |
| Proof | `data/groth16-public-proof/proof_depth_{N}_index_0.json` |
| Public signals | `data/groth16-public-proof/public_depth_{N}_index_0.json` |
| Verification key | `data/groth16-vkeys/CredentialVerifier_Depth{N}_vkey.json` |

Skip input generation when inputs already exist:

```bash
node scripts/proving/prove_all_depths-groth16.js --skip-inputs
```

## Run the benchmark

```bash
node scripts/proving/benchmark-groth16.js
```

Result file:

```text
results/proving/{timestamp}-depth5-15-groth16-index0.csv
```

CSV columns:

```text
Depth, Input(s), Witness(s), Prove(s), Verify(s), Total(s), Status
```

## Published artifacts

The measurements collected on the three evaluation environments and Figure 7
are documented in:

[results/proving/4.2.2-Groth16-Prover-Side-performance](../../results/proving/4.2.2-Groth16-Prover-Side-performance/)
