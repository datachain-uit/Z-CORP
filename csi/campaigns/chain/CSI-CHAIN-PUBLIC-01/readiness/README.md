# CSI-CHAIN-PUBLIC-01 readiness records (engineering; not scientific data)

- `dry-public-05c9bfe-20260925T151220Z/`: `./chainbench/run.sh dry-run-public` equivalent, run natively (Node 22.23.2) at the
  harness commit `05c9bfe` in the Linux VM on the author's machine (native Node, not the image): mock endpoints on 127.0.0.1 only, an ephemeral random key that
  existed only during the run, no public network, no test ether. `SUMMARY.json`: 92/92 expectations pass (units 26,
  refusals 19, normal 36, faults 11). `normal/` holds the full 40-transaction schedule (setup on both mock networks,
  sessions S1–S3), the Era batch-lifecycle collection and the derivation (`derived/validation.json`: 66/66);
  `faults/` and `faults-setup/` the injected failures; `refusals/` the chain-id refusal runs. Every value in these runs
  comes from mock endpoints (gas values are taken from the controlled study, prices and times are synthetic).
- `doctor-offline-05c9bfe.json`: `doctor-public --offline` at the same commit (no FAIL; open: session times, key, Sepolia
  endpoint).
The containerized dry run and the live read-only doctor on the campaign host are author steps (protocol section 17).
