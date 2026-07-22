# Scripts reference

| Purpose | Command |
|---|---|
| Full circuit setup for depths 5–15 | `node scripts/setup/setup_circuits_all.js` |
| Generate full Merkle trees for depths 5–15 | `node scripts/merkletree/prep_full_merkle_all_depths.js` |
| Generate circuit inputs for depths 5–15 | `node scripts/setup/generate_input_all_depths.js` |
| Generate Groth16 artifacts | `node scripts/proving/prove_all_depths-groth16.js` |
| Benchmark Groth16 | `node scripts/proving/benchmark-groth16.js` |
| Generate PLONK artifacts | `node scripts/proving/prove_all_depths-plonk.js` |
| Benchmark PLONK | `node scripts/proving/benchmark-plonk.js` |
| Measure constraints and expanded PLONK gates | `node scripts/constraints/measure_depth_constraints.js` |
| Deploy `CredentialManager` | `npx hardhat run scripts/blockchain/deploy_credential_manager.js --network NETWORK` |
| Run on-chain verification | `npx hardhat credential-verification --network NETWORK --manager ADDRESS --depth 11 --index 0 --iterations 50` |
| Run issuer-access test | `npx hardhat test test/CredentialManager.issuerAccess.js` |

See the [experiment guides](../experiments/README.md) for required inputs and
output locations.
