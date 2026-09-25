# Why `input_ms` rises sharply at d14–d15 (CSI-PROVER-01)

This is a post-campaign investigation. No timing campaign was run for it. It uses the committed
code, the artifacts in `data/merkle-trees/`, the accepted rows of CSI-PROVER-01, and one engineering
micro-diagnostic. The micro-diagnostic is labelled below and is **not** campaign data; it is not
merged into CSI-PROVER-01.

## What the input stage does

`input_ms` times exactly one call, `generateInputForDepth(depth, 0, {outputFile})`
(`bench/lib/pipeline.js:50-52`). That function is `scripts/setup/generate_input_depth.js:35-102`, and
for every call it:

1. resolves `data/merkle-trees/processed_diplomas_<2^d>.json` and `data/merkle-trees/merkle_tree_data_depth_<d>.json` (lines 35-45, 12-33);
2. reads **both whole files** with `fs.readFileSync(…, 'utf8')` and parses them with `JSON.parse` (lines 57-58);
3. uses only record 0 and proof 0 (lines 69-70), assembling an input of 7 fields (lines 78-86);
4. writes that input with `JSON.stringify(…, null, 2)` to container-local tmp (lines 88-89). The output is 0.8–1.7 KB.

## Structure of the files it reads

The structure below was inspected without timing, using `scripts/analysis/input_stage_diagnostic.js`.

| d | tree JSON (bytes) | processed JSON (bytes) | total (MB) | leaves = proofs | sibling strings | records | output (bytes) |
|---|---|---|---|---|---|---|---|
| 5 | 24,105 | 8,932 | 0.03 | 32 | 160 | 32 | 758 |
| 8 | 267,713 | 71,416 | 0.34 | 256 | 2,048 | 256 | 1,031 |
| 10 | 1,274,720 | 285,641 | 1.56 | 1,024 | 10,240 | 1,024 | 1,214 |
| 11 | 2,751,814 | 571,332 | 3.32 | 2,048 | 22,528 | 2,048 | 1,306 |
| 12 | 5,913,767 | 1,142,708 | 7.06 | 4,096 | 49,152 | 4,096 | 1,397 |
| 13 | 12,643,466 | 2,285,299 | 14.93 | 8,192 | 106,496 | 8,192 | 1,489 |
| 14 | 26,919,316 | 4,570,771 | 31.49 | 16,384 | 229,376 | 16,384 | 1,582 |
| 15 | 57,114,606 | 9,141,596 | 66.26 | 32,768 | 491,520 | 32,768 | 1,674 |

- **Tree file.** Every tree file is a full tree: `totalLeaves = realLeaves = 2^d`. It holds all 2^d
  leaves and a precomputed Merkle proof for every leaf, each with d siblings, so it has d·2^d
  sibling strings.
- **Processed file.** It holds 2^d records.
- **Growth.** The bytes read and parsed per call therefore grow by about 2.1–2.2× per depth level,
  while the stage needs only one proof of d siblings.

## Campaign data

Medians of `input_ms` (ms), primary rounds 1–5, from `derived/prover_stage_summary.csv`. The last
column is the cost per MB read and parsed.

| d | Groth16 `cpu2` / `cpu4` / `cpu8` | PLONK `cpu2` / `cpu4` / `cpu8` | ms per MB (all six) |
|---|---|---|---|
| 5 | 0.84 / 0.80 / 0.79 | 0.80 / 0.79 / 0.77 | ≈24 (fixed cost dominates) |
| 10 | 2.86 / 2.81 / 2.84 | 2.95 / 2.88 / 2.94 | 1.8–1.9 |
| 11 | 6.68 / 6.73 / 7.06 | 6.28 / 5.90 / 5.75 | 1.7–2.1 |
| 12 | 9.81 / 8.96 / 8.95 | 16.58 / 14.56 / 15.07 | 1.3–2.3 |
| 13 | 27.60 / 25.65 / 30.86 | 25.80 / 23.33 / 23.17 | 1.6–2.1 |
| 14 | 49.57 / 45.82 / 46.72 | 49.31 / 45.06 / 45.01 | 1.4–1.6 |
| 15 | 119.11 / 107.43 / 102.71 | 123.15 / 111.10 / 116.38 | 1.6–1.9 |

- **Growth per level.** From d10 upwards, `input_ms` roughly doubles per level, tracking the bytes
  parsed. Its cost per MB stays within about 1.3–2.3 ms/MB.
- **It does not change with allocated vCPUs.** The median S4 and S8 of `input_ms` are about 1 (see
  `prover_scaling.csv`).
- **Its share of Groth16 `wall_ms` grows at the top depths.** At d15, it is about 18% (`cpu2`), 26%
  (`cpu4`) and 31% (`cpu8`) of Groth16 `wall_ms`. At d14 it is 9%, 14% and 18%, and at d10 under 2%.
  This is why Groth16 `wall_ms` grows faster with depth than Groth16 `prove_ms`.

## Engineering micro-diagnostic (not campaign data)

`node scripts/analysis/input_stage_diagnostic.js --reps 9` was run on 2026-09-25 inside the Claude
desktop app's Linux VM on the campaign host. That is Node v22.23.2, linux/arm64 with 4 vCPUs: a
different environment from the campaign (Node 18.20.8 in the benchmark container). Absolute values
are therefore not comparable with the campaign; only the split between operations is. The full
output is in `input-stage-diagnostic-20260925.json`.

The table shows medians of 9 repetitions, warm file cache, in ms:

| d | read ×2 (utf8) | JSON.parse ×2 | assemble | stringify + write | whole `generateInputForDepth` |
|---|---|---|---|---|---|
| 10 | 1.63 | 0.98 | 0.001 | 0.05 | 3.03 |
| 13 | 10.41 | 10.36 | 0.001 | 0.10 | 21.08 |
| 14 | 20.89 | 19.72 | 0.001 | 0.09 | 41.45 |
| 15 | 45.75 | 61.96 | 0.002 | 0.11 | 87.79 |

Reading, including UTF-8 decoding to a JS string, and `JSON.parse` account for essentially all of
the stage. Assembling the input and writing it are negligible at every depth.

## Conclusion

- **Directly established.**
  - `generateInputForDepth()` reads and parses two whole JSON files on every call.
  - Their size grows by about 2.1–2.2× per depth, because the tree file materialises every leaf and
    a proof for every leaf of a full tree of capacity 2^d, and the processed file holds 2^d records.
  - Only one record and one proof are used.
  - In the campaign, `input_ms` grows in step with those bytes from d10 upwards, at a roughly
    constant cost per MB, and does not scale with allocated vCPUs.
  - The "sharp rise at d14–d15" is therefore not a discontinuity. It is the same roughly 2× per
    level growth that is already present from d10–d11. It only becomes large in absolute terms, and
    relative to the Groth16 prover, at the top depths.
- **Plausible inference.**
  - The stage cost is dominated by file read with UTF-8 decoding and by `JSON.parse`, both linear in
    the bytes parsed. This is supported by the micro-diagnostic split, which comes from a different
    Node version and machine, and by the near-constant ms/MB in the campaign.
  - Consequently, `input_ms` measures a property of how this benchmark stores its inputs (whole-tree
    JSON with all proofs), not of proof generation. A workload that loads only the needed path would
    not show this growth. This has not been measured.
- **Unsupported speculation (not examined).**
  - The d14→d15 step is slightly steeper than the byte growth: ×2.2–2.6 in `input_ms` against ×2.10
    in bytes. The micro-diagnostic parse time also grows faster at d15. This may reflect V8
    heap-growth or garbage-collection effects when parsing about 66 MB, but nothing here measures
    that.
