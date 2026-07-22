# Growth of the depth-parameterized circuit

This directory contains the published constraint and expanded-gate
measurements for Merkle-tree depths 5–15.

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
| Constraint measurement, run | [20260711T054936-depth5-15-constraints.csv](20260711T054936-depth5-15-constraints.csv) |
| Constraint-growth visualization | [Figure 6 (PDF)](Figure_6.pdf) |
| Complete artifact directory | This directory |

---

## Reproduction

See the
[circuit-growth measurement guide](../../../docs/experiments/experiment-2-constraints.md).
