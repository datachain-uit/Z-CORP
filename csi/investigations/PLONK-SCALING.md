# PLONK proving and allocated vCPUs: implementation inspection (CSI-PROVER-01)

This is static code reading only. No campaign was run, no causal claim is made, and the measured
results are unchanged by this note.

**Scope.** snarkjs 0.7.5 and ffjavascript 0.3.1, as pinned by `bench/package-lock.json` and
installed in the benchmark image. The same versions were installed off-host from the same lockfile
for reading. Line numbers refer to `snarkjs/src` and `ffjavascript/src`. The executed CommonJS
builds (`build/main.cjs`) contain the same functions; for example `plonk16Prove` is at main.cjs:8254
and corresponds to src `plonk_prove.js:47`. snarkjs loads the top-level ffjavascript 0.3.1. The
nested ffjavascript 0.3.0 under `r1csfile` is not used by the provers.

## Observation being examined

These are rounds 1–5 medians, taken as the min–max over depths of the per-depth medians
(`derived/prover_scaling.csv`):

| Quantity | S4 (`cpu2`/`cpu4`) | S8 (`cpu2`/`cpu8`) | `cpu4`/`cpu8` |
|---|---|---|---|
| Groth16 `prove_ms` | 1.63–1.84 | 2.35–2.62 | 1.36–1.43 |
| PLONK `prove_ms` | 1.17–1.19 | 1.24–1.28 | 1.04–1.08 |

The PLONK domain is 2^15 for d ≤ 10 and 2^16 for d ≥ 11. The Groth16 domain is 2^11 for d ≤ 7 and
2^12 for d ≥ 8 (`results/constraints/…/20260920T120000-depth5-15-constraints.csv`).

## How ffjavascript uses the worker pool

- **Pool size.** It is `os.cpus().length` (`threadman.js:110`). In the campaign the CPU-visibility
  adapter makes that equal to the allocated vCPUs, and the harness asserts it for each container.
- **Only `tm.queueAction` reaches workers** (`threadman.js:191-215`). Main-thread field operations
  (`Fr.mul`, `Fr.add`, …) are single wasm calls with buffer copies (`wasm_field1.js:76-81`). Task data
  is copied to and from workers: `postMessage` (`threadman.js:186`) is given no transfer list,
  because the callers pass none (e.g. `engine_multiexp.js:74`, `engine_fft.js:149`).
- **FFT** (`engine_fft.js`):
  - The bit reversal and the input/output copies run on the main thread (lines 73, 106, 225-245).
  - The butterflies run in chunks of at most 2^14 points, split further until there are at least as
    many chunks as workers (lines 109-115).
  - Join stages follow as barriers, each with half as many tasks as chunks (lines 163-164, 213).
- **MSM** (`engine_multiexp.js`):
  - The window width comes from a table: 12 bits at 2^15 points, 13 at 2^16 (lines 3-8, 119).
  - The per-task chunk is `nPoints·nWindows/concurrency`, clamped to [2^10, 2^22] (lines 92-93,
    121-125). With 20–22 windows and at most 8 workers, this puts all points in one chunk. The
    parallel work is then the window tasks, dispatched in ⌈windows/concurrency⌉ waves.
- **`batchInverse`, `batchToMontgomery`/`batchFromMontgomery` and `batchApplyKey`** each split into
  `concurrency` chunks.

## PLONK prover (`plonk_prove.js`): where the work runs

**Uses the worker pool:**
- the iFFTs of the n-size wire, Z and T polynomials and the FFTs to the 4n extended domain (lines 284-296, 440-444, 633, 643);
- the 9 MSM commitments (A, B, C, Z, T1-T3, Wxi, Wxiw; e.g. lines 235-237, 355, 476-478, 744-745);
- `batchInverse` (line 420) and the Montgomery conversions (lines 278-280).

**Runs on the main thread, independent of the worker count:**
- **calculateAdditions** (lines 182-203) and the wire-map loop (lines 261-276);
- **the Z permutation polynomial**: an n-iteration loop with a loop-carried running product (lines
  373-416). It is sequential by construction. Then an n-iteration `num·den⁻¹` loop, which the source
  marks `// TODO: Do it in assembly and in parallel` (lines 422-429);
- **the quotient-polynomial evaluation**: a loop over **4n** points of the extended domain (lines
  517-628), with many field operations per point. This includes two `MulZ.mul4` calls per point
  (lines 589, 607; `mul_z.js:102-148`);
- `divZh` and `T + Tz` over 4n coefficients (lines 638, 646), and the T1/T2/T3 splits;
- six Horner evaluations at ξ (lines 702-707);
- the linearisation polynomial R (lines 839-854) and the opening polynomials Wxi and Wxiw (lines 864-888). Each is several n-size passes;
- inside every FFT: the bit reversal and the copies;
- file reads and the copying of key sections.

## Groth16 prover (`groth16_prove.js`), for contrast

- **Main thread:** only `buildABC1` (lines 147-187), about 2·nCoef + n field operations with nCoef in
  the thousands. A parallel variant exists in the source but is commented out (lines 189-318).
- **Worker pool:** three iFFT → `batchApplyKey` → FFT sequences at n = 2^11 or 2^12 (lines 66-76),
  and the MSMs (G1 A, B1, C, H and G2 B2; lines 85-101). `joinABC` runs as a single worker task,
  because its chunk limit is 2^22 (lines 320-330).

## Assessment

- **Established by code reading.**
  - The PLONK prover performs a substantial amount of per-element field arithmetic on the main
    thread over domains of size n and 4n (2^15–2^18 points). This includes an inherently sequential
    running product and a 4n loop with many operations per point. None of it depends on the worker
    count.
  - The Groth16 prover's main-thread work is small by comparison: a few thousand field operations.
    Its heavy parts, the FFTs over n ≤ 2^12 and the MSMs, go through the pool.
  - Both provers share the pool's structural limits: FFT join stages that engage only part of the
    pool, and MSM parallelism bounded by the number of window tasks.
- **Consistent with the observation (not a causal claim).**
  - By Amdahl's law, a larger fraction of main-thread work means a smaller speedup from more
    workers. The observed weak PLONK scaling (S8 ≈ 1.24–1.28) against the stronger Groth16 scaling
    (S8 ≈ 2.35–2.62) is consistent with this structure.
  - The inspection cannot say how much of PLONK's `prove_ms` each part takes, so it does not
    explain the size of the effect.
- **Not established; needs profiling to confirm.**
  - The time share of each phase or loop.
  - The main-thread time spent copying task data.
  - Worker utilisation during FFT join stages and the last MSM wave.
  - Tools for this: `node --cpu-prof`, or timestamps on the prover's existing debug log lines.
- **Host limitation (unchanged).**
  - The Apple M5 has 4 performance and 6 efficiency cores, and the VM's vCPU threads cannot be
    pinned (protocol §4.4). On `cpu8`, part of the work necessarily runs on efficiency cores.
  - The main thread's placement on a performance or efficiency core is not controlled and not
    recorded. The scaling factor is therefore "allocated vCPUs on this heterogeneous host", and none
    of the above is a statement about identical cores.
