# Artifact-generation pipeline

Run all commands inside the toolchain container from `/workspace`.

## Reproduction order

```text
1. npm install
2. node scripts/setup/setup_circuits_all.js
3. node scripts/merkletree/prep_full_merkle_all_depths.js
4. node scripts/setup/generate_input_all_depths.js
5. node scripts/proving/prove_all_depths-groth16.js
6. node scripts/proving/benchmark-groth16.js
7. node scripts/proving/prove_all_depths-plonk.js
8. node scripts/proving/benchmark-plonk.js
9. node scripts/constraints/measure_depth_constraints.js
10. deploy and run credential-verification
```

Steps 5–8 can be reordered. The blockchain verification experiment requires a
Groth16 proof for depth 11, the corresponding verifier contract, and the
Merkle-tree root.

## 1. Circuits, Groth16 keys, and verifier contracts

Generate circuits for depths 5–15, compile them, run the Groth16 setup, and
export the Solidity verifier contracts:

```bash
node scripts/setup/setup_circuits_all.js
```

Outputs for each depth `N`:

| Artifact | Path |
|---|---|
| Compiled circuit | `data/zkp-circuits/CredentialVerifier_Depth{N}/` |
| Groth16 zkey | `data/zkp-circuits/CredentialVerifier_Depth{N}/CredentialVerifier_Depth{N}_0001.zkey` |
| Verifier contract | `contracts/Groth16LegacyVerifierDepth{N}.sol` |

This step can be slow at depths 12–15. Limit the range when needed:

```bash
node scripts/setup/setup_circuits_all.js --from 11 --to 11
```

## 2. Full Merkle trees

Build trees with exactly `2^N` real leaves and no zero-padding:

```bash
node scripts/merkletree/prep_full_merkle_all_depths.js
```

Outputs for each depth `N`:

| Artifact | Path |
|---|---|
| Raw samples | `data/merkle-trees/diploma_samples_min_{2^N}.json` |
| Processed credentials | `data/merkle-trees/processed_diplomas_{2^N}.json` |
| Merkle tree and proofs | `data/merkle-trees/merkle_tree_data_depth_{N}.json` |

## 3. Circuit inputs

Generate inputs for depths 5–15 at leaf index 0:

```bash
node scripts/setup/generate_input_all_depths.js
```

Outputs:

```text
data/inputs/input_depth_{N}_index_0.json
```

## 4. Groth16 artifacts

Generate witnesses, proofs, public signals, verification keys, and local
verification results:

```bash
node scripts/proving/prove_all_depths-groth16.js
```

Outputs for each depth `N`:

| Artifact | Path |
|---|---|
| Witness | `data/groth16-witness/witness_depth_{N}_index_0.wtns` |
| Proof | `data/groth16-public-proof/proof_depth_{N}_index_0.json` |
| Public signals | `data/groth16-public-proof/public_depth_{N}_index_0.json` |
| Verification key | `data/groth16-vkeys/CredentialVerifier_Depth{N}_vkey.json` |

Skip input generation when the inputs already exist:

```bash
node scripts/proving/prove_all_depths-groth16.js --skip-inputs
```

## 5. PLONK artifacts

Generate PLONK setup artifacts, witnesses, proofs, public signals, verification
keys, and local verification results:

```bash
node scripts/proving/prove_all_depths-plonk.js
```

Outputs for each depth `N`:

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

## 6. Run the experiments

Continue with the relevant guide:

- [Blockchain deployment and verification](../experiments/experiment-1-blockchain.md)
- [Circuit-growth measurement](../experiments/experiment-2.1-constraints.md)
- [Groth16 performance](../experiments/experiment-2.2-groth16.md)
- [PLONK performance](../experiments/experiment-2.3-plonk.md)
