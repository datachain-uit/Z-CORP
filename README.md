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

   ```
   docker run -it --rm \
     --network zknet \
     --name hardhat-node \
     -v "$PWD":/workspace \
     -w /workspace \
     node:18.20.8-bullseye \
     npx hardhat node --hostname 0.0.0.0
   ```

2. In another terminal, use the toolchain container (same `zknet` network) and deploy with:

   ```
   docker run -it --rm \
    --network zknet \
    -v "$PWD":/workspace \
    -w /workspace \
    zk-toolchain:node18-circom216 \
  
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

## Experiment 1 — On-chain deployment and verification

Uses **Groth16** proofs from `data/groth16-public-proof/` and Merkle roots from `data/merkle-trees/`. Default experiment depth: **11**, leaf index **0**, **50** verification calls.

### Ethereum Sepolia

**Deploy:**

```bash
npx hardhat run scripts/blockchain/deploy_credential_manager.js --network sepolia
```

Example output:

```
=== Deploy CredentialManager (depth 11) ===
Groth16LegacyVerifierDepth11 deployed to: 0x...
CredentialManager deployed to: 0x...
Added root: ...
```
**Result CSV:**

```
results/blockchain/deploy/{timestamp}-deploy-sepolia.csv
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
npx hardhat run scripts/blockchain/deploy_credential_manager.js --network zkSyncSepolia
```

**Result CSV:**

```
results/blockchain/deploy/{timestamp}-deploy-zkSyncSepolia.csv
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
npx hardhat run scripts/blockchain/deploy_credential_manager.js --network dockerHardhat

npx hardhat credential-verification --network dockerHardhat \
  --manager 0xYOUR_CREDENTIAL_MANAGER_ADDRESS \
  --depth 11 \
  --index 0 \
  --iterations 50
