# Repository layout

```text
Z-CORP/
├── README.md
├── docs/
│   ├── README.md
│   ├── setup/
│   ├── experiments/
│   └── reference/
├── circuits/                    # Base and generated CredentialVerifier_Depth{N}.circom
├── contracts/                   # CredentialManager and Groth16LegacyVerifierDepth{N}.sol
├── data/
│   ├── diploma_samples.json     # Seed credentials retained in git
│   ├── merkle-trees/            # Generated full trees and processed credentials
│   ├── inputs/                  # Generated circuit inputs
│   ├── zkp-circuits/            # Generated R1CS and WASM artifacts
│   ├── groth16-witness/         # Generated Groth16 witness files
│   ├── groth16-public-proof/    # Generated Groth16 proofs and public signals
│   ├── groth16-vkeys/           # Generated Groth16 verification keys
│   ├── plonk-zkeys/             # Generated PLONK proving keys
│   ├── plonk-vkeys/             # Generated PLONK verification keys
│   ├── plonk-witness/           # Generated PLONK witness files
│   └── plonk-public-proof/      # Generated PLONK proofs and public signals
├── results/
│   ├── blockchain/              # Published on-chain measurements and figures
│   ├── constraints/             # Published constraint measurements and figures
│   └── proving/                 # Published Groth16 and PLONK benchmarks
├── scripts/
│   ├── setup/                   # Circuit generation, compilation, setup, and inputs
│   ├── merkletree/              # Full Merkle-tree preparation
│   ├── proving/                 # Proof-generation and benchmark pipelines
│   ├── constraints/             # Constraint and gate measurement
│   └── blockchain/              # Deployment and on-chain verification
├── test/                        # Hardhat tests
├── hardhat.config.js
├── Dockerfile
├── package.json
├── pot16_final.ptau             # Sample Powers-of-Tau file for reproduction
└── secret.json                  # Local deployer key; gitignored and user-created
```

Intermediate artifacts under `data/` are generated locally and are generally
excluded from version control. Published measurements and figures used for
artifact evaluation are retained under `results/`.

Return to the [documentation index](../README.md).
