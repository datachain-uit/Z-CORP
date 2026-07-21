# Z-CORP

This repository contains the implementation and experimental artifact accompanying the paper:

**An Architectural and Empirical Study of Root-Only Zero-Knowledge Verification**

---

## Experimental scope

The repository supports two experiment groups:

1. **Blockchain-Side Deployment and Verification**: **On-chain verification** — deploy `CredentialManager` and run Groth16 proof verification on **Ethereum Sepolia** and **zkSync Sepolia** (or locally via Hardhat).

2. **ZKP proving and off-chain verification**:
 2.1. **Constraint-count comparison** — measure R1CS constraints (Groth16) vs expanded PLONK gates for depths **5–15**.
 2.2. **Proving-time comparison** — benchmark **Groth16** vs **PLONK** across Merkle tree depths **5–15** (full trees, no zero-padding).

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
├── Dockerfile
├── pot16_final.ptau             # Powers-of-tau (NOT in git — see Prerequisites)
└── secret.json                  # Deployer private key (NOT in git — see below)
```

Most generated artifacts under `data/` and `results/` are listed in `.gitignore` and are **not pushed to git**. Reproduce them by following the steps below.

---

## Prerequisites

### 1. Powers-of-tau file

A ready-to-use sample **`pot16_final.ptau`** file is included in the repository root. Reviewers can therefore run the setup and proving pipelines without generating or downloading an additional Powers-of-Tau file.

The included file is used by:

- Groth16 trusted setup (`setup_circuits_all.js`)
- PLONK setup (`prove_all_depths-plonk.js`)

The bundled file is provided for artifact evaluation and experimental reproduction. A separately generated ceremony artifact should be used for a production deployment.

### 2. Hardhat wallet (`secret.json`)

Create `secret.json` at the project root (this file is gitignored):

```json
{
  "privateKey": "0x1111111111111111111111111111111111111111111111111111111111111111"
}
```

- **Sepolia** and **zkSync Sepolia** require a funded testnet account with Sepolia ETH (and ETH on zkSync Sepolia for L2 gas).
- Do **not** commit real keys. Use your own wallet or a dedicated test account.

To run the public-testnet experiments, replace the dummy value with the private key of a dedicated funded testnet account. Sepolia and zkSync Sepolia require testnet ETH for deployment and transaction fees. Never use a production or mainnet wallet key.

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

### Step 1 — Build and start the toolchain container (recommended)

Clone the repository and enter the project directory:

```bash
git clone https://github.com/datachain-uit/Z-CORP.git
cd Z-CORP
```

Build the Docker image from the `Dockerfile` included at the repository root:

```bash
docker build -t zk-toolchain:node18-circom216 .
```

Create the shared Docker network if it does not already exist:

```bash
docker network inspect zknet >/dev/null 2>&1 || docker network create zknet
```

Start the ZK toolchain container:

```bash
docker run -it --rm \
  --network zknet \
  -v "$PWD":/workspace \
  -w /workspace \
  zk-toolchain:node18-circom216 \
  bash
