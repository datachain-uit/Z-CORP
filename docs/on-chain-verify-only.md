# Lúc kiểm tra on-chain (chỉ phần verify trên chain)

Khi một giao dịch **verifyDiploma(a, b, c, [root])** được gửi lên, chain thực hiện **chỉ** các bước sau:

---

```
  Tx: verifyDiploma(a, b, c, [root])
        │
        ▼
  ┌─────────────────────────────────────┐
  │ 1. Tra validRoots[root]               │  ← DiplomaManager
  │    Sai → revert "Invalid root"        │
  └────────────────┬────────────────────┘
                   │ OK
                   ▼
  ┌─────────────────────────────────────┐
  │ 2. Gọi verifier.verifyProof(a,b,c,  │  ← DiplomaManager
  │    [root])                           │
  └────────────────┬────────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────────┐
  │ 3. checkField(root) — root ∈ Fr?     │  ← Groth16Verifier
  │    Không → return false              │
  └────────────────┬────────────────────┘
                   │ OK
                   ▼
  ┌─────────────────────────────────────┐
  │ 4. vk_x = IC0 + IC1 × root           │  ← Groth16Verifier
  └────────────────┬────────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────────┐
  │ 5. Pairing: e(-A,B) = e(α,β)·        │  ← Groth16Verifier
  │    e(vk_x,γ)·e(C,δ) → true/false     │
  └────────────────┬────────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────────┐
  │ 6. true → emit, return;               │  ← DiplomaManager
  │    false → revert "Invalid proof"     │
  └─────────────────────────────────────┘
```

---

**Tóm tắt:** Tra root → Gọi Verifier → Kiểm field → Tính vk_x → Pairing → Require/Emit.
