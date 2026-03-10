# Các giai đoạn chứng minh 1 proof trên chain là đúng

## Tổng quan

Để một proof được **coi là đúng trên chain**, cần hai lớp kiểm tra:
1. **Toán học:** proof có thỏa verification equation của Groth16 không (pairing check).
2. **Nghiệp vụ:** public input (Merkle root) có nằm trong danh sách root hợp lệ đã đăng ký trên chain không.

---

## Sơ đồ các giai đoạn

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  GIAI ĐOẠN 1: SETUP CHAIN (một lần, người vận hành)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Deploy Groth16Verifier  →  contract chứa verification key + verifyProof  │
│  2. Deploy DiplomaManager(verifier)  →  contract quản lý root + gọi verifier  │
│  3. addRoot(root)  →  đăng ký Merkle root được chấp nhận                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  GIAI ĐOẠN 2: TẠO PROOF (off-chain, người chứng minh)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  Input → Witness → snarkjs groth16 prove  →  proof.json + public.json        │
│  (public = [root])                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  GIAI ĐOẠN 3: GỬI LÊN CHAIN (user gửi transaction)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  verifyDiploma(a, b, c, [root])                                              │
│  - a, b, c = proof đã format (pi_a, pi_b, pi_c bỏ phần tử thứ 3, đảo pi_b)   │
│  - [root] = public signals                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  GIAI ĐOẠN 4: KIỂM TRA TRÊN CHAIN (DiplomaManager)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  Bước 4.1  require(validRoots[root])  →  root phải đã được addRoot()         │
│  Bước 4.2  verifier.verifyProof(a, b, c, [root])  →  gọi contract Verifier   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  GIAI ĐOẠN 5: KIỂM TRA TOÁN HỌC (Groth16Verifier)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  - Check mọi public signal ∈ field (Fr)                                      │
│  - Tính vk_x = IC0 + IC1 * pubSignals[0]  (linear combination)               │
│  - Pairing check: e(-A, B) = e(alpha, beta) * e(vk_x, gamma) * e(C, delta)    │
│  - Trả về true/false                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
            ┌───────────────┐                       ┌───────────────┐
            │  true         │                       │  false        │
            │  → tx success │                       │  → tx revert  │
            │  emit         │                       │  "Invalid     │
            │  DiplomaVerified(root)                │   proof"      │
            └───────────────┘                       └───────────────┘
```

---

## Chi tiết từng giai đoạn

### Giai đoạn 1: Setup chain

| Bước | Việc làm | Ghi chú |
|------|----------|--------|
| 1.1 | Deploy **Groth16Verifier** | Contract do snarkjs generate từ zkey; chứa verification key (alpha, beta, gamma, delta, IC) và hàm `verifyProof(pA, pB, pC, pubSignals)`. |
| 1.2 | Deploy **DiplomaManager**(địa_chỉ_verifier) | Manager lưu `validRoots[root]` và gọi `verifier.verifyProof(...)`. |
| 1.3 | Gọi **addRoot(root)** | Đăng ký Merkle root được chấp nhận (ví dụ root từ `merkle_tree_data_depth_X.json`). Có thể gọi nhiều lần cho nhiều root. |

### Giai đoạn 2: Tạo proof (off-chain)

- Dùng **cùng circuit** đã dùng để tạo zkey/verification key.
- Input → Witness → **snarkjs groth16 prove** → `proof.json` (pi_a, pi_b, pi_c) + `public.json` (thường chỉ `[root]`).

### Giai đoạn 3: Gửi lên chain

- User gửi transaction: **verifyDiploma(a, b, c, [root])**.
- **a** = `[proof.pi_a[0], proof.pi_a[1]]` (bỏ phần tử thứ 3).
- **b** = đảo thứ tự từng cặp trong pi_b (theo format Solidity): `[[pi_b[0][1], pi_b[0][0]], [pi_b[1][1], pi_b[1][0]]]`.
- **c** = `[proof.pi_c[0], proof.pi_c[1]]`.
- **input** = `[root]` = public signals.

### Giai đoạn 4: Kiểm tra nghiệp vụ (DiplomaManager)

1. **validRoots[root]** phải `true` → root đã được đăng ký, nếu không tx revert "Invalid root".
2. Gọi **verifier.verifyProof(a, b, c, [root])** → nếu trả về `false` thì revert "Invalid proof".

### Giai đoạn 5: Kiểm tra toán học (Groth16Verifier)

- **verifyProof** trong contract:
  - Kiểm tra mọi giá trị public signal nằm trong field (nhỏ hơn r).
  - Dùng verification key (alpha, beta, gamma, delta, IC0, IC1) và **pubSignals[0]** (root) để tính **vk_x** = IC0 + IC1 × root.
  - Thực hiện **pairing equation** (precompile bn128):  
    `e(-A, B) = e(alpha, beta) · e(vk_x, gamma) · e(C, delta)`  
  - Nếu đẳng thức thỏa → proof toán học đúng → trả về **true**, ngược lại **false**.

---

## Kết luận: Proof được coi là đúng trên chain khi

1. **Root** trong public input đã được **addRoot** (hợp lệ theo nghiệp vụ).
2. **verifyProof** trả về **true** (pairing check thỏa → proof tương ứng với circuit và public input đó).

Cả hai điều kiện đều do **DiplomaManager** đảm bảo trước khi emit **DiplomaVerified** và trả về thành công.
