# Z-CORP prover benchmark (rerun protocol v3)

Container harness for the prover experiment of `submission/csi/RERUN-PROTOCOL.md` (v3):
backend × Merkle depth × allocated CPU resources, in one pinned `linux/arm64` image.

## Commands (run from the repository root on the campaign host)

| Command | What it does |
|---|---|
| `bash bench/run-campaign.sh preflight` | Host/VM checks with P9 enforced (AC power, Low Power Mode off, caffeinate), image build, P7 provenance, container pre-flight for every profile, adapter controls. No rounds. |
| `bash bench/run-campaign.sh dryrun` | The above, then the engineering dry run (protocol §3.9) and validation. Timings are not interpreted. |
| `bash bench/run-campaign.sh campaign` | Full prover campaign (P9 enforced). Refused unless `ZCORP_ALLOW_FULL_CAMPAIGN=1` is set deliberately. |
| `bash bench/run-campaign.sh resume <campaign-dir>` | Continue an existing dry run or campaign at the next round that has no accepted attempt (see below). |
| `bash bench/test-resume.sh` | Engineering test of resume on a reduced dry run (plan `resumetest`). Timings are not interpreted. |

Dry runs and pre-flights write to `build/campaigns/<campaign_id>/` (git-ignored). The campaign writes to
`results/postcorr-<YYYYMMDD>/`. Every run ends with `environment/RESULT.txt`; a dry run or campaign also
writes `derived/validation.json`.

## Round-level resume

A round unit is one (kind, round) of the schedule with all its profiles. It is atomic: a session never
resumes inside a profile or inside a round. After the last profile of an attempt, `validate_round.js`
checks that every scheduled profile completed, all expected rows exist, every proof is valid, no
OOM/throttling/pre-flight failure occurred, and appends the outcome to `prover/round_ledger.csv`
(`complete`+accepted, or `failed`). Every invocation of the runner is a new session (`S<UTC>`, recorded
in `environment/sessions.csv`) and repeats the host and container pre-flight. A resumed session refuses
to continue if the campaign ID, git commit, uncommitted state of the campaign paths, image, artifact manifest, adapter, runner, compose
file, Dockerfile, Docker Desktop/Engine/kernel/VM size (checked by the runner) or protocol version,
harness files, schedule or execution plan (checked by `campaign_state.js`) differ from `CAMPAIGN.json`.
`campaign_state.js` records any interrupted attempt as `incomplete` (its rows are kept as evidence) and
lists the remaining units, each as a new attempt of the whole round. The harness refuses to run a round
that already has an accepted attempt. Summaries use only the accepted attempt of each round.

Per-session evidence: `environment/host-<S>.txt`, `p9-<S>.json`, `docker-*-<S>.*`, `preflight/<S>/`,
`manifest-{before,after}-<S>.txt`, `git-status-{before,after}-<S>.txt`, `integrity-<S>.json`,
`RESULT-<S>.txt`, `prover/sessions/<S>/units.csv`. Raw rows carry `campaign_id`, `session_id`, `round`,
`round_attempt`, `profile_id` and `container_id`.

Test hooks (never used in the campaign): `ZCORP_STOP_AFTER_ROUNDS=N` stops cleanly after N accepted
rounds; `ZCORP_TEST_INTERRUPT_AFTER_CONTAINERS=N` (dry runs only) simulates a crash inside a round.

## Profiles (`compose.yaml`)

| Service | cpuset | ffjavascript workers | Memory | Swap | CPU quota |
|---|---|---|---|---|---|
| `cpu2` | 1–2 | 2 | 8 GiB | 0 | none |
| `cpu4` | 1–4 | 4 | 8 GiB | 0 | none |
| `cpu8` | 1–8 | 8 | 8 GiB | 0 | none |
| `tools` | 1–8 | 8 | 8 GiB | 0 | none (untimed work only) |

The repository is mounted read-only at `/work`; the campaign directory at `/results`; no network.
Temporary inputs, witnesses and proofs stay in the container's `/tmp`.

## CPU-visibility adapter

`lib/cpu-visibility.js` is loaded with `--require` through `NODE_OPTIONS`. ffjavascript sizes its worker
pool from `os.cpus().length`, which inside a container lists every CPU of the Linux VM whatever the cpuset.
The adapter makes `os.cpus()` return exactly the CPUs of the effective cpuset, and aborts (exit 97) if the
cpuset, the scheduler affinity and `ZCORP_CPUS` disagree. It changes nothing else.

## Files

- `harness.js`: one container per (kind, round, profile): assertions, artifact hashes, file-cache warm-up,
  in-process warm-up, the round (primary pipelines or diagnostic path/in-memory-key pairs), container record.
- `lib/pipeline.js`: input (in-process `generateInputForDepth`) → witness → prove → verify; `wall_ms` is the
  end-to-end pipeline total, `stage_sum_ms` the derived sum of the four stages.
- `make_schedule.js`: `CAMPAIGN.json`, `prover/schedule.csv` (seeded profile positions and configuration
  orders), `prover/execution_plan.csv`.
- `preflight.js`, `record_controls.js`: container pre-flight and adapter controls.
- `provenance.js`: P7 artifact provenance.
- `summarize_prover.js`: validation and summaries (`derived/`); warm-up rows and non-accepted attempts are excluded.
- `campaign_state.js`, `validate_round.js`, `lib/validate.js`: resume bookkeeping and round acceptance.
- `check_resume_test.js`, `test-resume.sh`: engineering test of resume.
- `lib/schema.js`: raw CSV, ledger and session schemas.
