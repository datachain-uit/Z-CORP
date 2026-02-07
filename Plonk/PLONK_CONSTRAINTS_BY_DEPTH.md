# Plonk constraints theo độ sâu Merkle

Từ output `snarkjs plonk setup` (R1CS → Plonk), cùng circuit DiplomaVerifier_DepthX.

| Depth | Plonk constraints |
|-------|-------------------|
| 5     | 19,222            |
| 6     | 21,696            |
| 7     | 24,170            |
| 8     | 26,644            |
| 9     | 29,118            |
| 10    | 31,592            |
| 11    | 34,066            |
| 12    | 36,540            |
| 13    | 39,014            |
| 14    | 41,488            |
| 15    | 43,962            |

**Ghi chú:** Số Plonk constraints lớn hơn nhiều so với số R1CS constraints (Groth16) vì cách Plonk biểu diễn circuit; mỗi depth tăng thêm khoảng **~2,474** Plonk constraints (tương ứng thêm 1 level Merkle).
