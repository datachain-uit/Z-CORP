# Environment and setup

Z-CORP is intended to run inside the Docker environment provided by the
repository. Commands in the reproduction guides should be executed from the
repository root, mounted as `/workspace` inside the toolchain container.

## Tested environment

| Component | Version |
|---|---|
| Node.js | 18.20.8 |
| npm | 10.8.2 |
| Circom | 2.1.6 |
| snarkjs | 0.7.5 |
| Hardhat | 2.23.x |

The Docker image is named `zk-toolchain:node18-circom216`. Hardhat 2.23.x is
required for compatibility with the `@matterlabs/hardhat-zksync-*` plugins on
Node.js 18.

## Setup guides

1. [Build and start the Docker environment](docker.md)
2. [Generate circuits, trees, inputs, and proof artifacts](artifact-generation.md)
3. [Run a local Hardhat network](local-hardhat.md), when public testnets are not required

## Required files

### Powers-of-Tau

A ready-to-use sample `pot16_final.ptau` file is included in the repository
root. It is used by:

- Groth16 trusted setup through `setup_circuits_all.js`
- PLONK setup through `prove_all_depths-plonk.js`

The bundled file is provided for artifact evaluation and experimental
reproduction. A separately generated ceremony artifact should be used for a
production deployment.

### Hardhat wallet

Create `secret.json` in the repository root only when blockchain deployment is
required. The file is gitignored.

```json
{
  "privateKey": "0x1111111111111111111111111111111111111111111111111111111111111111"
}
```

For Ethereum Sepolia or zkSync Sepolia, replace the dummy value with the private
key of a dedicated funded testnet account.

Do not commit a real private key. Do not use a production or mainnet wallet.

### Seed data

`data/diploma_samples.json` is included and is used as the template for
generating full Merkle trees.

## Recommended order

```text
1. Install npm dependencies
2. Generate and compile circuits
3. Generate Groth16 setup artifacts and verifier contracts
4. Build full Merkle trees
5. Generate circuit inputs
6. Generate Groth16 proofs
7. Run Groth16 benchmarks
8. Generate PLONK setup artifacts and proofs
9. Run PLONK benchmarks
10. Measure constraint and gate counts
11. Deploy and run on-chain verification
```

Groth16 proof generation is required before the blockchain verification
experiment. See the [artifact-generation pipeline](artifact-generation.md) for
the exact commands.
