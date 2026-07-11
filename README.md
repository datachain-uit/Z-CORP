# Z-CORP

This repository contains the implementation and experimental artifact accompanying the paper:

**An Architectural and Empirical Study of Root-Only Zero-Knowledge Verification**

---

## Experimental scope

The repository supports three experiment groups:

1. **On-chain verification** — deploy `CredentialManager` and run Groth16 proof verification on **Ethereum Sepolia** and **zkSync Sepolia** (or locally via Hardhat).
2. **Proving-time comparison** — benchmark **Groth16** vs **PLONK** across Merkle tree depths **5–15** (full trees, no zero-padding).
3. **Constraint-count comparison** — measure R1CS constraints (Groth16) vs expanded PLONK gates for depths **5–15**.

---

## Environment

| Component | Version |
|-----------|---------|
| Node.js | 18.20.8 |
| npm | 10.8.2 |
| Circom | 2.1.6 |
| snarkjs | 0.7.5 |
| Hardhat | ^2.23.0 |

The toolchain is tested inside the Docker image `zk-toolchain:node18-circom216` (Node 18 + Circom 2.1.6 + snarkjs 0.7.5). Hardhat **2.23.x** is required for compatibility with `@matterlabs/hardhat-zksync-*` plugins on Node 18.

---

## Repository layout

```
Z-CORP/
├── circuits/                    # Base + generated CredentialVerifier_Depth{N}.circom
├── contracts/                   # CredentialManager + Groth16LegacyVerifierDepth{N}.sol
├── data/
│   ├── diploma_samples.json     # Seed credentials (tracked in git)
│   ├── merkle-trees/            # Full Merkle trees + processed credentials (generated)
│   ├── inputs/                  # Circuit inputs per depth/index (generated)
│   ├── zkp-circuits/            # Compiled R1CS/WASM per depth (generated)
│   ├── groth16-witness/         # Groth16 witness files (generated)
│   ├── groth16-public-proof/    # Groth16 proof + public signals (generated)
│   ├── groth16-vkeys/           # Groth16 verification keys (generated)
│   ├── plonk-zkeys/             # PLONK zkeys (generated)
│   ├── plonk-vkeys/             # PLONK verification keys (generated)
│   ├── plonk-witness/           # PLONK witness files (generated)
│   └── plonk-public-proof/      # PLONK proof + public signals (generated)
├── results/
│   ├── proving/                 # Groth16 / PLONK benchmark CSVs
│   ├── constraints/             # Constraint-count CSVs
│   └── blockchain/              # On-chain verification CSVs
├── scripts/
│   ├── setup/                   # Circuit generation, compile, Groth16 setup, inputs
│   ├── merkletree/              # Full Merkle tree preparation
│   ├── proving/                 # Prove-all pipelines + benchmarks
│   ├── constraints/             # Constraint measurement
│   └── blockchain/              # Deploy + on-chain verification
├── hardhat.config.js
├── pot16_final.ptau             # Powers-of-tau (NOT in git — see Prerequisites)
└── secret.json                  # Deployer private key (NOT in git — see below)
```

Most generated artifacts under `data/` and `results/` are listed in `.gitignore` and are **not pushed to git**. Reproduce them by following the steps below.

---

## Prerequisites

### 1. Powers-of-tau file

Place **`pot16_final.ptau`** in the project root. It is required for:

- Groth16 trusted setup (`setup_circuits_all.js`)
- PLONK setup (`prove_all_depths-plonk.js`)

### 2. Hardhat wallet (`secret.json`)

Create `secret.json` at the project root (this file is gitignored):

```json
{
  "privateKey": "0xYOUR_PRIVATE_KEY_HERE"
}
```

- **Sepolia** and **zkSync Sepolia** require a funded testnet account with Sepolia ETH (and ETH on zkSync Sepolia for L2 gas).
- Do **not** commit real keys. Use your own wallet or a dedicated test account.

### 3. Seed data

`data/diploma_samples.json` is included in the repository and is used as the template for generating full Merkle trees.

---

## Installation

### Step 1 — Toolchain container (recommended)

Clone the repository, then start the ZK toolchain container:

```bash
docker run -it --rm \
  --network zknet \
  -v "$PWD":/workspace \
  -w /workspace \
  zk-toolchain:node18-circom216 \
  bash
```

> **Note:** Create the Docker network first if it does not exist:  
> `docker network create zknet`

Inside the container:

```bash
npm install
```

Use **Node.js 18.20.8** and **Hardhat ^2.23.0** as pinned in `package.json`. Newer Hardhat major versions may break zkSync plugin compatibility on Node 18.

### Step 2 — Local Hardhat node (optional)

If you cannot use Sepolia / zkSync Sepolia (no testnet ETH), run a **local Hardhat node** on the same Docker network and use the `dockerHardhat` network defined in `hardhat.config.js`:

1. In one terminal, start Hardhat node (must listen on `0.0.0.0` and join `zknet`):

   ```bash
   docker run -it --rm \
     --network zknet \
     --name hardhat-node \
     -v "$PWD":/workspace \
     -w /workspace \
     node:18.20.8-bullseye \
     bash -c "npm install && npx hardhat node --hostname 0.0.0.0"
   ```

