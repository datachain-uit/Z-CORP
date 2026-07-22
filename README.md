# Z-CORP

This repository contains the implementation and experimental artifacts accompanying the paper:

**An Architectural and Empirical Study of Root-Only Zero-Knowledge Verification**

## Overview

Z-CORP supports reproducible evaluation of a root-only zero-knowledge
verification workflow. The repository includes Circom circuits, Groth16 and
PLONK proving pipelines, Solidity verifier contracts, blockchain deployment
scripts, and the published experimental measurements used in the paper.

## Evaluation workflows

| Workflow | Scope | Reproduction guide | Published artifacts |
|---|---|---|---|
| Blockchain deployment and verification | Deploy `CredentialManager` and execute Groth16 proof verification on Ethereum Sepolia, zkSync Sepolia, or local Hardhat | [Experiment 1](docs/experiments/experiment-1-blockchain.md) | [Blockchain results](results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/) |
| Circuit growth | Measure Groth16 R1CS constraints and expanded PLONK gates for Merkle-tree depths 5–15 | [Experiment 2.1](docs/experiments/experiment-2-constraints.md) | [Constraint results](results/constraints/4.2.1-The-Growth-of-Depth-Parameterized-Circuit/) |
| Groth16 prover-side performance | Benchmark input, witness, proving, and off-chain verification time across depths 5–15 | [Experiment 2.2](docs/experiments/experiment-3-groth16.md) | [Groth16 results](results/proving/4.2.2-Groth16-Prover-Side-performance/) |
| PLONK prover-side performance | Benchmark input, witness, proving, and off-chain verification time across depths 5–15 | [Experiment 2.3](docs/experiments/experiment-4-plonk.md) | [PLONK results](results/proving/4.2.3-PLONK-Prover-Side-performance/) |

## Tested environment

| Component | Version |
|---|---|
| Node.js | 18.20.8 |
| npm | 10.8.2 |
| Circom | 2.1.6 |
| snarkjs | 0.7.5 |
| Hardhat | 2.23.x |

The recommended environment is the Docker image
`zk-toolchain:node18-circom216`. Hardhat 2.23.x is used for compatibility with
the `@matterlabs/hardhat-zksync-*` plugins on Node.js 18.

## Quick start

Clone the repository and build the provided Docker image:

```bash
git clone https://github.com/datachain-uit/Z-CORP.git
cd Z-CORP

docker build -t zk-toolchain:node18-circom216 .
```

Start the toolchain container:

```bash
docker network inspect zknet >/dev/null 2>&1 || docker network create zknet

docker run -it --rm \
  --network zknet \
  -v "$PWD":/workspace \
  -w /workspace \
  zk-toolchain:node18-circom216 \
  bash
```

Inside the container:

```bash
npm install
```

The complete environment, setup, and artifact-generation instructions are
provided in [docs/setup](docs/setup/README.md).

## Documentation

- [Documentation index](docs/README.md)
- [Environment and setup](docs/setup/README.md)
- [Experiment reproduction](docs/experiments/README.md)
- [Repository layout](docs/reference/repository-layout.md)
- [Scripts reference](docs/reference/scripts.md)
- [Troubleshooting](docs/reference/troubleshooting.md)

## Required and generated artifacts

A sample `pot16_final.ptau` file and the seed dataset
`data/diploma_samples.json` are included for experimental reproduction.

Create `secret.json` locally only when deploying to a blockchain network. The
file is gitignored and must not contain a production or mainnet private key.

Intermediate artifacts under `data/` are generated locally and are generally
excluded from version control. Published measurements and figures required for
artifact evaluation are retained under `results/`.

## Data availability

The complete implementation is available in this repository. Published
experimental artifacts are also available through Zenodo:

https://doi.org/10.5281/zenodo.21447872

## License

ISC, as specified in `package.json`.