```

---

### Published experimental results

The on-chain evaluation was conducted in two measurement campaigns. Each CSV file contains 50 verification attempts and records the iteration number, gas consumption, gas price, transaction latency, execution status, and error message, where applicable.

| Campaign | Network | Raw transaction measurements | Result figure |
|---|---|---|---|
| Original campaign, depth 5 | Ethereum Sepolia | [Window 1](results/blockchain/paper-raw-verification-txs-fig5/20250430T030734-5-50-sepolia.csv)<br>[Window 2](results/blockchain/paper-raw-verification-txs-fig5/20250430T090921-5-50-sepolia.csv)<br>[Window 3](results/blockchain/paper-raw-verification-txs-fig5/20250430T151108-5-50-sepolia.csv) | [Figure 5.1 (PDF)](results/blockchain/paper-raw-verification-txs-fig5/Figure_5.1.pdf) |
| Original campaign, depth 5 | zkSync Sepolia | [Window 1](results/blockchain/paper-raw-verification-txs-fig5/20250430T032458-5-50-zkSyncSepolia.csv)<br>[Window 2](results/blockchain/paper-raw-verification-txs-fig5/20250430T092847-5-50-zkSyncSepolia.csv)<br>[Window 3](results/blockchain/paper-raw-verification-txs-fig5/20250430T152936-5-50-zkSyncSepolia.csv) | [Figure 5.1 (PDF)](results/blockchain/paper-raw-verification-txs-fig5/Figure_5.1.pdf) |
| Follow-up campaign, depth 11 | Ethereum Sepolia | [Window 1](results/blockchain/new-verification-txs/20260711T091246-11-50-sepolia.csv)<br>[Window 2](results/blockchain/new-verification-txs/20260711T131457-11-50-sepolia.csv)<br>[Window 3](results/blockchain/new-verification-txs/20260712T030525-11-50-sepolia.csv) | [Figure 5.2 (PDF)](results/blockchain/new-verification-txs/Figure_5.2.pdf) |
| Follow-up campaign, depth 11 | zkSync Sepolia | [Window 1](results/blockchain/new-verification-txs/20260711T092751-11-50-zkSyncSepolia.csv)<br>[Window 2](results/blockchain/new-verification-txs/20260711T132711-11-50-zkSyncSepolia.csv)<br>[Window 3](results/blockchain/new-verification-txs/20260712T031611-11-50-zkSyncSepolia.csv) | [Figure 5.2 (PDF)](results/blockchain/new-verification-txs/Figure_5.2.pdf) |

Complete artifact directories:

- [Original depth-5 measurement campaign](results/blockchain/paper-raw-verification-txs-fig5/)
- [Follow-up depth-11 measurement campaign](results/blockchain/new-verification-txs/)

---

## Experiment 2 — Constraint-count comparison

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

### Published experimental results

The following table reports the Groth16 R1CS constraint count and the corresponding expanded PLONK gate count for Merkle-tree depths 5–15. The number of leaves is \(2^d\), where \(d\) is the tree depth.

| Depth | Leaves | Groth16 constraints | PLONK expanded gates | PLONK/Groth16 ratio |
|---:|---:|---:|---:|---:|
| 5 | 32 | 1,507 | 19,222 | 12.76 |
| 6 | 64 | 1,749 | 21,696 | 12.40 |
| 7 | 128 | 1,991 | 24,170 | 12.14 |
| 8 | 256 | 2,233 | 26,644 | 11.93 |
| 9 | 512 | 2,475 | 29,118 | 11.76 |
| 10 | 1,024 | 2,717 | 31,592 | 11.63 |
| 11 | 2,048 | 2,959 | 34,066 | 11.51 |
| 12 | 4,096 | 3,201 | 36,540 | 11.42 |
| 13 | 8,192 | 3,443 | 39,014 | 11.33 |
| 14 | 16,384 | 3,685 | 41,488 | 11.26 |
| 15 | 32,768 | 3,927 | 43,962 | 11.19 |

The repeated measurement runs produced the same structural constraint and gate counts; only circuit compilation time varied between runs.

| Artifact | Link |
|---|---|
| Constraint measurement, run 1 | [20260710T153602-depth5-15-constraints.csv](results/constraints/20260710T153602-depth5-15-constraints.csv) |
| Constraint measurement, run 2 | [20260711T054936-depth5-15-constraints.csv](results/constraints/20260711T054936-depth5-15-constraints.csv) |
| Constraint-growth visualization | [Figure 6 (PDF)](results/constraints/Figure_6.pdf) |
| Complete artifact directory | [results/constraints](results/constraints/) |

---

## Experiment 3.1 — Proving-time benchmark (Groth16)

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

### Published Groth16 benchmark results

The following table reports Groth16 proving and off-chain verification times across the three experimental devices. All values are in seconds. `D1`, `D2`, and `D3` denote Device #1, Device #2, and Device #3, respectively.

| Depth | D1 prove | D1 verify | D2 prove | D2 verify | D3 prove | D3 verify |
|---:|---:|---:|---:|---:|---:|---:|
| 5 | 0.476 | 0.362 | 1.062 | 0.776 | 1.889 | 1.387 |
| 6 | 0.493 | 0.284 | 1.003 | 0.758 | 1.748 | 1.392 |
| 7 | 0.507 | 0.287 | 1.042 | 0.791 | 1.868 | 1.281 |
| 8 | 0.558 | 0.285 | 1.098 | 0.780 | 1.855 | 1.325 |
| 9 | 0.566 | 0.289 | 1.073 | 0.772 | 1.801 | 1.314 |
| 10 | 0.566 | 0.282 | 1.161 | 0.784 | 1.814 | 1.274 |
| 11 | 0.588 | 0.281 | 1.112 | 0.758 | 1.858 | 1.288 |
| 12 | 0.623 | 0.284 | 1.060 | 0.780 | 1.858 | 1.292 |
| 13 | 0.623 | 0.283 | 1.025 | 0.760 | 1.855 | 1.292 |
| 14 | 0.637 | 0.283 | 1.121 | 0.775 | 1.982 | 1.376 |
| 15 | 0.651 | 0.289 | 1.114 | 0.798 | 1.914 | 1.308 |

All Groth16 benchmark executions completed successfully. The raw CSV files additionally report input-generation time, witness-generation time, total execution time, and execution status.

| Artifact | Link |
|---|---|
| Device #1 Groth16 measurements | [device1-groth16.csv](results/proving/paper-raw-proving-fig7-8/device1-groth16.csv) |
| Device #2 Groth16 measurements | [device2-groth16.csv](results/proving/paper-raw-proving-fig7-8/device2-groth16.csv) |
| Device #3 Groth16 measurements | [device3-groth16.csv](results/proving/paper-raw-proving-fig7-8/device3-groth16.csv) |
| Groth16 benchmark visualization | [Figure 7 (PDF)](results/proving/paper-raw-proving-fig7-8/Figure_7.pdf) |
| Complete artifact directory | [paper-raw-proving-fig7-8](results/proving/paper-raw-proving-fig7-8/) |

---

## Experiment 3.2 — Proving-time benchmark (PLONK)

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

### Published PLONK benchmark results

The following table reports PLONK proving and off-chain verification times across the three experimental devices. All values are in seconds. `D1`, `D2`, and `D3` denote Device #1, Device #2, and Device #3, respectively.

| Depth | D1 prove | D1 verify | D2 prove | D2 verify | D3 prove | D3 verify |
|---:|---:|---:|---:|---:|---:|---:|
| 5 | 17.961 | 0.350 | 24.502 | 0.782 | 51.748 | 1.301 |
| 6 | 17.012 | 0.327 | 24.457 | 0.803 | 50.109 | 1.283 |
| 7 | 17.923 | 0.328 | 24.152 | 0.803 | 49.958 | 1.281 |
| 8 | 17.092 | 0.332 | 23.955 | 0.827 | 50.710 | 1.331 |
| 9 | 17.036 | 0.320 | 23.606 | 0.773 | 50.752 | 1.338 |
| 10 | 16.943 | 0.443 | 24.793 | 0.740 | 50.437 | 1.323 |
| 11 | 33.417 | 0.335 | 46.516 | 0.803 | 98.949 | 1.288 |
| 12 | 33.941 | 0.326 | 46.551 | 0.830 | 89.457 | 1.193 |
| 13 | 32.565 | 0.352 | 47.624 | 0.770 | 100.421 | 1.294 |
| 14 | 32.377 | 0.336 | 46.782 | 0.788 | 96.836 | 1.453 |
| 15 | 32.824 | 0.333 | 47.494 | 0.755 | 97.541 | 1.205 |

All PLONK benchmark executions completed successfully. The raw CSV files additionally report input-generation time, witness-generation time, total execution time, and execution status.

| Artifact | Link |
|---|---|
| Device #1 PLONK measurements | [device1-plonk.csv](results/proving/paper-raw-proving-fig7-8/device1-plonk.csv) |
| Device #2 PLONK measurements | [device2-plonk.csv](results/proving/paper-raw-proving-fig7-8/device2-plonk.csv) |
| Device #3 PLONK measurements | [device3-plonk.csv](results/proving/paper-raw-proving-fig7-8/device3-plonk.csv) |
| PLONK benchmark visualization | [Figure 8 (PDF)](results/proving/paper-raw-proving-fig7-8/Figure_8.pdf) |
| Complete artifact directory | [paper-raw-proving-fig7-8](results/proving/paper-raw-proving-fig7-8/) |

---

## Scripts reference

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
