# Luồng 1: Tạo Merkle root ban đầu (components + động từ)

## Mẫu dữ liệu văn bằng (tóm tắt cho sơ đồ)

**Raw (đầu vào — 1 bản ghi):**
```json
{
  "last_name": "Vo",
  "first_name": "Tan Khoa",
  "student_id": "08520555",
  "issue_date": "2013-05-24"
}
```
→ Thêm: major/majorCode (script dùng hoặc random 1–5).

**Sau chuẩn hóa (1 bản ghi, dùng cho circuit):**
```json
{
  "nameHash": "<số>",
  "majorCode": 2,
  "studentId": "08520555",
  "issueDate": "20130524",
  "leafHash": "<số>"
}
```
→ **leafHash** = Poseidon(nameHash, majorCode, studentId, issueDate).

---

```
┌─────────────────────────────────────────────────────────────────┐
│  COMPONENT 1: Nguồn dữ liệu văn bằng                            │
│  Động từ: Đọc (read)                                            │
│  Input: diploma_samples.json                                    │
│  Mẫu 1 bản ghi: last_name, first_name, student_id, issue_date   │
└────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  COMPONENT 2: Chuẩn hóa & hash leaf                              │
│  Động từ: Chuẩn hóa (normalize), Hash (hash)                    │
│  • Chuẩn hóa tên → nameHash (Poseidon chunks)                   │
│  • Hash(nameHash, majorCode, studentId, issueDate) → leafHash    │
│  Output: nameHash, majorCode, studentId, issueDate, leafHash   │
└────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  COMPONENT 3: Xây cây Merkle                                    │
│  Động từ: Pad (pad), Hash cặp (hash pair), Gộp (merge)          │
│  • Pad danh sách leaf bằng "0" đến đủ 2^depth                   │
│  • Hash cặp (left, right) = Poseidon(left, right)               │
│  • Gộp từng tầng từ dưới lên đến khi còn 1 node → root         │
│  Output: root + danh sách proofs (pathIndices, siblings)       │
└────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  COMPONENT 4: Lưu trữ kết quả                                   │
│  Động từ: Ghi (write), Xuất (export)                            │
│  • Ghi root, depth, totalLeaves, realLeaves                      │
│  • Xuất từng Merkle proof (leaf, pathIndices, siblings)         │
│  Output: merkle_tree_data_depth_X.json                          │
└─────────────────────────────────────────────────────────────────┘
```

## Bảng components & động từ

| Component | Động từ chính | Input | Output |
|-----------|----------------|--------|--------|
| **1. Nguồn dữ liệu** | Đọc | diploma_samples.json | (đầu vào cho component 2) |
| **2. Chuẩn hóa & hash leaf** | Chuẩn hóa, Hash | Raw diploma fields | processed_diplomas.json (leafHash) |
| **3. Xây cây Merkle** | Pad, Hash cặp, Gộp | Danh sách leafHash | root + proofs (trong bộ nhớ) |
| **4. Lưu trữ kết quả** | Ghi, Xuất | root + proofs | merkle_tree_data_depth_X.json |

## Cây Merkle (minh họa)

```
                    [ROOT]  ← Gộp (merge) tầng cuối
                   /      \
                 H01       H23   ← Hash cặp (hash pair) từng tầng
                /  \      /  \
              L0   L1   L2   L3   ← Pad (pad) leaves nếu thiếu
```

## Lệnh chạy

```bash
node scripts/prepare_diploma_data.js    # Component 1+2 (+ 4 ghi processed_diplomas)
node scripts/create_merkle_tree_depth.js # Component 3+4
```