```

Inside the container, install the project dependencies:

```bash
npm install
```

Rebuild the image with the same `docker build` command whenever the repository's `Dockerfile` or toolchain dependencies are changed.

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

The on-chain evaluation was conducted in a campaign. Each CSV file contains 50 verification attempts and records the iteration number, gas consumption, gas price, transaction latency, execution status, and error message, where applicable.

| Campaign | Network | Raw transaction measurements | Result figure |
|---|---|---|---|
| Campaign, depth 11 | Ethereum Sepolia | [Window 1](results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/20260711T091246-11-50-sepolia.csv)<br>[Window 2](results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/20260711T131457-11-50-sepolia.csv)<br>[Window 3](results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/20260712T030525-11-50-sepolia.csv) | [Figure 5.2 (PDF)](results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/Figure_5.2.pdf) |
| Campaign, depth 11 | zkSync Sepolia | [Window 1](results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/20260711T092751-11-50-zkSyncSepolia.csv)<br>[Window 2](results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/20260711T132711-11-50-zkSyncSepolia.csv)<br>[Window 3](results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/20260712T031611-11-50-zkSyncSepolia.csv) | [Figure 5 (PDF)](results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/Figure_5.pdf) |

Complete artifact directories:

- [Meeasurement campaign](results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/)

---

### Issuer access test (`addRoot` requires `setIssuer`)

This Hardhat test checks that `CredentialManager.addRoot` is protected by the `onlyIssuer` modifier: an account that has not been granted issuer status via `setIssuer` cannot register a Merkle root.

**Test file:** `test/CredentialManager.issuerAccess.js`

**Run (inside the toolchain container or any environment with Hardhat installed):**

```bash
npx hardhat test test/CredentialManager.issuerAccess.js
```

---

## Experiment 2 - ZKP proving and off-chain verification

### Experiment 2.1 — The Growth of Depth-Parameterized Circuit

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

#### Published experimental results

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
| Constraint measurement, run | [20260711T054936-depth5-15-constraints.csv](results/constraints/4.2.1-The-Growth-of-Depth-Parameterized-Circuit/20260711T054936-depth5-15-constraints.csv) |
| Constraint-growth visualization | [Figure 6 (PDF)](results/constraints/4.2.1-The-Growth-of-Depth-Parameterized-Circuit/Figure_6.pdf) |
| Complete artifact directory | [results/constraints](results/constraints/4.2.1-The-Growth-of-Depth-Parameterized-Circuit/) |

---

### Experiment 2.2 — Groth16 Prover-Side performance

#### Generate Groth16 artifacts

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

#### Run Groth16 benchmark

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

#### Published Groth16 benchmark results

**Table — Groth16 proving and verification time across Merkle tree depths on three environments (seconds).** For each `(depth, device)` configuration, values are summarized from repeated runs under the off-chain benchmarking protocol.

<table>
  <thead>
    <tr>
      <th rowspan="2">Depth</th>
      <th colspan="5">Device #1</th>
      <th colspan="5">Device #2</th>
      <th colspan="5">Device #3</th>
    </tr>
    <tr>
      <th>Input</th>
      <th>Witness</th>
      <th>Prove</th>
      <th>Verify</th>
      <th>Total</th>
      <th>Input</th>
      <th>Witness</th>
      <th>Prove</th>
      <th>Verify</th>
      <th>Total</th>
      <th>Input</th>
      <th>Witness</th>
      <th>Prove</th>
      <th>Verify</th>
      <th>Total</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>5</td><td>0.051</td><td>0.056</td><td>0.476</td><td>0.362</td><td>0.945</td><td>0.048</td><td>0.069</td><td>1.062</td><td>0.776</td><td>1.956</td><td>0.247</td><td>0.276</td><td>1.889</td><td>1.387</td><td>3.801</td></tr>
    <tr><td>6</td><td>0.045</td><td>0.058</td><td>0.493</td><td>0.284</td><td>0.880</td><td>0.044</td><td>0.079</td><td>1.003</td><td>0.758</td><td>1.885</td><td>0.242</td><td>0.271</td><td>1.748</td><td>1.392</td><td>3.655</td></tr>
    <tr><td>7</td><td>0.046</td><td>0.059</td><td>0.507</td><td>0.287</td><td>0.899</td><td>0.046</td><td>0.076</td><td>1.042</td><td>0.791</td><td>1.955</td><td>0.238</td><td>0.269</td><td>1.868</td><td>1.281</td><td>3.658</td></tr>
    <tr><td>8</td><td>0.046</td><td>0.059</td><td>0.558</td><td>0.285</td><td>0.949</td><td>0.048</td><td>0.073</td><td>1.098</td><td>0.780</td><td>2.000</td><td>0.245</td><td>0.273</td><td>1.855</td><td>1.325</td><td>3.699</td></tr>
    <tr><td>9</td><td>0.048</td><td>0.061</td><td>0.566</td><td>0.289</td><td>0.966</td><td>0.050</td><td>0.081</td><td>1.073</td><td>0.772</td><td>1.977</td><td>0.236</td><td>0.269</td><td>1.801</td><td>1.314</td><td>3.622</td></tr>
    <tr><td>10</td><td>0.049</td><td>0.062</td><td>0.566</td><td>0.282</td><td>0.960</td><td>0.047</td><td>0.081</td><td>1.161</td><td>0.784</td><td>2.073</td><td>0.242</td><td>0.272</td><td>1.814</td><td>1.274</td><td>3.602</td></tr>
    <tr><td>11</td><td>0.097</td><td>0.059</td><td>0.588</td><td>0.281</td><td>1.027</td><td>0.054</td><td>0.075</td><td>1.112</td><td>0.758</td><td>1.999</td><td>0.247</td><td>0.269</td><td>1.858</td><td>1.288</td><td>3.663</td></tr>
    <tr><td>12</td><td>0.051</td><td>0.057</td><td>0.623</td><td>0.284</td><td>1.015</td><td>0.044</td><td>0.071</td><td>1.060</td><td>0.780</td><td>1.955</td><td>0.237</td><td>0.272</td><td>1.858</td><td>1.292</td><td>3.661</td></tr>
    <tr><td>13</td><td>0.049</td><td>0.060</td><td>0.623</td><td>0.283</td><td>1.015</td><td>0.047</td><td>0.074</td><td>1.025</td><td>0.760</td><td>1.908</td><td>0.236</td><td>0.276</td><td>1.855</td><td>1.292</td><td>3.659</td></tr>
    <tr><td>14</td><td>0.049</td><td>0.059</td><td>0.637</td><td>0.283</td><td>1.029</td><td>0.052</td><td>0.073</td><td>1.121</td><td>0.775</td><td>2.021</td><td>0.236</td><td>0.276</td><td>1.982</td><td>1.376</td><td>3.871</td></tr>
    <tr><td>15</td><td>0.048</td><td>0.057</td><td>0.651</td><td>0.289</td><td>1.045</td><td>0.046</td><td>0.074</td><td>1.114</td><td>0.798</td><td>2.033</td><td>0.240</td><td>0.269</td><td>1.914</td><td>1.308</td><td>3.732</td></tr>
  </tbody>
</table>

All Groth16 benchmark executions completed successfully. The raw CSV files report input-generation time, witness-generation time, proving time, verification time, total execution time, and execution status.

| Artifact | Link |
|---|---|
| Device #1 Groth16 measurements | [device1-groth16.csv](results/proving/4.2.2-Groth16-Prover-Side-performance/device1-groth16.csv) |
| Device #2 Groth16 measurements | [device2-groth16.csv](results/proving/4.2.2-Groth16-Prover-Side-performance/device2-groth16.csv) |
| Device #3 Groth16 measurements | [device3-groth16.csv](results/proving/4.2.2-Groth16-Prover-Side-performance/device3-groth16.csv) |
| Groth16 benchmark visualization | [Figure 7 (PDF)](results/proving/4.2.2-Groth16-Prover-Side-performance/Figure_7.pdf) |
| Complete artifact directory | [4.2.2-Groth16-Prover-Side-performance](results/proving/4.2.2-Groth16-Prover-Side-performance/) |

---

### Experiment 2.3 — PLONK Prover-Side performance

#### Generate PLONK artifacts

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

#### Run PLONK benchmark

Requires PLONK zkeys from the step above.

```bash
node scripts/proving/benchmark-plonk.js
```

**Result CSV:**

```
results/proving/{timestamp}-depth5-15-plonk-index0.csv
```

---

#### Published PLONK benchmark results

**Table — PLONK proving and verification time across Merkle tree depths on three environments (seconds).** For each `(depth, device)` configuration, values are summarized from repeated runs under the off-chain benchmarking protocol.

<table>
  <thead>
    <tr>
      <th rowspan="2">Depth</th>
      <th colspan="5">Device #1</th>
      <th colspan="5">Device #2</th>
      <th colspan="5">Device #3</th>
    </tr>
    <tr>
      <th>Input</th>
      <th>Witness</th>
      <th>Prove</th>
      <th>Verify</th>
      <th>Total</th>
      <th>Input</th>
      <th>Witness</th>
      <th>Prove</th>
      <th>Verify</th>
      <th>Total</th>
      <th>Input</th>
      <th>Witness</th>
      <th>Prove</th>
      <th>Verify</th>
      <th>Total</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>5</td><td>0.048</td><td>0.059</td><td>17.961</td><td>0.350</td><td>18.419</td><td>0.048</td><td>0.070</td><td>24.502</td><td>0.782</td><td>25.402</td><td>0.245</td><td>0.272</td><td>51.748</td><td>1.301</td><td>53.567</td></tr>
    <tr><td>6</td><td>0.048</td><td>0.060</td><td>17.012</td><td>0.327</td><td>17.447</td><td>0.059</td><td>0.076</td><td>24.457</td><td>0.803</td><td>25.397</td><td>0.238</td><td>0.273</td><td>50.109</td><td>1.283</td><td>51.905</td></tr>
    <tr><td>7</td><td>0.221</td><td>0.126</td><td>17.923</td><td>0.328</td><td>18.601</td><td>0.052</td><td>0.072</td><td>24.152</td><td>0.803</td><td>25.081</td><td>0.240</td><td>0.270</td><td>49.958</td><td>1.281</td><td>51.750</td></tr>
    <tr><td>8</td><td>0.053</td><td>0.065</td><td>17.092</td><td>0.332</td><td>17.543</td><td>0.052</td><td>0.080</td><td>23.955</td><td>0.827</td><td>24.914</td><td>0.238</td><td>0.279</td><td>50.710</td><td>1.331</td><td>52.560</td></tr>
    <tr><td>9</td><td>0.051</td><td>0.066</td><td>17.036</td><td>0.320</td><td>17.474</td><td>0.051</td><td>0.073</td><td>23.606</td><td>0.773</td><td>24.503</td><td>0.238</td><td>0.275</td><td>50.752</td><td>1.338</td><td>52.606</td></tr>
    <tr><td>10</td><td>0.050</td><td>0.085</td><td>16.943</td><td>0.443</td><td>17.531</td><td>0.047</td><td>0.082</td><td>24.793</td><td>0.740</td><td>25.663</td><td>0.237</td><td>0.270</td><td>50.437</td><td>1.323</td><td>52.267</td></tr>
    <tr><td>11</td><td>0.053</td><td>0.060</td><td>33.417</td><td>0.335</td><td>33.865</td><td>0.046</td><td>0.072</td><td>46.516</td><td>0.803</td><td>47.437</td><td>0.239</td><td>0.271</td><td>98.949</td><td>1.288</td><td>100.748</td></tr>
    <tr><td>12</td><td>0.050</td><td>0.062</td><td>33.941</td><td>0.326</td><td>34.380</td><td>0.055</td><td>0.073</td><td>46.551</td><td>0.830</td><td>47.509</td><td>0.244</td><td>0.274</td><td>89.457</td><td>1.193</td><td>91.168</td></tr>
    <tr><td>13</td><td>0.051</td><td>0.064</td><td>32.565</td><td>0.352</td><td>33.033</td><td>0.049</td><td>0.076</td><td>47.624</td><td>0.770</td><td>48.520</td><td>0.219</td><td>0.247</td><td>100.421</td><td>1.294</td><td>102.182</td></tr>
    <tr><td>14</td><td>0.049</td><td>0.060</td><td>32.377</td><td>0.336</td><td>32.824</td><td>0.046</td><td>0.070</td><td>46.782</td><td>0.788</td><td>47.687</td><td>0.237</td><td>0.283</td><td>96.836</td><td>1.453</td><td>98.810</td></tr>
    <tr><td>15</td><td>0.050</td><td>0.061</td><td>32.824</td><td>0.333</td><td>33.269</td><td>0.052</td><td>0.078</td><td>47.494</td><td>0.755</td><td>48.380</td><td>0.246</td><td>0.286</td><td>97.541</td><td>1.205</td><td>99.279</td></tr>
  </tbody>
</table>

All PLONK benchmark executions completed successfully. The raw CSV files report input-generation time, witness-generation time, proving time, verification time, total execution time, and execution status.

| Artifact | Link |
|---|---|
| Device #1 PLONK measurements | [device1-plonk.csv](results/proving/4.2.3-PLONK-Prover-Side-performance/device1-plonk.csv) |
| Device #2 PLONK measurements | [device2-plonk.csv](results/proving/4.2.3-PLONK-Prover-Side-performance/device2-plonk.csv) |
| Device #3 PLONK measurements | [device3-plonk.csv](results/proving/4.2.3-PLONK-Prover-Side-performance/device3-plonk.csv) |
| PLONK benchmark visualization | [Figure 8 (PDF)](results/proving/4.2.3-PLONK-Prover-Side-performance/Figure_8.pdf) |
| Complete artifact directory | [4.2.3-PLONK-Prover-Side-performance](results/proving/4.2.3-PLONK-Prover-Side-performance/) |

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
