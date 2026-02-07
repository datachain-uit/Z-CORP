# Remote run results summary

## Source

- **Machine**: `datachain.ddns.net` (SSH port 2222, user `ad`)
- **Script**: `node scripts/measure_proving_time_all_depths.js` (diploma index = 0)
- **Date**: Jan 31 (from file timestamps)

## Contents of this folder

| Type   | Count | Files |
|--------|--------|-------|
| Proofs | 11 | `proof_depth_5_index_0.json` … `proof_depth_15_index_0.json` |
| Public | 11 | `public_depth_5_index_0.json` … `public_depth_15_index_0.json` |

Each **proof** file is a Groth16 proof (fields `pi_a`, `pi_b`, `pi_c`).  
Each **public** file is a one-element array containing the **Merkle root** for that depth.

## Merkle roots (public signals) from remote run

| Depth | Merkle root (decimal) |
|-------|------------------------|
| 5     | 13295760363161007064040950663541081240405684862355987560346790030410929705940 |
| 10    | 10862458734296533513138188034879965981442007190194218965863303434755738041522 |
| 15    | 17288922415127487291689047448649989768479198647574147308903483112269936477339 |

(Other depths 6–9, 11–14: see corresponding `public_depth_<d>_index_0.json`.)

## Verification

These proofs were generated and verified on the remote machine (script reported `[INFO] snarkjs: OK!` for each depth).  
To re-verify locally using your local verification keys:

```bash
# Example for depth 10 (run from project root)
snarkjs groth16 verify DiplomaVerifier_Depth10_vkey.json remote_results/public_depth_10_index_0.json remote_results/proof_depth_10_index_0.json
```

Repeat for other depths using `DiplomaVerifier_Depth<X>_vkey.json` and the matching `public_depth_<X>_index_0.json` / `proof_depth_<X>_index_0.json`.

## Timing (remote)

Remote timing log is in **`remote_timing_log.txt`** in this folder.  
A summarized comparison with the local run is in **`TIMING_SUMMARY.md`** (tables by depth, and short Local vs Remote comparison).

## Summary

- **22 files**: 11 Groth16 proofs + 11 public signal files for Merkle depths 5–15, diploma index 0.
- All proofs correspond to the same circuit family (DiplomaVerifier_DepthX) and the same Merkle tree data (e.g. from `processed_diplomas.json` and `merkle_tree_data_depth_<X>.json`).
- Roots differ per depth, as expected (different tree size and padding).
