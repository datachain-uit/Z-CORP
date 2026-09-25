# CSI-CHAIN-LOCAL-01: local-EraVM arm (L2)

Records of the local-EraVM arm (CHAIN-PROTOCOL-v1 section 16, amendment A6). The L1 arm and its records in the parent
directory are frozen and unchanged.

- `observation/`: the read-only observation of live ZKsync Era Sepolia (raw answers, digests) and the compatibility
  classification (class B).
- `notes/`: readiness records (packaging, smoke, reduced dry run, determinism). Not scientific data.

No scientific L2 run exists yet. Harness: `chainbench/adapters/eravm/` (commands `./chainbench/run.sh doctor-l2 |
smoke-l2 | dry-run-l2 | full-local-l2`). Binding: `chainbench/workloads/zcorp/campaigns/CSI-CHAIN-LOCAL-01-L2.json`.
