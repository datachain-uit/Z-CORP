# Growth of the depth-parameterized circuit

This directory contains the published constraint and expanded-gate
measurements for Merkle-tree depths 5–15.

#### Published experimental results

The following table reports the Groth16 R1CS constraint count and the corresponding expanded PLONK gate count for Merkle-tree depths 5–15. The number of leaves is \(2^d\), where \(d\) is the tree depth.

| Depth | Leaves | Groth16 constraints | PLONK expanded gates | PLONK/Groth16 ratio |
|---:|---:|---:|---:|---:|
| 5 | 32 | 1,512 | 19,227 | 12.72 |
| 6 | 64 | 1,755 | 21,702 | 12.37 |
| 7 | 128 | 1,998 | 24,177 | 12.10 |
| 8 | 256 | 2,241 | 26,652 | 11.89 |
| 9 | 512 | 2,484 | 29,127 | 11.73 |
| 10 | 1,024 | 2,727 | 31,602 | 11.59 |
| 11 | 2,048 | 2,970 | 34,077 | 11.47 |
| 12 | 4,096 | 3,213 | 36,552 | 11.38 |
| 13 | 8,192 | 3,456 | 39,027 | 11.29 |
| 14 | 16,384 | 3,699 | 41,502 | 11.22 |
| 15 | 32,768 | 3,942 | 43,977 | 11.16 |

Counts were measured with circom 2.1.6 after adding the binary selector constraint to `Selector()`. They are fixed by the circuit source and compiler version, so repeated compilations reproduce them exactly.

| Artifact | Link |
|---|---|
| Constraint measurement, run | [20260920T120000-depth5-15-constraints.csv](20260920T120000-depth5-15-constraints.csv) |
| Constraint-growth visualization | [Figure 6 (PDF)](Figure_6.pdf) |
| Complete artifact directory | This directory |

---

## Reproduction

See the
[circuit-growth measurement guide](../../../docs/experiments/experiment-2.1-constraints.md).
