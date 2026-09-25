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
- `preflight-20260925/`: the accepted final pre-flight on the campaign Mac (2026-09-25, harness `0c10900`), all read-only:
  `image/` (the pre-flight image `sha256:df3da7e3…`, archive `dabef2cb…`, **superseded engineering provenance**: the final
  image is rebuilt from the pre-freeze code, below), `checks/` (container dry run 92/92, `check-public-inputs` 27/27,
  offline doctor, endpoint rule, npm audit, native-vs-container comparison), `live/` (live read-only `doctor-public` and the
  RPC compatibility probe of the Sepolia primary (Alchemy; URL recorded as sha256 only) and the Era primary (official public
  RPC) at 2026-09-25T15:51Z, raw responses with sha256; `INTERPRETATION-preflight.md` keeps interpretations apart),
  `integrity/` (earlier evidence unchanged), `tools/` (the engineering scripts used).
- `prefreeze-20260925/`: the pre-freeze fixes (D1 frozen-image enforcement, D2 portable key-file checks, D3 versioned key
  tools) validated on the campaign Mac: `round1-e18da5a/` (image `7e23ea81…`, superseded; its wrapper test had one wrong
  expected count, corrected in `8674988`), `image-8674988/` (**the final public image** `sha256:246e35a0…`, archive
  `d8cbdd0f…`, recorded in `chainbench/adapters/public/ARCHIVE.json`), `secondary-8674988/` (read-only compatibility of
  the Alchemy ZKsync Era Sepolia endpoint: 18/18 required methods; URL recorded as sha256 only; `…coverage.json` recomputed
  offline after a probe-tool fix), `final-6827943/` (at the harness commit `6827943`, in the frozen image: dry run 92/92
  with the full record, `check-public-inputs` 27/27, offline doctor, guard tests 44/44 + 39/39, BSD-host key-file tests
  44/44, wrapper tests 11/11, npm audit, comparisons with the accepted native and pre-flight dry runs), `integrity/`.
All of these are engineering records, not scientific data; no key was created or used and nothing was signed or sent.