2. In another terminal, use the toolchain container (same `zknet` network) and deploy with:

   ```bash
   npx hardhat run scripts/blockchain/deploy_credential_manager.js --network dockerHardhat
   npx hardhat credential-verification --network dockerHardhat \
     --manager 0xYOUR_MANAGER_ADDRESS --depth 11 --index 0 --iterations 50
   ```

`hardhat.config.js` maps `dockerHardhat` to `http://hardhat-node:8545`.

---

## Setup pipeline

Run these commands **inside the toolchain container** from `/workspace` (project root). Order matters.

### 1. Circuits + Groth16 keys + verifier contracts (depths 5–15)

Generates `.circom` files, compiles to `data/zkp-circuits/`, runs Groth16 setup, and exports `contracts/Groth16LegacyVerifierDepth{N}.sol`.

```bash
node scripts/setup/setup_circuits_all.js
```

**Outputs (per depth `N`):**

| Artifact | Path |
|----------|------|
| Compiled circuit | `data/zkp-circuits/CredentialVerifier_Depth{N}/` |
| Groth16 zkey | `data/zkp-circuits/CredentialVerifier_Depth{N}/CredentialVerifier_Depth{N}_0001.zkey` |
| Verifier contract | `contracts/Groth16LegacyVerifierDepth{N}.sol` |

This step is **slow** (especially depths 12–15). You can limit the range:

```bash
node scripts/setup/setup_circuits_all.js --from 11 --to 11
```

---

### 2. Full Merkle trees (depths 5–15, no zero-padding)

Builds trees with exactly **2^N** real leaves (no padding).

```bash
node scripts/merkletree/prep_full_merkle_all_depths.js
```

**Outputs (per depth `N`, leaf count `2^N`):**

| Artifact | Path |
|----------|------|
| Raw samples | `data/merkle-trees/diploma_samples_min_{2^N}.json` |
| Processed credentials | `data/merkle-trees/processed_diplomas_{2^N}.json` |
| Merkle tree + proofs | `data/merkle-trees/merkle_tree_data_depth_{N}.json` |

---

### 3. Circuit inputs (depths 5–15, leaf index 0)

```bash
node scripts/setup/generate_input_all_depths.js
```

**Outputs:**

```
data/inputs/input_depth_{N}_index_0.json
```

---

## Experiment 1 — Proving-time benchmark (Groth16)

### Generate Groth16 artifacts

```bash
node scripts/proving/prove_all_depths-groth16.js
```

Pipeline steps: inputs → witness → `groth16 prove` → export vkey → local verify.

**Outputs (per depth `N`, index `0`):**

| Artifact | Path |
|----------|------|
| Witness | `data/groth16-witness/witness_depth_{N}_index_0.wtns` |
| Proof | `data/groth16-public-proof/proof_depth_{N}_index_0.json` |
| Public signals | `data/groth16-public-proof/public_depth_{N}_index_0.json` |
| Verification key | `data/groth16-vkeys/CredentialVerifier_Depth{N}_vkey.json` |

Skip steps if artifacts already exist:

```bash
node scripts/proving/prove_all_depths-groth16.js --skip-inputs
```

### Run Groth16 benchmark

```bash
node scripts/proving/benchmark-groth16.js
```

Measures input generation, witness, prove, and verify times per depth.

**Result CSV:**

```
results/proving/{timestamp}-depth5-15-groth16-index0.csv
```

Columns: `Depth`, `Input(s)`, `Witness(s)`, `Prove(s)`, `Verify(s)`, `Total(s)`, `Status`

---

## Experiment 2 — Proving-time benchmark (PLONK)

### Generate PLONK artifacts

```bash
node scripts/proving/prove_all_depths-plonk.js
```

Pipeline steps: inputs → `plonk setup` → witness → `plonk prove` → export vkey → local verify.

**Outputs (per depth `N`, index `0`):**

| Artifact | Path |
|----------|------|
| PLONK zkey | `data/plonk-zkeys/CredentialVerifier_Depth{N}_plonk.zkey` |
| Witness | `data/plonk-witness/witness_depth_{N}_index_0.wtns` |
| Proof | `data/plonk-public-proof/proof_depth_{N}_index_0.json` |
| Public signals | `data/plonk-public-proof/public_depth_{N}_index_0.json` |
| Verification key | `data/plonk-vkeys/CredentialVerifier_Depth{N}_plonk_vkey.json` |

Example setup command (equivalent to step 2 inside the script):

```bash
snarkjs plonk setup \
  data/zkp-circuits/CredentialVerifier_Depth11/CredentialVerifier_Depth11.r1cs \
  pot16_final.ptau \
  data/plonk-zkeys/CredentialVerifier_Depth11_plonk.zkey
```

### Run PLONK benchmark

Requires PLONK zkeys from the step above.

```bash
node scripts/proving/benchmark-plonk.js
```

**Result CSV:**

