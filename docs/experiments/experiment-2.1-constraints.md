# Experiment 2.1: Circuit-growth measurement

This experiment measures the structural growth of the depth-parameterized
circuit for Merkle-tree depths 5–15.

The script reports:

- Groth16 R1CS constraint count
- Expanded PLONK gate count
- PLONK-to-Groth16 count ratio

## Run the measurement

```bash
node scripts/constraints/measure_depth_constraints.js
```

Result file:

```text
results/constraints/{timestamp}-depth5-15-constraints.csv
```

## Optional flags

Skip circuit compilation when compiled artifacts already exist:

```bash
node scripts/constraints/measure_depth_constraints.js --skip-compile
```

Measure selected depths only:

```bash
node scripts/constraints/measure_depth_constraints.js --depths 5,11,15
```

## Published artifacts

The published table, CSV, and Figure 6 are documented in:

[results/constraints/4.2.1-The-Growth-of-Depth-Parameterized-Circuit](../../results/constraints/4.2.1-The-Growth-of-Depth-Parameterized-Circuit/)
