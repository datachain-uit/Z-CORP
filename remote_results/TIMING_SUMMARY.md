# Timing summary: Local vs Remote

## Remote machine

- **Host**: `datachain.ddns.net` (SSH port 2222, user `ad`)
- **Script**: `node scripts/measure_proving_time_all_depths.js` (diploma index = 0)
- **Log file**: `remote_timing_log.txt`

## Remote run – timing by depth

| Depth | Input (s) | Witness (s) | Prove (s) | Verify (s) | Total (s) |
|-------|-----------|-------------|-----------|------------|-----------|
| 5     | 0.048     | 0.069       | 1.062     | 0.776      | 1.956     |
| 6     | 0.044     | 0.079       | 1.003     | 0.758      | 1.885     |
| 7     | 0.046     | 0.076       | 1.042     | 0.791      | 1.955     |
| 8     | 0.048     | 0.073       | 1.098     | 0.780      | 2.000     |
| 9     | 0.050     | 0.081       | 1.073     | 0.772      | 1.977     |
| 10    | 0.047     | 0.081       | 1.161     | 0.784      | 2.073     |
| 11    | 0.054     | 0.075       | 1.112     | 0.758      | 1.999     |
| 12    | 0.044     | 0.071       | 1.060     | 0.780      | 1.955     |
| 13    | 0.047     | 0.074       | 1.025     | 0.760      | 1.908     |
| 14    | 0.052     | 0.073       | 1.121     | 0.775      | 2.021     |
| 15    | 0.046     | 0.074       | 1.114     | 0.798      | 2.033     |

## Local run – timing by depth (reference)

(Mac, same script, same index = 0.)

| Depth | Input (s) | Witness (s) | Prove (s) | Verify (s) | Total (s) |
|-------|-----------|-------------|-----------|------------|-----------|
| 5     | 0.051     | 0.056       | 0.476     | 0.362      | 0.945     |
| 6     | 0.045     | 0.058       | 0.493     | 0.284      | 0.880     |
| 7     | 0.046     | 0.059       | 0.507     | 0.287      | 0.899     |
| 8     | 0.046     | 0.059       | 0.558     | 0.285      | 0.949     |
| 9     | 0.048     | 0.061       | 0.566     | 0.289      | 0.966     |
| 10    | 0.049     | 0.062       | 0.566     | 0.282      | 0.960     |
| 11    | 0.097     | 0.059       | 0.588     | 0.281      | 1.027     |
| 12    | 0.051     | 0.057       | 0.623     | 0.284      | 1.015     |
| 13    | 0.049     | 0.060       | 0.623     | 0.283      | 1.015     |
| 14    | 0.049     | 0.059       | 0.637     | 0.283      | 1.029     |
| 15    | 0.048     | 0.057       | 0.651     | 0.289      | 1.045     |

## So sánh nhanh (Local vs Remote)

| Depth | Prove – Local (s) | Prove – Remote (s) | Verify – Local (s) | Verify – Remote (s) | Total – Local (s) | Total – Remote (s) |
|-------|-------------------|--------------------|--------------------|--------------------|-------------------|--------------------|
| 5     | 0.476             | 1.062              | 0.362              | 0.776              | 0.945             | 1.956              |
| 10    | 0.566             | 1.161              | 0.282              | 0.784              | 0.960             | 2.073              |
| 15    | 0.651             | 1.114              | 0.289              | 0.798              | 1.045             | 2.033              |

**Nhận xét:**

- **Prove**: Trên remote ~1.0–1.2 s/depth, trên local ~0.47–0.65 s → remote chậm hơn khoảng 2–2.5 lần (phù hợp với CPU yếu hơn hoặc môi trường khác).
- **Verify**: Remote ~0.76–0.80 s, local ~0.28–0.36 s → remote cũng chậm hơn khoảng 2–2.7 lần.
- **Input / Witness**: Hai máy tương đương (cỡ 0.04–0.08 s).
- Cả hai máy đều pass verify (snarkJS: OK!) cho mọi depth; thời gian tăng nhẹ theo depth trên cả hai.
