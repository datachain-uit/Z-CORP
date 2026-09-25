# CSI-CHAIN-PUBLIC-01 pre-freeze validation, 2026-09-25 (engineering; not scientific data)

Commits (local): `e18da5a` D1–D3 and the provider/fallback policy; `8674988` round-1 corrections (candidate
**measurement_code_commit**; the final image was built here); `6827943` the frozen image record and the approved author
values (harness commit of this readiness). No key was created, read or mounted; nothing was signed or sent.

| Directory | Where / when | What |
|---|---|---|
| `round1-e18da5a/` | Mac, 16:33–16:36Z | image `sha256:7e23ea81…` (superseded; `ARCHIVE.superseded-7e23ea81.json`), container dry run 92/92, guard tests, wrapper tests 10/11 (one wrong expected ledger count; guards correct), first secondary probe |
| `image-8674988/` | Mac, 16:40–16:41Z | the final image: build log, `ARCHIVE.json` as written, inspect, history, inventory (`image-surface.json`), `npm ls` |
| `secondary-8674988/` | Mac, 16:41:32–16:41:46Z | read-only probe of the Alchemy ZKsync Era Sepolia endpoint (`--secondary --errors`; URL never printed or stored, sha256 only); `rpc-compat-secondary.coverage.json` recomputes the coverage offline after the probe-tool fix in `6827943` (the recorded verdict counted an expected-error probe as a failed fee estimate) |
| `final-6827943/` | Mac, 16:45–16:47Z, clean tree at `6827943`, frozen image `246e35a0…` | `verify-image-public`, container dry run with its full record (92/92; validation 66/66 and 40/40), `check-public-inputs` 27/27, offline doctor (no FAIL), guard tests in the image (key-file 44/44, image/runner/endpoint/derive 39/39), key-file tests on the Mac's BSD `stat` 44/44, wrapper tests 11/11 (+ their ledger lines), endpoint rule 13/13, `npm audit` and `npm audit signatures`, comparisons with the accepted native dry run and the pre-flight container dry run |
| `integrity/` | VM, after the final checks | tags, L1/L2/prover raw, PS-01, acquisition raw, release archives, L1/L2 measurement code vs tags, protected paths |
| `tools/` | — | the engineering scripts used (`prefreeze_mac.sh`, `compare_dry.py`, `integrity_check.py`); the probes and tests themselves are versioned under `chainbench/adapters/public/tools/` |
