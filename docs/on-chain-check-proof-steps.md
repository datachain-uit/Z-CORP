# Quy trình check proof on-chain — Các bước

Khi user gọi **verifyDiploma(a, b, c, [root])**, việc check proof on-chain đi qua các bước sau (theo thứ tự).

---

## Sơ đồ tổng quan

```
  USER gửi tx: verifyDiploma(a, b, c, [root])
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│  BƯỚC 1 — DiplomaManager: Kiểm tra root đã đăng ký              │
│  require(validRoots[input[0]])  →  "Invalid root" nếu sai       │
└────────────────────────────┬────────────────────────────────────┘
                              │ OK
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  BƯỚC 2 — DiplomaManager: Gọi Verifier                           │
│  verifier.verifyProof(a, b, c, input)                           │
└────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  BƯỚC 3 — Groth16Verifier: Kiểm tra public signal ∈ field        │
│  checkField(pubSignals[0])  →  return false nếu ∉ Fr             │
└────────────────────────────┬────────────────────────────────────┘
                              │ OK
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  BƯỚC 4 — Groth16Verifier: Tính vk_x                             │
│  vk_x = IC0 + IC1 × pubSignals[0]   (linear combination)        │
└────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  BƯỚC 5 — Groth16Verifier: Pairing check (precompile bn128)      │
│  e(-A, B) = e(alpha, beta) · e(vk_x, gamma) · e(C, delta)        │
│  → true nếu đẳng thức thỏa, false nếu không                     │
└────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  BƯỚC 6 — DiplomaManager: Kết quả                                 │
│  • Nếu true: require pass → emit DiplomaVerified(root) → return true │
│  • Nếu false: require(proofValid) revert "Invalid proof"         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Chi tiết từng bước

| Bước | Contract | Việc làm | Fail khi |
|------|----------|----------|----------|
| **1** | DiplomaManager | Kiểm tra **validRoots[root]** (root = input[0]) | Root chưa được addRoot → revert "Invalid root" |
| **2** | DiplomaManager | Gọi **verifier.verifyProof(a, b, c, input)** | Chỉ chuyển sang Verifier, chưa revert |
| **3** | Groth16Verifier | **checkField(pubSignals[0])**: pubSignal phải &lt; r (trong field Fr) | Giá trị ngoài field → return false |
| **4** | Groth16Verifier | Tính **vk_x** = IC0 + IC1 × pubSignals[0] (dùng EC mul + add) | (không revert, chỉ tính toán) |
| **5** | Groth16Verifier | **Pairing check**: gọi precompile 8 (bn128), kiểm tra đẳng thức Groth16 | Đẳng thức sai → return false |
| **6** | DiplomaManager | **require(proofValid)**; nếu OK thì emit DiplomaVerified, return true | proofValid = false → revert "Invalid proof" |

---

## Tóm tắt ngắn

1. **Kiểm tra root** — Root phải nằm trong **validRoots** (đã addRoot).
2. **Gọi Verifier** — DiplomaManager gửi (a, b, c, [root]) sang Groth16Verifier.
3. **Kiểm tra field** — Public signal (root) phải thuộc field Fr.
4. **Tính vk_x** — Linear combination từ verification key và root.
5. **Pairing check** — Kiểm tra đẳng thức e(-A,B) = ... (proof toán học đúng).
6. **Kết quả** — true → tx thành công, emit event; false → revert "Invalid proof".

---

## Luồng theo component (động từ)

| Bước | Component | Động từ | Input | Output |
|------|-----------|--------|--------|--------|
| 1 | DiplomaManager | **Tra** (lookup) | root (input[0]) | validRoots[root] = true/false |
| 2 | DiplomaManager | **Gọi** (call) | a, b, c, [root] | Gửi sang Verifier |
| 3 | Groth16Verifier | **Kiểm** (check) | pubSignals[0] | Thuộc field Fr hay không |
| 4 | Groth16Verifier | **Tính** (compute) | IC0, IC1, root | vk_x |
| 5 | Groth16Verifier | **Xác minh** (verify) | A, B, C, vk_x, vkey | Pairing equation đúng/sai |
| 6 | DiplomaManager | **Require / Emit** | proofValid | Revert hoặc emit DiplomaVerified |

File tham chiếu: **`docs/on-chain-check-proof-steps.md`**.
