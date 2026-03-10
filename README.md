# Diploma Verification with Zero-Knowledge Proofs

This project implements a **zero-knowledge proof system** for verifying that a diploma belongs to a Merkle tree of valid diplomas, without revealing the diploma data. It uses **Circom** for circuits, **Poseidon** for hashing, and supports two zk-SNARK proof systems: **Groth16** and **Plonk**.

---

## Table of Contents

- [Overview](#overview)
- [Circuit Design](#circuit-design)
- [Data & Merkle Trees](#data--merkle-trees)
- [Multi-Depth Circuits (5–15)](#multi-depth-circuits-515)
- [Groth16 Experiments](#groth16-experiments)
- [Plonk Experiments](#plonk-experiments)
- [Scripts Reference](#scripts-reference)
- [Setup & Installation](#setup--installation)
- [Usage](#usage)
- [Dependencies](#dependencies)
- [Deployed Contracts](#deployed-contracts)
- [License](#license)

---

## Overview

- **Goal:** Prove that a given diploma (nameHash, studentId, majorCode, issueDate) is a valid leaf in a Merkle tree whose root is published (e.g. on-chain).
- **Flow:** Hash diploma → leaf; prove Merkle path from leaf to public root in zero-knowledge (Groth16 or Plonk).
- **Circuits:** One parameterized circuit `DiplomaVerifier(levels)`; variants for Merkle depth 5–15 are generated and compiled separately.

---

## Circuit Design

All circuits are in `circuits/`.

| Component | Role |
|-----------|------|
| **HashDiploma** | Inputs: `nameHash`, `majorCode`, `studentId`, `issueDate`. Output: Poseidon hash = Merkle leaf. |
| **Selector** | Inputs: `in[2]`, `s`. Output: order left/right by `s`. |
| **MerkleProof(levels)** | Inputs: `leaf`, `pathIndices[levels]`, `siblings[levels]`. Output: computed `root`. |
| **DiplomaVerifier(levels)** | Private: diploma + path; public: `root`. Asserts recomputed root === public root. |

- Base file: `circuits/DiplomaVerifier.circom` (main with `levels = 5`).
- Generated: `circuits/DiplomaVerifier_DepthX.circom` for X = 5..15.

---

## Data & Merkle Trees

- **`data/`** – thư mục chứa toàn bộ file dữ liệu (mẫu văn bằng, processed, merkle, input). Các script đọc/ghi qua `scripts/paths.js`.
- **`data/diploma_samples.json`** – raw diploma records (~20 samples).
- **`scripts/prepare_diploma_data.js`** – đọc mẫu từ `data/diploma_samples.json`, ghi `data/processed_diplomas.json` (nameHash, leafHash, …).
- **`scripts/prepare_diploma_data_1024.js`** – optional: mở rộng lên 1.024 văn bằng cho cây depth-10.
- **`scripts/create_merkle_tree_depth.js`** – đọc `data/processed_diplomas.json`, ghi `data/merkle_tree_data_depth_<depth>.json` (roots + proofs).

---

## Multi-Depth Circuits (5–15)

- **`scripts/generate_depth_circuits.js`** – generates `DiplomaVerifier_Depth5.circom` … `DiplomaVerifier_Depth15.circom` from the base template.
- **`scripts/compile_depth_circuits.js`** – compiles each to R1CS, WASM, sym, C (output in `DiplomaVerifier_DepthX/`).

### R1CS size (Groth16 / snarkjs r1cs info)

| Depth | #Leaves (2^depth) | #Constraints | #Wires | #Public | #Private |
|-------|--------------------|-------------|--------|---------|----------|
| 5     | 32                 | 1,507       | 1,522  | 1       | 14       |
| 6     | 64                 | 1,749       | 1,766  | 1       | 16       |
| 7     | 128                | 1,991       | 2,010  | 1       | 18       |
| 8     | 256                | 2,233       | 2,254  | 1       | 20       |
| 9     | 512                | 2,475       | 2,498  | 1       | 22       |
| 10    | 1,024              | 2,717       | 2,742  | 1       | 24       |
| 11    | 2,048              | 2,959       | 2,986  | 1       | 26       |
| 12    | 4,096              | 3,201       | 3,230  | 1       | 28       |
| 13    | 8,192              | 3,443       | 3,474  | 1       | 30       |
| 14    | 16,384             | 3,685       | 3,718  | 1       | 32       |
| 15    | 32,768             | 3,927       | 3,962  | 1       | 34       |

---

## Groth16 Experiments

- **Trusted setup:** one `.zkey` per depth (e.g. `pot12_final.ptau` for Groth16).
- **`scripts/measure_proving_time_all_depths.js`** – for each depth 5..15: generate input → witness → **Groth16 prove** → **Groth16 verify**; reports **Input / Witness / Prove / Verify / Total** time.
- **`scripts/measure_proving_time_depth10.js`** – single-depth Groth16 timing (default depth 10).
- **`scripts/analyze_depth_constraints.js`** – prints constraint counts per depth (via `snarkjs r1cs info`).

Example timing (local Mac, index 0):

| Depth | Input (s) | Witness (s) | Prove (s) | Verify (s) | Total (s) |
|-------|-----------|-------------|----------|------------|-----------|
| 5     | 0.051     | 0.056       | 0.476    | 0.362      | 0.945     |
| 10    | 0.049     | 0.062       | 0.566    | 0.282      | 0.960     |
| 15    | 0.048     | 0.057       | 0.651    | 0.289      | 1.045     |

Remote run results and full tables: see `remote_results/` (e.g. `TABLES_LOCAL_VS_SERVER.md`, `TIMING_SUMMARY.md`).

---

## Plonk Experiments

- **Trusted setup:** one **Power of Tau** (e.g. **power 16**) is required; one **Plonk zkey** per depth.  
  Plonk constraint count is much higher than R1CS; `pot12` is too small. Use `pot16_final.ptau` (see `Plonk/README.md`).
- **`Plonk/`** – folder for Plonk-specific docs and constraint table.
- **`Plonk/README.md`** – Plonk setup (ptau power 16, `snarkjs plonk setup` per depth), and how to run timing.
- **`Plonk/PLONK_CONSTRAINTS_BY_DEPTH.md`** – table Depth vs Plonk constraints.
- **`scripts/measure_plonk_time_all_depths.js`** – for each depth 5..15: input → witness → **Plonk prove** → **Plonk verify**; reports **Input / Witness / Prove / Verify / Total** and prints a summary table for comparison with Groth16.
- **`scripts/measure_plonk_time_depth10.js`** – single-depth Plonk timing (args: `[depth] [index]`, default depth 5).

Plonk constraints (from `snarkjs plonk setup`):

| Depth | Plonk constraints |
|-------|-------------------|
| 5     | 19,222            |
| 10    | 31,592            |
| 15    | 43,962            |

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `prepare_diploma_data.js` | Build `processed_diplomas.json` from `diploma_samples.json`. |
| `prepare_diploma_data_1024.js` | Build 1,024 diplomas for full depth-10 tree. |
| `create_merkle_tree_depth.js` | Build Merkle trees depth 5–15 → `merkle_tree_data_depth_<d>.json`. |
| `generate_depth_circuits.js` | Generate `DiplomaVerifier_DepthX.circom` (X = 5..15). |
| `compile_depth_circuits.js` | Compile all depth circuits (R1CS, WASM, etc.). |
| `generate_input_depth.js <depth> <index>` | Build `input_depth_<depth>_index_<index>.json`. |
| `measure_proving_time_all_depths.js [index]` | Groth16: time Input/Witness/Prove/Verify/Total for all depths. |
| `measure_proving_time_depth10.js [index]` | Groth16: single depth (default 10). |
| `measure_plonk_time_all_depths.js [index]` | Plonk: time Input/Witness/Prove/Verify/Total for all depths. |
| `measure_plonk_time_depth10.js [depth] [index]` | Plonk: single depth (default 5). |
| `analyze_depth_constraints.js` | Print R1CS constraint counts (snarkjs r1cs info). |

---

## Setup & Installation

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Prepare data and Merkle trees**

   ```bash
   node scripts/prepare_diploma_data.js
   node scripts/create_merkle_tree_depth.js
   ```

3. **Generate and compile circuits**

   ```bash
   node scripts/generate_depth_circuits.js
   node scripts/compile_depth_circuits.js
   ```

4. **Groth16 trusted setup (per depth, example depth 10)**

   ```bash
   snarkjs groth16 setup DiplomaVerifier_Depth10/DiplomaVerifier_Depth10.r1cs pot12_final.ptau DiplomaVerifier_Depth10_0000.zkey
   snarkjs zkey contribute DiplomaVerifier_Depth10_0000.zkey DiplomaVerifier_Depth10_0001.zkey --name="contribution" -v
   ```

5. **Plonk trusted setup** (see `Plonk/README.md`): build `pot16_final.ptau`, then for each depth:

   ```bash
   snarkjs plonk setup DiplomaVerifier_Depth10/DiplomaVerifier_Depth10.r1cs pot16_final.ptau DiplomaVerifier_Depth10_plonk.zkey
   snarkjs zkey export verificationkey DiplomaVerifier_Depth10_plonk.zkey DiplomaVerifier_Depth10_plonk_vkey.json
   ```

---

## Usage

### Groth16: prove and verify (e.g. depth 10, index 0)

```bash
node scripts/generate_input_depth.js 10 0
node DiplomaVerifier_js/generate_witness.js \
  DiplomaVerifier_Depth10/DiplomaVerifier_Depth10_js/DiplomaVerifier_Depth10.wasm \
  data/input_depth_10_index_0.json witness_depth_10_index_0.wtns
snarkjs groth16 prove DiplomaVerifier_Depth10_0001.zkey witness_depth_10_index_0.wtns proof_depth_10_index_0.json public_depth_10_index_0.json
snarkjs zkey export verificationkey DiplomaVerifier_Depth10_0001.zkey DiplomaVerifier_Depth10_vkey.json
snarkjs groth16 verify DiplomaVerifier_Depth10_vkey.json public_depth_10_index_0.json proof_depth_10_index_0.json
```

### Groth16: timing for all depths

```bash
node scripts/measure_proving_time_all_depths.js
node scripts/measure_proving_time_all_depths.js 3
```

### Plonk: timing for all depths (compare with Groth16)

```bash
node scripts/measure_plonk_time_all_depths.js
node scripts/measure_plonk_time_all_depths.js 3
```

---

## Dependencies

- **circom** 2.x  
- **circomlib**  
- **snarkjs**  
- **Node.js** (LTS)

---

## Deployed Contracts

- **Sepolia:** `0x3D11895D0BB719AcF7B0D995ED19953388318B82`
- **ZkSync Sepolia:** `0x3D11895D0BB719AcF7B0D995ED19953388318B82`

---

## License

MIT License
