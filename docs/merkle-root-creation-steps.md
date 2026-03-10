# Các bước tạo ra Merkle root ban đầu

Merkle root được tạo từ **danh sách văn bằng** qua hai bước chính: (1) xử lý từng văn bằng thành **leaf**, (2) build **cây Merkle** từ các leaf rồi lấy **root**.

---

## Tổng quan luồng

```
diploma_samples.json
        │
        ▼  [1] prepare_diploma_data.js
processed_diplomas.json  (mỗi phần tử có leafHash)
        │
        ▼  [2] create_merkle_tree_depth.js (hoặc create_merkle_tree.js)
merkle_tree_data_depth_X.json  (root + proofs)
```

---

## Bước 1: Từ raw diploma → leaf (prepare_diploma_data.js)

**Input:** `diploma_samples.json` (các mẫu: last_name, first_name, student_id, issue_date, …)

**Với từng diploma:**

1. **nameHash**
   - Ghép `name = last_name + " " + first_name`.
   - Chia name thành các chunk 32 bytes, hash từng chunk bằng Poseidon, kết hợp lại bằng Poseidon → ra **nameHash**.

2. **majorCode, studentId, issueDate**
   - majorCode: dùng từ data (hoặc random 1–5 trong script mẫu).
   - studentId: từ `student_id`.
   - issueDate: từ `issue_date` (bỏ dấu `-`).

3. **leafHash (leaf của Merkle tree)**
   - Giống circuit HashDiploma:
     - `leafHash = Poseidon(nameHash, majorCode, studentId, issueDate)`  
   - Lưu vào từng phần tử: `nameHash`, `majorCode`, `studentId`, `issueDate`, `leafHash`.

**Output:** `processed_diplomas.json` — mỗi phần tử là một diploma đã có **leafHash** (và các trường dùng làm input circuit).

---

## Bước 2: Từ các leaf → Merkle root (create_merkle_tree_depth.js)

**Input:** `processed_diplomas.json`

**Các bước:**

1. **Lấy danh sách leaf**
   - `leaves = processedData.map(d => d.leafHash)`  
   - Toàn bộ leaf là chuỗi số (field element) dạng string.

2. **Pad đến đủ 2^depth leaf (nếu dùng depth cố định)**
   - `requiredLeaves = 2^depth`.
   - Nếu `leaves.length < requiredLeaves` → thêm leaf giả với giá trị `"0"` cho đủ số lượng.

3. **Quy tắc hash cặp (giống circuit MerkleProof)**
   - `hashPair(left, right) = Poseidon(left, right)`  
   - Dùng cùng Poseidon như trong Circom.

4. **Build cây từ dưới lên**
   - Level 0: mảng `leaves` (2^depth phần tử).
   - Level 1: hash từng cặp (left, right) của level 0 → mảng có 2^(depth-1) phần tử.
   - Level 2: hash từng cặp của level 1 → 2^(depth-2) phần tử.
   - … tiếp tục đến khi còn **1 phần tử** → đó là **root**.

5. **Lưu root và Merkle proofs**
   - Root = phần tử duy nhất của level cuối.
   - Với mỗi leaf (index i), tạo proof: pathIndices (trái/phải từng bước) + siblings (các node anh em từ leaf lên root).
   - Ghi ra file kiểu `merkle_tree_data_depth_X.json` (root, depth, totalLeaves, realLeaves, proofs, …).

**Output:** File Merkle (ví dụ `merkle_tree_data_depth_10.json`) trong đó **root** là Merkle root ban đầu dùng để đăng ký on-chain (addRoot).

---

## Sơ đồ build cây (ví dụ 4 leaf, depth = 2)

```
     [root]          ← Level 2 (1 node) = Merkle root
    /      \
  H01      H23       ← Level 1 (2 nodes): H01 = hash(L0,L1), H23 = hash(L2,L3)
 /  \      /  \
L0   L1   L2   L3    ← Level 0 (4 leaves): leafHash của từng diploma (hoặc "0" nếu pad)
```

- Root = hash( hash(L0,L1), hash(L2,L3) ).
- Công thức chung: từ mảng level hiện tại, hash từng cặp (left, right) → level trên; lặp đến khi còn 1 node.

---

## Lệnh chạy trong project

```bash
# Bước 1: Raw diploma → processed_diplomas.json (có leafHash)
node scripts/prepare_diploma_data.js

# Bước 2: Processed diplomas → Merkle trees (nhiều depth) + root + proofs
node scripts/create_merkle_tree_depth.js
```

Hoặc chỉ một Merkle tree (số leaf là lũy thừa của 2, không chỉ định depth):

```bash
node scripts/prepare_diploma_data.js
node scripts/create_merkle_tree.js
```

---

## Tóm tắt

| Bước | Script | Input | Output |
|------|--------|--------|--------|
| 1 | prepare_diploma_data.js | diploma_samples.json | processed_diplomas.json (nameHash, majorCode, studentId, issueDate, **leafHash**) |
| 2 | create_merkle_tree_depth.js | processed_diplomas.json | merkle_tree_data_depth_X.json (**root**, depth, proofs, …) |

**Merkle root ban đầu** = giá trị **root** trong file Merkle (bước 2), được tạo bằng cách hash cặp (Poseidon) từ các leaf lên đến khi còn 1 node; leaf lại đến từ Poseidon(nameHash, majorCode, studentId, issueDate) trong bước 1.
