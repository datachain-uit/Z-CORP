# CSI-PROVER-01: host-activity disclosure

This note is a disclosure. It is **not** an exclusion rule. Every campaign row is kept, and every
row is used exactly as the frozen protocol specifies. No row was excluded, replaced or rerun, and
CSI-PROVER-01 was not rerun. All times below are UTC on 2026-09-25 and come from the campaign files
cited, except where a row says otherwise.

## 1. Host activity outside the protocol's idle-host ideal

- **The Claude desktop app was running.** It was running on the campaign host for the whole
  campaign, together with its Linux VM (4 vCPUs, 3.9 GiB). This VM is separate from Docker's VM. The
  same was true during the pre-flight and dry runs.
- **Three read-only monitoring commands ran during measured containers.** Claude ran them inside
  that VM on the mounted repository. Each read the log/ledger files (`grep`, `tail`, `cut`, `date`)
  and returned within seconds. None ran `git` or wrote anything. Their times come from the `date -u`
  output they printed:

| # | Command time | Container running (`prover/<p>/rounds.csv`) | Pipeline or call in progress (`started_at_utc`) | That row vs its cell median |
|---|---|---|---|---|
| 1 | 07:00:33 | primary round 5, `cpu8`, container `8a18a7812b65` (06:58:01–07:00:48) | PLONK d14 primary pipeline, started 07:00:18.870 | `wall_ms` 1.03× |
| 2 | 07:41:41 | diagnostic round 5, `cpu2`, container `d05e48836aac` (07:41:27–07:44:05) | PLONK d15 `mem` call, started 07:41:40.868 | `prove_ms` 1.00× |
| 3 | 07:45:45 | diagnostic round 5, `cpu4`, container `2ee0721bee4d` (07:44:06–07:46:22) | PLONK d11 `path` call, started 07:45:39.583 | `prove_ms` 1.02× |

- **Other monitoring commands fell outside measured containers.** One ran during the untimed P7
  check. Two ran during primary round 0, which is a discarded warm-up round; their exact times were
  not printed. The rest ran after the last container.

## 2. The four diagnostic observations

In the whole campaign, only four observations are more than 1.5× their cell median, the cell
being (profile, backend, depth, call type), over the five diagnostic rounds. All four are in the
last container: diagnostic round 5, `cpu4`, container `2ee0721bee4d`. They are the last four
Groth16 calls of that container, 07:46:20.3–07:46:22 (`prover/cpu4/diag.csv`):

| Configuration | Call (position) | `prove_ms` | Cell median | Ratio | `zkey_readfile_ms` | Proof valid / root matches |
|---|---|---|---|---|---|---|
| Groth16 d15 | `mem` (2, path first) | 462.324 | 261.8 | 1.77× | 1.437 | 1 / 1 |
| Groth16 d7 | `mem` (1, mem first) | 364.454 | 173.8 | 2.10× | 1.633 | 1 / 1 |
| Groth16 d7 | `path` (2, mem first) | 291.043 | 172.5 | 1.69× | — | 1 / 1 |
| Groth16 d8 | `path` (2, mem first) | 351.385 | 193.8 | 1.81× | — | 1 / 1 |

- **Timing relative to command 3.** These calls started about 35–37 s after command 3. Command 3
  overlapped the PLONK d11 `path` call before them, and that call was 1.02× its median. So the
  campaign files do not show the command running at the same time as the four calls.
- **Cause.** The cause of the four slow calls is not established. The runner records no host
  activity at a finer granularity than before and after each container.
- **Author activity is possible.** The author reported, shortly after, that the campaign had
  finished. So activity on the host by the author around 07:46 is possible, but it is not recorded.

## 3. Host-load record (`prover/host_samples.csv`)

These are 1-minute load averages sampled on macOS before and after every container:

| Sample | UTC | Load average (1, 5, 15 min) | Power, Low Power Mode | `pmset -g therm` |
|---|---|---|---|---|
| seq 48, before (diagnostic 5 `cpu4`) | 07:44:06 | 2.85 2.69 2.74 | AC Power, 0 | no thermal or performance warning |
| seq 48, after | 07:46:22 | **5.64** 3.51 3.04 | AC Power, 0 | no thermal or performance warning |

- **This after-sample is the highest of all 96 samples.** The median of all samples is 3.12, and
  the next-highest sample is 4.47. For diagnostic `cpu4` containers, the other four after-samples
  range from 2.42 to 3.05.
- **The load average does not identify the source of the extra load.** Its 1-minute window
  (about 07:45:22–07:46:22) contains command 3, the container's own four workers and any other
  host activity.

## 4. Protocol status of the affected container and rows

- **The container passed every acceptance check.** Diagnostic round 5 was accepted at attempt 1
  (`prover/round_ledger.csv`). The container shows:
  - status `ok`;
  - `oom_kill` = 0 and `nr_throttled` = 0;
  - ffjavascript concurrency 4 and cpuset 1-4;
  - repository read-only;
  - every proof valid against the committed root.
- **The frozen protocol has no outlier-exclusion rule.** Diagnostic rows never enter the primary
  summaries (section 3.4), and the four rows are included in the diagnostic medians (section 3.5).
  `csi/campaigns/prover/CSI-PROVER-01/derived/prover_diagnostic.csv` lists every per-round value,
  so their effect on the medians and ranges is visible there.
- **No primary row shows a comparable deviation.** Across all 495 accepted measured primary rows,
  `prove_ms` stays within 0.84–1.25× and `wall_ms` within 0.87–1.20× of their (profile, backend,
  depth) cell median. The 22 primary rows of the container that overlapped command 1 are within
  0.96–1.06× (`prove_ms`) and 0.94–1.04× (`wall_ms`).