```
results/proving/{timestamp}-depth5-15-plonk-index0.csv
```

---

## Experiment 3 — Constraint-count comparison

Compiles circuits (if needed) and measures Groth16 R1CS constraints vs PLONK expanded gate count.

```bash
node scripts/constraints/measure_depth_constraints.js
```

**Result CSV:**

```
results/constraints/{timestamp}-depth5-15-constraints.csv
```

Optional flags:

```bash
node scripts/constraints/measure_depth_constraints.js --skip-compile
node scripts/constraints/measure_depth_constraints.js --depths 5,11,15
```

---

## Experiment 4 — On-chain deployment and verification

Uses **Groth16** proofs from `data/groth16-public-proof/` and Merkle roots from `data/merkle-trees/`. Default experiment depth: **11**, leaf index **0**, **50** verification calls.

### Ethereum Sepolia

**Deploy:**

```bash
npx hardhat run scripts/blockchain/deploy_credential_manager.js --network sepolia 11
```

Example output:

```
=== Deploy CredentialManager (depth 11) ===
Groth16LegacyVerifierDepth11 deployed to: 0x...
CredentialManager deployed to: 0x...
Added root: ...
```

**Verify (50 iterations):**

```bash
npx hardhat credential-verification --network sepolia \
  --manager 0xYOUR_CREDENTIAL_MANAGER_ADDRESS \
  --depth 11 \
  --index 0 \
  --iterations 50
```

**Result CSV:**

```
results/blockchain/{timestamp}-11-50-sepolia.csv
```

Columns: `iteration`, `gas`, `gasPrice`, `latency_ms`, `status`, `error`

---

### zkSync Sepolia

On zkSync, contracts **must** be deployed via `hre.deployer.deploy()` (handled automatically in `deploy_credential_manager.js` when `zksync: true`).

**Deploy:**

```bash
npx hardhat run scripts/blockchain/deploy_credential_manager.js --network zkSyncSepolia 11
```

**Verify (50 iterations):**

```bash
npx hardhat credential-verification --network zkSyncSepolia \
  --manager 0xYOUR_CREDENTIAL_MANAGER_ADDRESS \
  --depth 11 \
  --index 0 \
  --iterations 50
```

**Result CSV:**

```
results/blockchain/{timestamp}-11-50-zkSyncSepolia.csv
```

> Replace `0xYOUR_CREDENTIAL_MANAGER_ADDRESS` with the address printed by **your** deploy step. Addresses differ per network and per deployment.

---

### Local Hardhat (`dockerHardhat`)

```bash
npx hardhat run scripts/blockchain/deploy_credential_manager.js --network dockerHardhat 11

npx hardhat credential-verification --network dockerHardhat \
  --manager 0xYOUR_CREDENTIAL_MANAGER_ADDRESS \
  --depth 11 \
  --index 0 \
  --iterations 50
```

---

## npm scripts reference

| Script | Command |
|--------|---------|
| Full circuit setup (5–15) | `node scripts/setup/setup_circuits_all.js` |
| Merkle trees (5–15) | `node scripts/merkletree/prep_full_merkle_all_depths.js` |
| Circuit inputs (5–15) | `node scripts/setup/generate_input_all_depths.js` |
| Groth16 prove-all | `node scripts/proving/prove_all_depths-groth16.js` |
| PLONK prove-all | `node scripts/proving/prove_all_depths-plonk.js` |
| Groth16 benchmark | `node scripts/proving/benchmark-groth16.js` |
| PLONK benchmark | `node scripts/proving/benchmark-plonk.js` |

---

## Recommended reproduction order

```
1. npm install                          (inside Docker)
2. setup_circuits_all.js                → circuits, zkeys, verifier .sol
3. prep_full_merkle_all_depths.js       → Merkle trees
4. generate_input_all_depths.js         → circuit inputs
5. prove_all_depths-groth16.js        → Groth16 proofs (for on-chain tests)
6. benchmark-groth16.js                 → proving CSV
7. prove_all_depths-plonk.js           → PLONK zkeys + proofs
8. benchmark-plonk.js                   → proving CSV
9. measure_depth_constraints.js         → constraints CSV
10. deploy + credential-verification    → blockchain CSV (Sepolia / zkSync / local)
```

Steps 5–8 can be reordered; step 10 requires step 5 (Groth16 proof for depth 11) and steps 2–3 (verifier contract + Merkle root).

---

## Troubleshooting

| Issue | Likely cause |
|-------|----------------|
| `Missing ptau` | Add `pot16_final.ptau` to project root |
| `Missing merkle_tree_data_depth_N.json` | Run `prep_full_merkle_all_depths.js` |
| `Missing Plonk zkey` | Run `prove_all_depths-plonk.js` first |
| zkSync `isValidRoot` returns `0x` | Deploy with `deploy_credential_manager.js` on zkSync (not plain `ethers.deploy`) |
| Hardhat / zkSync plugin errors | Use Node 18 + Hardhat 2.23.x |
| Depth 14–15 OOM or very slow | Run one depth at a time with `--from N --to N` |

---

## License

ISC (see `package.json`).
