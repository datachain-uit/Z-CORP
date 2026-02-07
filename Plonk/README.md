## Plonk Experiments

This folder documents how to run the same diploma verification experiments using the **Plonk**
proving system instead of Groth16, while keeping the Circom circuits unchanged.

Circom is still used as the circuit language; only the proving system (and `snarkjs` commands)
change from `groth16` to `plonk`.

---

### 1. Prerequisites

From the project root (`testcircom`):

1. **Install dependencies**

```bash
npm install
```

2. **Prepare diploma data (~20 base diplomas)**

```bash
node scripts/prepare_diploma_data.js
```

3. **Create Merkle tree data (at least for depth 10)**

```bash
node scripts/create_merkle_tree_depth.js
```

4. **Generate and compile circuits (including depth 10)**

```bash
node scripts/generate_depth_circuits.js
node scripts/compile_depth_circuits.js
```

This should produce, among others:

- `DiplomaVerifier_Depth10/DiplomaVerifier_Depth10.r1cs`
- `DiplomaVerifier_Depth10/DiplomaVerifier_Depth10_js/DiplomaVerifier_Depth10.wasm`

---

### 2. Plonk setup for a given depth

From the project root:

```bash
# Example: Plonk setup for depth 5
snarkjs plonk setup \
  DiplomaVerifier_Depth5/DiplomaVerifier_Depth5.r1cs \
  pot12_final.ptau \
  DiplomaVerifier_Depth5_plonk.zkey

snarkjs zkey export verificationkey \
  DiplomaVerifier_Depth5_plonk.zkey \
  DiplomaVerifier_Depth5_plonk_vkey.json

# Example: Plonk setup for depth 10
snarkjs plonk setup \
  DiplomaVerifier_Depth10/DiplomaVerifier_Depth10.r1cs \
  pot12_final.ptau \
  DiplomaVerifier_Depth10_plonk.zkey

snarkjs zkey export verificationkey \
  DiplomaVerifier_Depth10_plonk.zkey \
  DiplomaVerifier_Depth10_plonk_vkey.json
```

> Lưu ý: Với `snarkjs plonk` + Circom hiện tại, mỗi **circuit/r1cs khác nhau** (ví dụ khác depth) vẫn cần một file `.zkey` riêng.  
> Điểm lợi của Plonk ở đây là **dùng lại cùng 1 file ptau** (`pot12_final.ptau`) cho tất cả depth, nhưng **không phải 1 zkey duy nhất cho mọi circuit**.

---

### 3. Measuring Plonk proving & verification time

Hai script:

- **`scripts/measure_plonk_time_all_depths.js`** – chạy Plonk cho **tất cả depth 5..15**, đo Input / Witness / Prove / Verify / Total và in **bảng tổng kết** để so sánh với Groth16.
- **`scripts/measure_plonk_time_depth10.js`** – chạy Plonk cho **một depth** (mặc định 5), dùng khi test nhanh một depth.

It will:

1. Generate input for the chosen depth (`input_depth_<depth>_index_<index>.json`) using `scripts/generate_input_depth.js`.
2. Generate a witness using the corresponding WASM (`DiplomaVerifier_Depth<depth>_js/*.wasm`).
3. Generate a Plonk proof:
   - `snarkjs plonk prove DiplomaVerifier_Depth<depth>_plonk.zkey ...`
4. Verify the Plonk proof:
   - `snarkjs plonk verify DiplomaVerifier_Depth<depth>_plonk_vkey.json ...`
5. Print timing for:
   - Input generation
   - Witness generation
   - Proof generation (Plonk)
   - Proof verification (Plonk)
   - Total time

#### Chạy tất cả depth 5..15 (để so sánh Plonk vs Groth16)

Sau khi đã tạo xong các file `DiplomaVerifier_DepthX_plonk.zkey` (X = 5..15), chạy **một lệnh** để đo Input / Witness / Prove / Verify / Total cho từng depth và in bảng:

```bash
# Từ thư mục gốc project (testcircom)
node scripts/measure_plonk_time_all_depths.js        # diploma index = 0
node scripts/measure_plonk_time_all_depths.js 3      # diploma index = 3
```

Cuối log sẽ có **bảng tổng kết** (Depth | Input | Witness | Prove | Verify | Total). Copy bảng đó đặt cạnh bảng Groth16 (từ `measure_proving_time_all_depths.js` hoặc `remote_results/TABLES_LOCAL_VS_SERVER.md`) để so sánh.

#### Chạy một depth (test nhanh)

From the project root:

```bash
# Depth 5, diploma index 0
node scripts/measure_plonk_time_depth10.js 5

# Depth 5, diploma index 3
node scripts/measure_plonk_time_depth10.js 5 3

# Depth 10, diploma index 0
node scripts/measure_plonk_time_depth10.js 10
```

The script expects (for a given depth `D`):

- `DiplomaVerifier_DepthD_plonk.zkey`
- `DiplomaVerifier_DepthD_plonk_vkey.json`
- `DiplomaVerifier_DepthD/DiplomaVerifier_DepthD_js/DiplomaVerifier_DepthD.wasm`
- `processed_diplomas.json`
- `merkle_tree_data_depth_D.json`

If any of these are missing, it will print a clear error message.

---

### 4. Notes and comparison with Groth16

- The Circom circuit (`DiplomaVerifier_Depth10.circom`) is **identical** between Groth16 and Plonk runs.
- Only the `snarkjs` commands change:
  - Groth16: `groth16 setup`, `groth16 prove`, `groth16 verify`.
  - Plonk: `plonk setup`, `plonk prove`, `plonk verify`.
- This allows you to compare:
  - Proof size (Groth16 vs Plonk).
  - Proving time.
  - Verification time.

