# Workload `zcorp`

The Z-CORP experiment, expressed as a chainbench workload.

- **Contracts:** snarkjs 0.7.5 Groth16 and PLONK verifiers, plus the root-registry managers in `contracts/chain/`.
- **Inputs:** proof set PS-01 (64 proofs).
- **Procedure:** the cell procedure of CHAIN-PROTOCOL-v1 §7.

| Role | File (relative to `chainbench/`) |
|---|---|
| Workload modules | `lib/constants.js` (chain configuration and Z-CORP parameters), `lib/profiles.js` (compile profiles), `lib/plan.js` (plans and cells), `lib/ops.js` (cell procedure), `lib/proofset.js` (PS-01 loader and tamper rule) |
| Workload scripts | `scripts/summarize_l1.py`, `scripts/test.js` (unit tests), `scripts/export_plonk_verifiers.js` (verifier generation and provenance check), `scripts/gen_proofset.js` (the one-off PS-01 generation; never re-run) |
| Campaign record | `workloads/zcorp/record_campaign.py`: writes the campaign record (`campaign.json`, `notes/DRY-RUN.md`) and the registry row from a packaged dry run. It refuses unless every check and comparison passed, and the committed image records equal the image actually used. |
| Campaign binding | `workloads/zcorp/campaigns/CSI-CHAIN-LOCAL-01.json`: venue metadata (campaign id, protocol, frozen inputs, tracked paths) |
| Smoke reference | `workloads/zcorp/smoke-reference.csv`, extracted from the accepted readiness dry run (`e141816`) by `make_smoke_reference.py`. It is a regression fixture, not scientific data. |

Plans: `smoke` (packaging check), `dry` (engineering dry run), `full` (scientific matrix).
