# J2 / CSI — post-correction rerun protocol (v3, 2026-09-24; corrections, freeze and operational hardening 2026-09-25)

This protocol replaces every provisional (`\prefix`, red †) value in `submission/csi/main.tex`. It supersedes v2, written the same day. §10 lists what changed.

**Status: the prover protocol is frozen (2026-09-25).** The real-host pre-flight passed after the Docker Desktop resource change (§4.2–4.3), and the engineering dry run `dryrun-20260925T021823Z` passed all 24 validation checks (§3.9). The design is not changed further unless implementation reveals a material problem. The on-chain part (§5) is not frozen by this step; its schema correction of 2026-09-25 is recorded in §10.

**Operational hardening (2026-09-25; scientific design, metrics, profiles, repetitions and pairing unchanged).** Round-level resume with an append-only round ledger (§3.2.1), tested on a reduced dry run (§3.9); P9 host controls enforced and exercised on the host (§4.2); software environment frozen and checked at every session (§4.2.1); P4 commits and the baseline tag (§2). Results: resume test PASS (12/12) on the host with the final runner (`dryrun-resumetest-20260925T035744Z`); P9 pre-flight PASS on AC power (`preflight-20260925T041734Z`), and refused on battery and with Low Power Mode on. The full prover campaign has not been started.

**What changed in v3.** The prover experiment no longer compares three heterogeneous machines (D1/D2/D3). Its factors are now **backend × Merkle depth × allocated CPU resources**, measured under a fixed, reproducible Linux environment:

- three cpuset profiles (`cpu2`, `cpu4`, `cpu8`) on one Apple Silicon host;
- one pinned `linux/arm64` container image;
- fixed memory;
- the same artifacts, seeds and procedure.

The profiles are **resource allocations, not simulated server configurations**.

**What was done for v3.** Untimed feasibility pre-flights on the actual host (2026-09-24 and 2026-09-25; `build/preflight-docker/out/`), then the benchmark infrastructure in `bench/` and one engineering dry run (`build/campaigns/dryrun-20260925T021823Z/`, git-ignored). No scientific timing round has been run. Nothing in the repository's measured data or artifacts changed (manifest 161/161 and `git status` identical before and after the dry run).

The v1 side effect still stands: `data/inputs/input_depth_{5,15}_index_0.json` were rewritten byte-identically (verified by sha256).

**Reproducibility claim (the only one this design makes).** The following are reproducible:

- the container image (by digest);
- the artifacts (by manifest);
- the resource profiles (by definition and pre-flight assertions);
- the seeds;
- the procedure.

**Not claimed:** that absolute timings, or the relative scaling curves, will reproduce on other host hardware.

---

## 0. Decision

| Item | Decision | Condition |
|---|---|---|
| Artifact provenance, d = 5–15, Groth16 and PLONK | **GO.** Every link in §1.2 is verified at every depth. | Re-executed and logged at campaign start (P7) |
| Resource profiles `cpu2`/`cpu4`/`cpu8` on the campaign host | **GO.** All container assertions, untimed proofs and adapter controls passed on the real host (§4.3). | — |
| Campaign host environment | **GO.** Docker VM: 10 vCPUs, 15.60 GiB visible (16 GiB configured), so the 8 GiB container limit is binding (§4.2). | VM manager, Rosetta and Resource Saver are not exposed by Docker Desktop and are not recorded. |
| Prover infrastructure P1–P9 | **Implemented; engineering dry run PASS (24/24 checks).** Round-level resume: resume test PASS, 12/12 on the host (§3.9). P9 enforcement exercised on the host: PASS on AC power; refused on battery and with Low Power Mode on (§4.2). | — |
| P4 commits and baseline tag | **Done 2026-09-25:** commits (a), (b), (c) and tag `rerun-baseline-20260925` (§2). | Files outside (a)–(c) stay uncommitted (§2, P4). |
| Full prover campaign (backend × d = 5–15 × profile, plus the §3.4 diagnostic) | **Ready: GO.** Not started. | Run from tag `rerun-baseline-20260925`: `ZCORP_ALLOW_FULL_CAMPAIGN=1 bash bench/run-campaign.sh campaign`; after a stop: `ZCORP_ALLOW_FULL_CAMPAIGN=1 bash bench/run-campaign.sh resume results/postcorr-<YYYYMMDD>`. Author operational requirements: §4.2.1. |
| On-chain rerun (3 windows × 50 × 2 layers) | **NO-GO now → GO after O1–O9** (unchanged from v2) | O5 and O9 need author input. |
| Manuscript update | After both reruns only | Uses §8 and §9 |

## 1. Artifact provenance: corrected circuit → proving artifacts

### 1.1 What "corrected circuit" means in this protocol (narrow claim)

- **Constraint present.** Every `Selector` instance carries `s * (s - 1) === 0`. A scan of each committed R1CS finds one constraint of the form w·(w − 1) = 0 on every one of the d path-bit wires (`main.pathIndices[i]`), at every depth. Control: the same scan finds **0/d** on the pre-correction R1CS (d = 5, 10, 11, 15).
- **Constraint count.** 297 + 243d, against 297 + 242d before the correction.
- **Targeted regression test.** `test/circuit.selector.negative.js` (4 cases, d = 5) passes against the committed artifacts; the forged cases C and D fail at witness generation. At every depth, the compiled witness calculator rejects the case-C assignment.
- **Not established.** Systematic soundness of the circuit. No formal verification and no systematic under-constraint analysis were performed, and the circomlib Poseidon/Merkle templates were not audited. Protocol, derived files and manuscript describe the circuit only at the level of the three points above. They never call the circuit or the artifact chain "sound" or "correct" in general.

### 1.2 How each artifact is tied to the corrected R1CS

| Link | How it is tied | Evidence (all 11 depths) | What it does not show |
|---|---|---|---|
| Source → `.r1cs` and `.wasm` | Recompilation | `circuits/CredentialVerifier_Depth{d}.circom` compiled with circom 2.1.6 and circomlib 2.0.5 (`--r1cs --wasm --sym`) reproduces the committed r1cs **and** wasm **byte-identically** (manifest sha256). The depth files differ from the base template only in the depth parameter. | Nothing beyond the source itself (§1.1) |
| `.r1cs` → Groth16 zkey (`…_0001.zkey`) | `snarkjs zkey verify` (`zKey.verifyFromR1cs`) with the corrected r1cs and `pot16_final.ptau`. It recomputes the phase-2 initialization from r1cs + ptau and checks the recorded contribution chain. | `true` for d = 5…15 | That the contributor's randomness was destroyed. This cannot be checked, and the setup has a single contribution. |
| `.r1cs` → PLONK zkey | snarkjs 0.7.5 has **no** verify command for PLONK keys. Instead: `plonk setup` takes no contribution and is deterministic, so the key was regenerated from the corrected r1cs + `pot16_final.ptau`. | Regenerated sha256 = manifest sha256 of `data/plonk-zkeys/*` for d = 5…15, i.e. **byte identity** | Nothing beyond the ptau identity (hash-checked) |
| zkey → vkey | Export and compare | Groth16: exported vkey = `data/groth16-vkeys/*` (11/11). PLONK: exported vkey = `data/plonk-vkeys/*` (11/11), `nPublic = 1`, power 15 for d ≤ 10 and 16 for d ≥ 11 | — |
| Groth16 vkey → verifier `.sol` | Constant comparison | `contracts/Groth16LegacyVerifierDepth{d}.sol` embeds the vkey (11/11) | Deployed bytecode ↔ `.sol`. This is established at deployment (O6: bytecode keccak; O8: `staticCall` with the frozen proof) |
| Committed proofs | Verification | Groth16 and PLONK proofs verify with the vkeys; public signal = tree root (11/11 each) | — |
| Files mounted into each profile container ↔ manifest | sha256 | `shasum -c ARTIFACTS.sha256` 161/161 on the repository copy on the campaign host (2026-09-24). Required at campaign start, and for the proving artifacts inside every container before its round (§3.7). Manifest digest `9a7829fe…6f156b43be`. | — |
| `pot16_final.ptau` | sha256 only | Matches the manifest | Ceremony origin. `powersoftau verify` was not run; it is outside the circuit relation. |

**Where the checks ran:**

- **Cloud** (independent of the device): Node 22.22.2, snarkjs 0.7.5 / ffjavascript 0.3.1 / fastfile 0.0.20, circom 2.1.6, circomlib 2.0.5, r1csfile 0.0.48. Checks run there: recompilation, R1CS scan, Groth16 zkey verify, PLONK regeneration. The input files were first sha256-matched to the manifest (35/35).
- **Device** (repo `node_modules`, Node 18.20.8): vkeys, `.sol`, proofs and witness rejection.

Checks run 2026-09-24. The cloud logs are not stored in the repository; P7 re-executes all of them and stores the logs with the campaign.

### 1.3 Per-depth results

| d | R1CS constr. | Booleanity on path bits | PLONK gates | r1cs + wasm byte-identical | G16 zkey verify | PLONK zkey regen = manifest | PLONK power | G16 zkey MB | PLONK zkey MB |
|---|---|---|---|---|---|---|---|---|---|
| 5 | 1,512 | 5/5 | 19,227 | yes | true | yes | 15 | 1.13 | 50.79 |
| 6 | 1,755 | 6/6 | 21,702 | yes | true | yes | 15 | 1.25 | 50.98 |
| 7 | 1,998 | 7/7 | 24,177 | yes | true | yes | 15 | 1.37 | 51.17 |
| 8 | 2,241 | 8/8 | 26,652 | yes | true | yes | 15 | 1.63 | 51.36 |
| 9 | 2,484 | 9/9 | 29,127 | yes | true | yes | 15 | 1.75 | 51.55 |
| 10 | 2,727 | 10/10 | 31,602 | yes | true | yes | 15 | 1.87 | 51.74 |
| 11 | 2,970 | 11/11 | 34,077 | yes | true | yes | 16 | 1.99 | 101.22 |
| 12 | 3,213 | 12/12 | 36,552 | yes | true | yes | 16 | 2.11 | 101.41 |
| 13 | 3,456 | 13/13 | 39,027 | yes | true | yes | 16 | 2.23 | 101.60 |
| 14 | 3,699 | 14/14 | 41,502 | yes | true | yes | 16 | 2.35 | 101.79 |
| 15 | 3,942 | 15/15 | 43,977 | yes | true | yes | 16 | 2.47 | 101.98 |

Every depth also passes the remaining §1.2 checks: vkey equality (both backends), `.sol` embedding, committed-proof verification, and case-C rejection.

**Key sizes co-vary with the proving domain.** The PLONK zkey grows ×1.96 at d = 10→11, exactly where the domain moves from 2¹⁵ to 2¹⁶. The Groth16 zkey grows ×1.18 at d = 7→8, where its domain moves from 2¹¹ to 2¹². §3.4 addresses this.

### 1.4 Keep; do not regenerate

- The circuits, r1cs, wasm, Groth16 zkeys and vkeys, PLONK zkeys and vkeys, and the 11 verifier `.sol` files.
- The trees and inputs.
- The committed proofs.

Regenerating the Groth16 keys draws new entropy. That would silently replace the verified keys, their verifier contracts and the manifest. PLONK regeneration is deterministic and is used only as a check (P7), never as a replacement.

### 1.5 Contamination risks

| Risk | Evidence | Guard |
|---|---|---|
| Hardhat build outputs are pre-correction | `artifacts/` and `artifacts-zk/` build-info (July) contain `Groth16LegacyVerifierDepth11` **without** the current vkey, and still include `hardhat/console.sol` | `npx hardhat clean`, then delete `artifacts-zk/` and `cache-zk/` before compiling (O3) |
| Benchmarks overwrite manifest-covered artifacts | `benchmark-*.js` write `data/inputs`, witnesses and `data/{groth16,plonk}-public-proof/*`. Groth16 proofs are randomised, so the manifest would break and the on-chain proof could change. | The repository is mounted read-only in every container and outputs go to container-local tmp (P1). The on-chain proof copy is frozen first (O7). |
| Re-running setup scripts | `setup_circuits_all.js` and `setup_groth16_depth.js` regenerate Groth16 keys with `Date.now()` entropy. Under `npm run`, `circom` resolves to `node_modules/.bin/circom` 0.5.46. | Do not run setup or `prove_all_depths-*` during the campaign. The harness asserts the manifest first. |
| Reusing an old verifier | `deploy_credential_manager.js` honours `VERIFIER_ADDRESS` / `--verifier` | Refuse to run if either is set (O6) |
| Worker pool not matching the allocation | Pre-flight control (2026-09-24): with cpuset 1–2 and no adapter, `os.cpus()` = 10 and ffjavascript starts 10 workers | CPU-visibility adapter plus an assertion that the pool snarkjs uses has exactly `ZCORP_CPUS` workers (§3.1, §3.7) |
| Curve cache reset when snarkjs is loaded | Loading snarkjs loads `r1csfile`, whose nested ffjavascript 0.3.0 executes `globalThis.curve_bn128 = null` at load time. A curve built before `require('snarkjs')` is orphaned with its workers | The harness loads snarkjs before anything builds a curve and records the concurrency of the pool built by snarkjs itself (§3.1) |
| Uncommitted state mixes corrected work with July annotations | Uncommitted before P4: circuit fix, tests, manifest, CSI sources; the 2026-09-21 explorer annotations to the six July window CSVs; deletion of the pre-correction constraints CSV. `data/` is git-ignored. | Separate, labelled commits (P4, done 2026-09-25) |

## 2. Blockers

### Prover

- **P1 Output isolation.** Nothing is written into `data/`. The repository and its keys are mounted **read-only** in every container. Inputs, witnesses and proofs go to container-local `/tmp`, which disappears with the container. Raw rows go to the mounted `results/<campaign>/prover/<profile>/` directory.
- **P2 Harness.** Replace the single-pass loop with the procedure in §3: rounds × profiles, diagnostic block, seeded orders, warm-up, `--expose-gc`, per-call raw rows and metadata.
- **P3 In-process input stage.** Measure input with `generateInputForDepth()` instead of spawning `node generate_input_depth.js`.
- **P4 Commits and baseline tag** (unchanged from v2). Three separate, labelled commits:
  - (a) the corrected state;
  - (b) the 2026-09-21 annotations to the July on-chain CSVs;
  - (c) removal of the pre-correction constraints CSV from the tree.

  Then tag only the new baseline (`rerun-baseline-<YYYYMMDD>`). No July tag (§7.4). v3 adds to commit (a): the adapter, the pre-flight kit (moved out of `build/`), the Dockerfile, the Compose file and the runner (P8).

  **Done 2026-09-25** (tag `rerun-baseline-20260925`; hashes: `git log --oneline -3 rerun-baseline-20260925`):
  - (a) `circuits/CredentialVerifier.circom`; `contracts/Groth16LegacyVerifierDepth{5…15}.sol`; `test/circuit.selector.negative.js`; `ARTIFACTS.sha256`; `PROVENANCE.md`; the manifest-covered constraint outputs of the corrected circuit (`results/constraints/4.2.1-…/20260920T120000-depth5-15-constraints.csv`, `Figure_6.pdf`, `README.md`, `scripts/constraints/plot_constraints.py`); this protocol; `bench/`.
  - (b) the six July window CSVs in `results/blockchain/4.1.2-…/` and that folder's `README.md` (2026-09-21 explorer annotations).
  - (c) `git rm` of `results/constraints/4.2.1-…/20260711T054936-depth5-15-constraints.csv`.

  Left uncommitted, because they belong to none of (a)–(c): the `.gitignore` edit (a trailing `Claude outputs` line); `results/blockchain/4.1.2-…/Figure_5.pdf` (modified 2026-09-21); `scripts/blockchain/plot_verification.py`, `scripts/proving/plot_slowdown.py`, `scripts/proving/plot_stagewise.py`; `CSI_paper/`, `manuscript/`, `submission/` except this protocol, `zkUIT/`, `README-backup.md`. None of them is in the campaign paths (`bench scripts/setup circuits contracts test ARTIFACTS.sha256 PROVENANCE.md`), which the runner requires to be committed for the campaign.
- **P5 Freeze the campaign host environment.** **Done 2026-09-25** (memory 16 GiB configured, 15.60 GiB visible; 10 vCPUs; Docker Desktop 4.92.0). The software environment is frozen for the whole campaign (§4.2.1). Items (b) and (c) could not be confirmed from files: Docker Desktop does not expose these settings. Original items:
  - (a) Raise the Docker Desktop VM memory to **≥ 12 GiB**; it is currently 7.75 GiB and the host has 32 GiB. Keep 10 vCPUs.
  - (b) Record the Virtual Machine Manager, Rosetta setting, file-sharing implementation and Resource Saver setting. The pre-flight read of `settings-store.json` returned empty values for these keys under Docker Desktop 4.90.0.
  - (c) Turn off Resource Saver for the campaign.
  - (d) Re-run the pre-flight. Every §3.7 container assertion must still hold, and the VM must show ≥ 11 GiB (12 GiB configured; the kernel reserves part of it).
- **P6 Pre-flight assertions** in the runner and inside every container (§3.7).
- **P7 Provenance script** (`bench/provenance.js`). It re-executes the §1.2 checks once per campaign, inside the benchmark image, and writes `provenance/p7.json`. Source → R1CS byte identity uses circom 2.1.6 compiled to WebAssembly (`circom2` npm 0.2.16), which is architecture-independent. That build's witness-calculator wasm differs from the committed wasm (native circom 2.1.6) in a few bytes, so for the wasm P7 checks equivalence instead: identical witness for the committed input, and `wtns check` against the committed R1CS. Byte identity with the native binary was shown on 2026-09-24.
- **P8 Reproducible packaging** (§6):
  - a Dockerfile `FROM node@sha256:f9ab18e3…830e` (`node:18.20.8-bookworm-slim`, `linux/arm64/v8`), with a benchmark-only `package.json` and lockfile (`npm ci`) and the harness and adapter copied in;
  - fixed `NODE_OPTIONS="--require /opt/zcorp/lib/cpu-visibility.js --max-old-space-size=4096"`;
  - a Compose file with services `cpu2`/`cpu4`/`cpu8`;
  - a one-command runner.

  Record the built image's digest and the base image's `linux/arm64` manifest digest (`docker buildx imagetools inspect`). Archive the built image with `docker save` next to the Zenodo data.
- **P9 Host conditions for a laptop host.** Implemented in `bench/run-campaign.sh`: the runner starts `caffeinate -dimsu -w <runner PID>` and verifies it directly (process alive, process name, and a power assertion owned by that PID in `pmset -g assertions`); it records power source, Low Power Mode and `pmset -g therm` before and after every container. In `preflight` and `campaign` mode (including every resumed campaign session) it refuses to start unless on AC power, Low Power Mode off, `caffeinate` verified and no other container running, and in `campaign` mode it re-checks AC power, Low Power Mode and `caffeinate` before every container (a failure stops the session; the round in progress stays without outcome and is rerun whole, §3.2.1). The first design (re-executing under `caffeinate` and checking the parent process name) failed on the host: on macOS the parent was `bash`. Each session also runs self-tests of the rule (battery, Low Power Mode and missing `caffeinate` must each be rejected) and writes `environment/p9-<session>.json`. **Exercised on the host 2026-09-25:** `preflight-20260925T041734Z` **PASS**: AC Power, Low Power Mode 0, the runner's `caffeinate` process alive with 5 power assertions owned by it (`pmset -g assertions`: "caffeinate asserting on behalf of" the runner's PID), no other container running, VM 10 vCPUs and 16,745,824,256 bytes visible (`MemoryMiB` 16384), and every `cpu2`/`cpu4`/`cpu8` container assertion, untimed proof and adapter control passed. On the same host the rule refused `preflight-20260925T035659Z` on battery and `preflight-20260925T035724Z` with Low Power Mode on, before any build. The first design (re-executing under `caffeinate` and checking the parent process name) was refused on AC power in `preflight-20260925T035141Z`, because on macOS the parent was the login shell; it was replaced before these runs. Original items:
  - AC power, Low Power Mode off, `caffeinate -dimsu`.
  - Other applications closed; no other containers running.
  - Per (round, profile), the runner records `pmset -g therm`, `pmset -g batt` and `sysctl vm.loadavg`.
  - Optional: `powermetrics` P/E-cluster residency (needs sudo). It describes placement; it does not control it.

### On-chain

- **O1 Remove console.** Remove `import "hardhat/console.sol"` and all 6 `console.log` calls from `CredentialManager.sol`, then re-run `test/CredentialManager.issuerAccess.js`.
- **O2 Rewrite `verification.js` recording** (§5.3). It currently records:
  - no tx hash, timestamps, block or fee;
  - no distinction between unsent, reverted and confirmed attempts;
  - a single latency, which is request→receipt.

  Keep the same contract-call path, so that request→receipt stays comparable with July.
- **O3 Clean build.** Both toolchains.
- **O4 Pin `zksolc`.** It is currently `"latest"`; July used 1.5.15, eraVersion 1.0.2. Record solc and zksolc versions, optimizer settings and evmVersion.
- **O5 Funding.** **≥ 0.75 Sepolia ETH at the start of each window** and ≥ 0.02 ETH on zkSync Sepolia (§5.2). **Author input.**
- **O6 Deploy-script guards and metadata.** Refuse `VERIFIER_ADDRESS`. Record chainId, block number, block timestamp, deployer, bytecode keccak, compiler versions, RPC host and commit.
- **O7 Freeze the on-chain proof.** Copy `data/groth16-public-proof/{proof,public}_depth_11_index_0.json` into `results/<campaign>/onchain/proof/` with their manifest sha256. The verification script reads only that copy.
- **O8 Dry run and read-only checks.**
  - Full dry run on a local Hardhat node: script, CSV schema, state taxonomy, and the layer-order file.
  - On each testnet, before any transaction: `verifier.verifyProof` and `manager.verifyCredential` via `staticCall` with the frozen proof return true, and a wrong root reverts with "Invalid root".
- **O9 Freeze the schedule.** Window dates and times (**author input**), plus the per-window layer-order files (§5.1). Commit both, with their sha256, before the first deployment.

## 3. Prover measurement protocol

### 3.1 Metric definitions

| Metric | Definition |
|---|---|
| `input_ms` | In-process `generateInputForDepth()`: read the processed-record and tree JSON, assemble the input, write it to container-local tmp |
| `witness_ms` | `snarkjs.wtns.calculate` (wasm instantiate + witness + write `.wtns` to tmp) |
| `prove_ms` | **End-to-end latency of one snarkjs proving call**, `groth16.prove(zkeyPath, wtnsPath)` / `plonk.prove(zkeyPath, wtnsPath)`, under a warm file cache. It includes opening the zkey, parsing its header, and reading the key sections the prover needs. It is **not** a measurement of the proving computation alone. |
| `verify_first_ms` | First `verify` call with the in-memory vkey (the July definition) |
| `verify_steady_ms` | Median of 3 further back-to-back `verify` calls |
| `stage_sum_ms` | `input_ms + witness_ms + prove_ms + verify_first_ms`. A **derived diagnostic quantity**, not "total time". |
| `wall_ms` | **End-to-end wall-clock latency of the complete pipeline**: from immediately before the input stage to immediately after `verify_first` returns, including the glue I/O between stages (for example, reading the generated input file). It excludes the `gc()` before the pipeline, the steady-state verifies, validation checks and row writing. |
| `zkey_bytes` | Size of the key file used (recorded per row) |

**Totals.** Wherever the paper or Figure 5 reports "Total" or "total pipeline time", it uses `wall_ms`, unless a different quantity is explicitly named and justified. `stage_sum_ms` and `wall_ms` are both kept in every raw row and never merged; the summary script checks that `stage_sum_ms` equals the sum of the four stage metrics and that `wall_ms` ≥ `stage_sum_ms`.

**No stage is assumed to be, or not to be, sensitive to the CPU allocation.** Every stage is measured in every profile, and the data decide.

**Library and runtime facts that shape the design** (snarkjs 0.7.5, ffjavascript 0.3.1, fastfile 0.0.20, binfileutils 0.0.12, Node 18.20.8 / libuv 1.44.2):

- **Every proving call re-reads the zkey** (`groth16Prove` L893, `plonk16Prove` L8254). It uses a new fastfile descriptor with a 32 MB page cache. Only the kernel page cache persists between calls. PLONK reads lazily, interleaved with computation, so key loading is not a separable prefix of the call (§3.4).
- **Worker count.** ffjavascript starts `min(os.cpus().length, 64)` workers when it builds the bn128 curve. Two facts were verified in the pre-flight (§4.3):
  - inside a container, `os.cpus()` lists every CPU of the Linux VM (10), whatever the cpuset;
  - a CPU quota changes neither `os.cpus()` nor `availableParallelism()`.

  The **CPU-visibility adapter** (`bench/lib/cpu-visibility.js`, loaded with `--require`) is therefore part of the benchmark harness. It:
  - reads the effective cpuset;
  - aborts (exit 97) unless the cpuset size, the scheduler-affinity size and `ZCORP_CPUS` agree;
  - makes `os.cpus()` return exactly the entries of the cpuset CPUs;
  - exposes the values it used as a frozen global for recording;
  - changes nothing else (no prover code, timers, filesystem or other API).

  Its sha256 is recorded in `CAMPAIGN.json`. Pre-flight version: `749eea66…`.
- **Curve cache and load order.** The curve and its worker pool are cached per process in `globalThis.curve_bn128`. Loading snarkjs also loads `r1csfile`, whose nested ffjavascript 0.3.0 resets that cache at load time. The harness must therefore:
  - `require('snarkjs')` before anything builds a curve;
  - run the in-process warm-up;
  - then record `globalThis.curve_bn128.tm.concurrency`, i.e. the pool snarkjs actually uses, and assert it equals `ZCORP_CPUS`.
- **Heap limit.** V8's default heap limit follows the container memory limit, so it is pinned with `--max-old-space-size=4096` in every profile. The pre-flight recorded 4144 MiB.

### 3.2 Structure: rounds × profiles

1. **Campaign pre-flight** (P5, P6, P7) on the host and in one container per profile.
2. **One container per (round, profile).** Every round runs all three profiles, one after another. Each profile runs in a fresh container, i.e. a fresh `node --expose-gc` process.
   - **Profile order.** The positions of `cpu2`/`cpu4`/`cpu8` within each round come from a pre-generated, position-balanced schedule: cyclic Latin-square rows, with a seeded choice of row order for each block of three rounds. In every block of three rounds, each profile occupies each position once. A final partial block (round 10, and the fifth diagnostic round) takes a seeded subset of rows.
   - **Freezing.** The schedule file and its seed are committed before the campaign (`prover/schedule.csv`).
   - **Exclusivity.** Only one benchmark container runs at a time, and no other container runs.
3. **Inside each container:**
   - (a) container pre-flight assertions (§3.7);
   - (b) warm the file cache by reading all key files once;
   - (c) `require('snarkjs')`, then the in-process warm-up (discarded): one Groth16 d = 5 pipeline and one PLONK d = 5 pipeline;
   - (d) record the ffjavascript concurrency;
   - (e) run the round's configurations in a **seeded random order**. Seed = round number, so a round has the same configuration order in every profile;
   - (f) `global.gc()` before each measured pipeline;
   - (g) one raw row per pipeline;
   - (h) at exit, record the container's `memory.peak`, `memory.events` and `cpu.stat`.
4. **Round 0,** discarded but kept (`is_warmup=1`): one full sweep of all 22 configurations in each profile.
5. **Rounds 1…10.** Rounds 1–5 contain all 22 configurations; rounds 6–10 contain only the 11 Groth16 configurations (§3.3).
6. **Then the diagnostic block** (§3.4).
7. **Splitting the campaign.** The campaign may be split across sessions only between complete rounds, never inside a round. Host state is recorded at every restart. Implemented as round-level resume (§3.2.1).

#### 3.2.1 Sessions, attempts and round-level resume (operational; 2026-09-25)

- **Unit.** A round unit is one (kind, round) of the frozen schedule, primary or diagnostic, **with all its profiles**. It is atomic: a session never resumes inside a profile or inside a round. Units run in schedule order: primary rounds 0–10, then diagnostic rounds 1–5.
- **Attempt.** Each execution of a unit is an attempt (`round_attempt` = 1, 2, …). Every raw row carries `campaign_id`, `session_id`, `round`, `round_attempt`, `profile_id` and `container_id` (§7.2).
- **Acceptance.** After the last profile of an attempt, `bench/validate_round.js` accepts the attempt only if every scheduled profile completed with one container record; all expected rows exist in the scheduled configuration order (and, for diagnostic rounds, call order); every proof is valid with the committed root and input; no OOM kill, throttled period, container-assertion or artifact failure occurred; CPU counts, cpuset, memory and swap limits and image match the profile; the profiles ran in the scheduled order; and this session's container pre-flight and adapter controls passed. The outcome is appended to `prover/round_ledger.csv` (`complete`, accepted; or `failed`).
- **Session.** Every invocation of the runner is a new session (`S<UTC>`), recorded with its start and end in `environment/sessions.csv` (git HEAD, image, Docker Desktop, Engine, kernel, VM size, power source, Low Power Mode, caffeinate).
- **Restart.** A resumed session (`bash bench/run-campaign.sh resume <campaign-dir>`) re-runs the host checks (including P9 in campaign mode) and the container pre-flight and adapter controls for every profile. It **refuses to continue** if any of the following differ from `CAMPAIGN.json`: campaign ID; git commit; uncommitted state of the campaign paths; artifact manifest; adapter; runner, Compose file and Dockerfile; benchmark image ID (tag `zcorp-bench:<campaign_id>`); Docker Desktop, Engine, LinuxKit kernel, VM vCPUs and memory (checked by the runner); protocol version, harness files in the image, schedule and execution plan (checked by `bench/campaign_state.js`).
- **Interrupted attempts.** Rows of an attempt without a ledger outcome (for example after a crash or power loss) are recorded as `incomplete` and preserved as evidence. They are never continued or overwritten. The whole unit is rerun as a new attempt.
- **Accepted units** are never rerun: the harness refuses (exit 7) to write rows for a unit that has an accepted attempt, or for an attempt that is not newer than every recorded one.
- **Summaries** use only the accepted attempt of each unit (`derived/validation.json` lists the ledger; the derived files list the round attempts used). Rows of failed or incomplete attempts are kept, never summarised.
- **Planned stop.** `ZCORP_STOP_AFTER_ROUNDS=N` ends a session cleanly after N accepted units. `ZCORP_TEST_INTERRUPT_AFTER_CONTAINERS` (simulated crash) is refused outside dry runs.

### 3.3 Repetitions and pairing

**R = 10 for Groth16 and R = 5 for PLONK, in every profile.** The precision rationale is unchanged from v2:

- Groth16 depth effects are small, and its pipelines are cheap.
- PLONK rounds are expensive, and five rounds give five paired ratios per profile.

No decision is attached to any number.

**Pairing rules:**

- **Cross-backend comparisons use only rounds 1–5.** Both backends' pipelines for depth d in round r run in the same container. Per-round ratio: PLONK_{r,p}(d) / Groth16_{r,p}(d), for each profile p.
- **Profile comparisons are paired by round.** All three profiles of round r run consecutively, in balanced positions. Per-round speedups are:
  - S_{r}(n) = T_{r,cpu2} / T_{r,cpun}, for n = 4, 8;
  - doubling ratios T_{r,cpu2}/T_{r,cpu4} and T_{r,cpu4}/T_{r,cpu8}.

  These are computed for every (backend, stage, depth), with rounds 1–5 for both backends.
- **Groth16 rounds 6–10** are used only in Groth16-specific depth analyses within each profile. Those analyses use rounds 1–10 and also report rounds 1–5 and 6–10 separately, because rounds 6–10 run without PLONK in the process.

### 3.4 zkey-loading diagnostic (kept from v2, run in every profile)

**What can and cannot be separated without modifying the prover** (unchanged from v2):

- **Separable:** the file-system read component. The unchanged `snarkjs.{groth16,plonk}.prove` accepts the key bytes preloaded in memory, through fastfile's in-memory backend.
- **Not separable:** header parsing, and copying key sections into the prover's buffers.

`prove_ms` stays end-to-end. **No causal claim about the proving domain is made:** domain size, key size, FFT sizes and buffer sizes all change together at d = 10→11.

**Diagnostic block** (after primary rounds 1–10):

- **Rounds.** Five diagnostic rounds. Each round runs all three profiles in balanced positions, one fresh container each.
- **Configurations.** PLONK d ∈ {5, 10, 11, 15}; Groth16 d ∈ {5, 7, 8, 15}.
- **Per configuration:** witness once, untimed. Then two proving calls in seeded, balanced order:
  - `path`: exactly the primary call;
  - `mem`: `fs.readFileSync(zkeyPath)` immediately before, timed as `zkey_readfile_ms`, then `prove(zkeyBytes, wtnsPath)`.

  `global.gc()` before each call. Both proofs verified, untimed.
- **Rows** go to `diag.csv`. They never enter the primary summaries.

The file-read share is not assumed to be the same in every profile. It is measured in each one.

### 3.5 Pre-specified descriptive quantities (no decision thresholds)

All quantities are computed from raw rows only; warm-up rows are excluded. Each is reported as its per-round values, their median and their min–max. **Nothing is compared against a pass/fail threshold.**

**Per (profile, backend, depth, stage):**

- n, median, Q1, Q3, IQR, min, max;
- rounds 1–5 for cross-backend and cross-profile outputs;
- rounds 1–10 for Groth16-specific depth outputs.

**PLONK, per profile, rounds 1–5.** L = {5…10}, U = {11…15}.

- A_r = prove_r(11)/prove_r(10);
- S_r = median_U / median_L;
- within-plateau adjacent ratios (5 pairs in L, 4 in U), with their distribution;
- plateau-end ratios prove_r(10)/prove_r(5) and prove_r(15)/prove_r(11), next to the structural growth over the same ranges: gates +64 % / +29 %; key size +1.9 % / +0.8 %.

**Groth16, per profile, rounds 1–10** (plus the 1–5 and 6–10 split):

- prove_r(15)/prove_r(5);
- all adjacent ratios;
- the boundary ratio prove_r(8)/prove_r(7);
- the plateau ratio with L = {5,6,7} and U = {8…15};
- the within-plateau adjacent distribution.

**Cross-backend, per profile, rounds 1–5:** per depth, PLONK_r(d)/Groth16_r(d) for prove and for `wall_ms` (the pipeline total). Report the range of the per-depth medians.

**Resource scaling, rounds 1–5, per (backend, stage, depth).** Stages are input, witness, prove and verify_first; the total is `wall_ms`. `stage_sum_ms` is reported only as a diagnostic.


- S_r(4) and S_r(8) relative to `cpu2`;
- both doubling ratios;
- their median and min–max over rounds;
- their median and min–max over depths, per backend and stage. This is Figure 5.

Also reported:

- whether the PLONK A_r and S_r and the Groth16 quantities differ between profiles. Described, not tested.
- the ffjavascript concurrency and per-container `memory.peak`, as recorded facts.

**Verification:** verify_first and verify_steady medians per profile, and the distribution of the per-run first/steady ratio.

**Diagnostic, per (profile, backend, depth):**

- median `path` and `mem`;
- the paired difference and ratio;
- `zkey_readfile_ms`;
- A_r^path and A_r^mem;
- plateau-end ratios under both call types.

### 3.6 How results are worded

- **Effect sizes, not verdicts.** Template (placeholders, not results): "on `cpu8`, prove(d11)/prove(d10) was ⟨median⟩ (range ⟨min⟩–⟨max⟩ over five paired rounds)".
- **Scaling.** Scaling is described only from the measured speedups. No stage is labelled parallel or sequential in advance. Where a speedup is within its round-to-round spread, the spread is reported alongside it.
- **Profiles are named as allocations.** Wording: "`cpu4`: 4 allocated vCPUs (cpuset), 4 ffjavascript workers, 8 GiB, on the named host". Never "a 4-core server" or any hardware class.
- **PLONK step.** Described as coinciding with the domain and key-size change. The `path − mem` difference is reported as the measured file-read component.
- **Figure 4(d)** shows `verify_first_ms`, and the caption says so.
- **Totals** are `wall_ms` (§3.1). A figure or table that shows `stage_sum_ms` names it explicitly and says why.

### 3.7 Pre-flight assertions (runner and container abort on failure)

**Campaign start and every resumed session** (host runner):

- `shasum -c ARTIFACTS.sha256`: all OK; the digest is recorded.
- P7 provenance checks pass.
- `docker info`: arch `aarch64`, cgroup v2, NCPU ≥ 9, VM memory ≥ 11 GiB visible (≥ 12 GiB configured); Resource Saver not enabled where Docker Desktop exposes the setting.
- The benchmark image digest and platform (`linux/arm64`) match `CAMPAIGN.json`.
- No other container is running.
- Host conditions (P9) are recorded, and enforced in `preflight` and `campaign` mode (AC power, Low Power Mode off, `caffeinate` verified by PID and power assertion); in `campaign` mode also before every container.
- On resume, the identity checks of §3.2.1.

**Every container, before its round** (checks demonstrated in the pre-flight, §4.3):

- `cpuset.cpus.effective` equals the profile's cpuset (`1-2`, `1-4`, `1-8`);
- `cpu.max` = `max 100000` (no quota);
- `memory.max` = 8589934592 and `memory.swap.max` = 0;
- adapter present, and `os.cpus().length` = `availableParallelism()` = `ZCORP_CPUS`;
- ffjavascript concurrency of the snarkjs pool = `ZCORP_CPUS`;
- `process.arch` = `arm64`, machine = `aarch64`, CPU implementer = `0x61` (no emulation);
- `memory.events.oom_kill` = 0 and `cpu.stat.nr_throttled` = 0, before and after the round;
- V8 heap limit recorded;
- sha256 of the zkeys, wasm and vkeys used = manifest;
- versions: Node 18.20.8, snarkjs 0.7.5, ffjavascript 0.3.1, fastfile 0.0.20;
- at d = 5 and d = 11 for both backends, `prove(zkeyBytes, wtnsPath)` returns a proof that verifies with public signal = root. Diagnostic call path only, untimed, once per campaign.

**Controls, once per campaign:**

- a container with a mismatched `ZCORP_CPUS` must exit 97;
- a quota-only container (no cpuset) must exit 97.

### 3.8 Wall-clock planning estimate

No timing has been taken on the campaign host. For planning only, scaling the July 8-worker M1 totals by 8/n gives roughly 0.9 h (`cpu8`), 1.8 h (`cpu4`) and 3.6 h (`cpu2`), including round 0 and the diagnostic block, so about 6–7 h in total. Round 0 gives the actual figure. The host's core types differ from the M1's, so this is not a prediction.

### 3.9 Engineering dry run (infrastructure check; timings not interpreted)

Before the campaign, `bash bench/run-campaign.sh dryrun` runs the complete chain on a reduced plan:

- all three profiles, in the order generated by the runner's schedule;
- Groth16 d = 5 and 8, PLONK d = 10 and 11;
- round 0 (discarded warm-up), one measured primary round, and one diagnostic round over the same four configurations;
- the in-process warm-up (Groth16 d = 5, PLONK d = 5) in every container, as in the campaign;
- P7 over all 11 depths, the container pre-flight and the adapter controls.

Outputs go to `build/campaigns/dryrun-<UTC>/` (git-ignored). The dry run exists only to verify the infrastructure: proofs, adapter and concurrency, schemas, `stage_sum_ms` vs `wall_ms`, seeded ordering, warm-up exclusion, diagnostic calls, ID propagation, artifact and repository integrity, read-only mounting, OOM/throttling flags and summary consumption (`derived/validation.json`). Its timing values are not interpreted and never enter the manuscript.

**Result (2026-09-25, `dryrun-20260925T021823Z`): PASS, 24/24 checks.** 9 containers in the scheduled order (round 0: cpu8, cpu2, cpu4; round 1: cpu4, cpu8, cpu2; diagnostic round 1: cpu2, cpu4, cpu8); 42 pipeline rows (18 in-process warm-up, 12 round-0 warm-up, 12 measured) and 24 diagnostic calls; every proof verified against the committed root; ffjavascript workers = 2/4/8 in every container; no OOM kill or throttled period; repository read-only in every container; manifest 161/161 and `git status` identical before and after. Seeded profile and configuration orders were also reproduced independently (Python, SHA-256) from the recorded seeds.

**Resume test (2026-09-25, `bash bench/test-resume.sh`, plan `resumetest`: Groth16 d = 5 and PLONK d = 10, primary rounds 0–2 and diagnostic round 1; timings not interpreted).** Session 1 creates the dry run and stops cleanly after one accepted round. Session 2 resumes, skips the accepted round and simulates a crash after the first container of the next round. Session 3 resumes, records the interrupted attempt as `incomplete`, reruns that whole round as attempt 2, completes the remaining rounds and validates. Then a direct harness call for the accepted round must be refused without new rows, and resumes of a copy with an altered schedule and of a copy whose record names another commit must be refused. **Result on the host (final runner, `dryrun-resumetest-20260925T035744Z`): PASS, 12/12 checks.** Ledger: primary round 0 attempt 1 complete (session 1, then a clean stop); primary round 1 attempt 1 incomplete (session 2; one container, 4 rows preserved); primary round 1 attempt 2, primary round 2 attempt 1 and diagnostic round 1 attempt 1 complete (session 3, all profiles). Final validation 14/14 with 4/4 rounds accepted; the summaries used round 1 attempt 2 only. The harness call for the accepted round exited 7 with 65 raw rows before and after; the altered-schedule copy was refused by `campaign_state.js` ("schedule.csv differs from the campaign record") and the other-commit copy by the runner ("campaign identity differs; git commit"). An earlier host run with the first runner (`…T033226Z`) also passed 12/12, and the test passed off-host in a Linux container with the final kit.

## 4. Execution environment and resource profiles

### 4.1 The experimental factor

| Profile | cpuset (VM vCPUs) | ffjavascript workers | Memory | Swap | CPU quota |
|---|---|---|---|---|---|
| `cpu2` | 1–2 | 2 | 8 GiB | 0 | none |
| `cpu4` | 1–4 | 4 | 8 GiB | 0 | none |
| `cpu8` | 1–8 | 8 | 8 GiB | 0 | none |

- **One variable changes.** Only the number of allocated vCPUs changes, with the worker count matched to it. The image, kernel, Node, packages, keys, memory limit, heap limit, host and procedure stay fixed.
- **Why powers of two.** In ffjavascript 0.3.1, the FFT mix/join routines round the worker count down to a power of two (`nChunks = 1 << log2(tm.concurrency)`).
- **Why vCPU 0 is excluded.** It is left to the VM and the Docker daemon.
- **Fallback, if `cpu8` ever fails the §3.7 assertions:** `cpu1` (1), `cpu2` (1–2) and `cpu4` (1–4). Profile sizes are **not** derived from the host's core types, because the VM's vCPUs cannot be pinned to physical cores.

### 4.2 Campaign host and runtime (real-host pre-flight, 2026-09-25)

| Item | Value |
|---|---|
| Host | MacBook Pro, `Mac17,2`, Apple M5 |
| CPU cores | 10: 4 "Super" (perflevel0) + 6 Efficiency (perflevel1) |
| RAM | 32 GiB |
| macOS | 26.6.2 (build 25G83) |
| Container runtime | Docker Desktop **4.92.0** (updated from 4.90.0 during the resource change); Engine 29.8.0; containerd v2.3.5; runc 1.5.1; docker-init 0.19.0; context `desktop-linux`; containerd image store; Docker Desktop CLI plugin v0.4.4 |
| Linux VM | LinuxKit kernel 7.0.12-linuxkit, `aarch64`, cgroup v2 (cgroupfs driver); **10 vCPUs; 15.60 GiB visible**; `MemoryMiB` = 16384 in `settings-store.json` |
| VM manager, Rosetta, file-sharing implementation, Resource Saver | **Not exposed.** `settings-store.json` (4.92.0) contains no keys for them, and the Docker Desktop CLI plugin reports only engine status. Not recorded, and not inferred. Resource Saver can only pause an idle VM; the runner starts containers back to back. |
| Base image | `node:18.20.8-bookworm-slim`, index digest `sha256:f9ab18e354e6855ae56ef2b290dd225c1e51a564f87584b9bd21dd651838830e`; `linux/arm64/v8` manifest digest `sha256:0cc5f8897ffbf799d16ffe58bf3ce6242d23e5f9aa658e55b8d5ca8fc7f01bad`; Debian 12 |
| Benchmark image | `zcorp-bench:v3`, built from `bench/` (image ID recorded per campaign in `CAMPAIGN.json`; dry run: `sha256:7cde9e10…a113a20`) |
| Runtime in container | Node 18.20.8 (libuv 1.44.2, V8 10.2.154.26-node.39) |
| Packages in container | snarkjs 0.7.5, ffjavascript 0.3.1, fastfile 0.0.20, binfileutils 0.0.12, r1csfile 0.0.48, circom_runtime 0.1.28, circom2 0.2.16 (circom 2.1.6), circomlib 2.0.5 — from `bench/package-lock.json` |

The first pre-flight (2026-09-24, Docker Desktop 4.90.0, VM 7.75 GiB) is kept in `build/preflight-docker/out/`.

#### 4.2.1 Software environment freeze (2026-09-25) and author operational requirements

| Frozen item | Value | Checked |
|---|---|---|
| Docker Desktop | 4.92.0 | every session (runner; `CAMPAIGN.json` → `environment.docker_desktop`) |
| Docker Engine | 29.8.0 | every session |
| Linux VM kernel | 7.0.12-linuxkit | every session |
| VM size | 10 vCPUs; 16,745,824,256 bytes visible; `MemoryMiB` 16384 configured | every session |
| Base image | `node:18.20.8-bookworm-slim`, index `sha256:f9ab18e3…830e`, `linux/arm64` manifest `sha256:0cc5f889…7f01bad` | image build (digest-pinned `FROM`); arm64 digest recorded in `CAMPAIGN.json` |
| Benchmark image | built from `bench/` at tag `rerun-baseline-20260925`; image manifest `sha256:257d9d8a106dcb9efc1768136119106e88e314d6779be543bdbe49e3b267e5a5`, config `sha256:3f3ad4add97c954e9492e621f9844671c0ccf0ae51495c1fef0d09af0d2d32ab` (identical in every build of this kit on 2026-09-25; recorded in each session's `docker-build-<S>.log`). The ID Docker reports for a build (`sha256:db35885d…2dac3` for `preflight-20260925T041734Z`) is the digest of a manifest list that also holds a BuildKit provenance attestation with a build timestamp, so it differs per build; each campaign records its own in `CAMPAIGN.json` and keeps that image under the tag `zcorp-bench:<campaign_id>` | every session (per-build ID via tag `zcorp-bench:<campaign_id>`) |
| Kit | adapter `749eea66…`; runner, Compose file, Dockerfile and harness files by sha256 | every session |

**No software updates between rounds or sessions**: not macOS, not Docker Desktop, not the Engine, kernel or VM resources, and no `docker` pruning of the campaign image. A resumed session with a different Docker Desktop, Engine, kernel, VM size or image is refused (§3.2.1); a changed environment means a new campaign, not a resumed one.

**Automatic updates.** Docker Desktop 4.92.0 offers no programmatic way to disable automatic updates here: `docker desktop update` only checks for or applies updates (`--check-only`, `--quiet`), and `settings-store.json` holds no key that controls update checks or downloads (only `UpdateInstallerPid`, `UpdateInstallTime`, `UpdatePreviousVersion`). The kit therefore does not disable updates, and no setting is assumed. **Author operational requirement:** accept no Docker Desktop or macOS update from the first round until the campaign ends, and switch off any automatic-update option the Settings windows offer before starting. The runner detects a change: a resumed session with another Docker Desktop, Engine or kernel is refused, and an update during a session would stop the running container and fail that round.

**Other author requirements for the campaign:** start from tag `rerun-baseline-20260925` without new commits until the campaign ends (a different git commit refuses resume); do not modify the campaign paths; keep the Mac on AC power with Low Power Mode off, other applications closed and no other container running (enforced at the start of every session; power and thermal state recorded before and after every container); do not edit files in the repository while a session runs (the whole-tree `git status` is compared before and after each session).

### 4.3 Pre-flight results (untimed; campaign `dryrun-20260925T021823Z`, `environment/preflight/`)

| Check | `cpu2` | `cpu4` | `cpu8` |
|---|---|---|---|
| `cpuset.cpus.effective` | 1-2 | 1-4 | 1-8 |
| `cpu.max` | max 100000 | max 100000 | max 100000 |
| `memory.max` / `memory.swap.max` | 8 GiB / 0 | 8 GiB / 0 | 8 GiB / 0 |
| `os.cpus()` before → after adapter | 10 → 2 | 10 → 4 | 10 → 8 |
| `availableParallelism()` | 2 | 4 | 8 |
| ffjavascript concurrency (pool used by snarkjs) | 2 | 4 | 8 |
| Arch / machine / CPU implementer | arm64 / aarch64 / 0x61 | arm64 / aarch64 / 0x61 | arm64 / aarch64 / 0x61 |
| OOM kills / throttled periods | 0 / 0 | 0 / 0 | 0 / 0 |
| V8 heap limit | 4144 MiB | 4144 MiB | 4144 MiB |
| Repository mount | read-only (EROFS) | read-only (EROFS) | read-only (EROFS) |
| `memory.peak` after the pre-flight proofs (incl. page cache) | 748 MiB | 882 MiB | 1122 MiB |
| Untimed proofs: Groth16 d = 5, PLONK d = 10, 11 (key path); Groth16 d = 5, 11 and PLONK d = 5, 11 (key in memory) | all verify | all verify | all verify |

For every proof in every profile the public root equals the committed public signal, the in-process input equals the committed input, and a shifted root is rejected.

**Controls:**

| Control | Result |
|---|---|
| cpuset 1–2 without the adapter | `os.cpus()` = 10, `availableParallelism()` = 2, **ffjavascript 10 workers** |
| cpuset 1–2 with `ZCORP_CPUS=4` | Adapter abort, exit 97 |
| `--cpus=2` quota without cpuset (effective cpuset 0–9) | Adapter abort, exit 97 |

**P7** passed for all 11 depths in the same run (161/161 manifest entries; R1CS byte-identical with circom 2.1.6 as WebAssembly; wasm witness-equivalent; Groth16 `zkey verify`; PLONK regeneration byte-identical; vkeys, verifier contracts and committed proofs).

### 4.4 Limitations specific to this host and runtime

- **Heterogeneous cores, unpinnable vCPUs.** The M5 has 4 performance ("Super") and 6 Efficiency cores. macOS schedules the VM's vCPU threads, and they cannot be pinned.
  - `cpu8` keeps 8 vCPUs busy on a 10-core host with only 4 performance cores, so part of its work necessarily runs on Efficiency cores.
  - The placement of `cpu2` and `cpu4` is also not guaranteed.

  The factor is therefore **allocated vCPUs on this heterogeneous host**, not a count of identical cores. ffjavascript splits work evenly across workers, so slower cores can bound a phase. This is described, not corrected.
- **Host headroom.** With 10 vCPUs on 10 physical cores, `cpu8` leaves about two cores for macOS, the VM kernel and the Docker daemon. Hence the idle-host conditions (P9).
- **Laptop power and thermals.** Recorded per (round, profile), not controlled (P9).
- **Memory.** Resolved 2026-09-25: the VM has 15.60 GiB visible, above the 8 GiB container limit.
- **What the image does not pin.** The kernel and VM manager belong to Docker Desktop (4.92.0 for this campaign), not to the image. They are recorded and frozen by the author for the campaign (§4.2.1), and the runner refuses to resume if Docker Desktop, the Engine or the kernel changed; the VM manager is not exposed and is not recorded.
- **Architecture.** `linux/arm64` only. There is no x86 emulation, and nothing is generalized to x86.

### 4.5 Optional engineering checks (artifact package only; not part of the factor, figures or tables; never blocking)

- **A host-native run** (macOS arm64, Node 18.20.8, `ZCORP_CPUS=8` set explicitly, since macOS has no cpuset). It is a sanity check of the VM + Linux + container stack, not of container overhead alone.
- **A native `linux/amd64` replication** on any x86 Linux host, using the same Compose profiles. Report it separately and never pool it.

### 4.6 Metadata recorded per campaign

- **`host.json`:** model, chip, core counts per type, RAM, macOS version, power source and Low Power Mode state.
- **`vm.json`:** runtime and version, VM manager, vCPUs, memory, kernel, cgroup version, Resource Saver setting.
- **`image.json`:** base index digest, built image digest, platform, package versions, lockfile sha256.
- **`profile-<p>.json`:** the container pre-flight record (§3.7), in the format of `preflight.js`.
- **Per (round, profile) container,** in `rounds.csv`: container ID, start/end UTC, host load average, `pmset -g therm`, `memory.peak`, `oom_kill`, `nr_throttled`, ffjavascript concurrency.
- **Per session** (implemented file names): `environment/sessions.csv`; `host-<S>.txt`; `p9-<S>.json`; `pmset-assertions-<S>.txt`; `docker-desktop-settings-<S>.txt`, `docker-desktop-cli-<S>.txt`, `docker-version-<S>.json`, `docker-info-<S>.json`; `preflight/<S>/profile-<p>.json`, `controls.json`; `manifest-{before,after}-<S>.txt`; `git-status-{before,after}-<S>.txt`, `git-status-campaign-paths-<S>.txt`; `integrity-<S>.json`; `RESULT-<S>.txt`; `prover/sessions/<S>/units.csv`.
- **Per round attempt:** one row in `prover/round_ledger.csv`.

## 5. On-chain protocol (final)

### 5.1 Design: 3 windows × 50 attempts × 2 layers, with a frozen counterbalanced layer order

**Deployment.** One fresh deployment per network, before the first window:

- verifier d = 11 from the current `.sol`;
- then `CredentialManager(verifier)`, `setIssuer(sender, true)`, `addRoot(root_d11)`.

All windows reuse this deployment.

**Windows.**

- Planned: morning ≈ 10:00, afternoon ≈ 16:00, evening ≈ 20:00 local (UTC+7), within about 36 h.
- Same account, same frozen proof, same calldata.

**Layer order.** This replaces v1's "50 × L1, then 50 × L2", in which layer was confounded with elapsed time.

- Each window is a sequence of **50 pairs**. Each pair holds one L1 attempt and one L2 attempt. The two layers therefore sample the same span of the window.
- **Exactly 25 pairs are L1-first and 25 are L2-first,** randomly permuted by a seeded generator. Seed = SHA-256 of `"<campaign_id>/<window>"`, so every window has a different permutation.
- **Frozen files.** `onchain/schedule/order-<window>.csv` (columns: seq 1…100, pair, layer, layer_attempt 1…50) is generated before the first deployment. It is committed, and its sha256 is recorded in `CAMPAIGN.json`.
- **Execution.** The script executes the file exactly and asserts each row's layer and attempt index. Attempts stay sequential: the next one starts only after the previous one reaches a terminal state or times out.
- **No reordering.** An attempt that cannot be sent keeps its slot with its state (§5.3), and the sequence continues.

**Why no other redesign.** The design still answers RQ3 as a provenance-linked replication. With adequate funding, the July budget-exhaustion outcome is no longer being tested; this is intended.

### 5.2 Funding and balance guard

- **L1 worst case.** Observed Sepolia gas price reached 39.5 Gwei. At about 0.24 M gas, that is about 0.0095 ETH per call, or about 0.48 ETH per 50 calls.
- **Required balances.** ≥ 0.75 Sepolia ETH at the start of each window; ≥ 0.02 ETH on zkSync.
- **Guard before each send, on that layer.** If balance < 3 × (estimated gas × current maxFeePerGas):
  - record `unsent_insufficient_balance` for that slot, and for the remaining slots of that layer in the window;
  - continue the other layer's slots as scheduled.

  This is a documented protocol deviation, never a "failure".
- **Guard RPCs run before `t0`** (§5.3), so they do not enter the latency metrics.
- **Recording.** Balance at window start and end, per network.

### 5.3 Attempt states and timing

**States (unchanged):**

- `unsent_client_error`: no hash, e.g. estimation failed;
- `unsent_insufficient_balance`;
- `submitted_no_receipt`: hash, but no receipt within 10 min;
- `reverted`: receipt with status 0, or CALL_EXCEPTION carrying a receipt;
- `confirmed_success`.

The script does not replace or re-price transactions. A stalled nonce therefore shows up as consecutive `submitted_no_receipt` rows on that layer.

**Three timestamps, all recorded.** Each is recorded both as ISO-UTC wall clock and on the monotonic `performance.now()` clock.

| Timestamp | When |
|---|---|
| `t0` | Immediately before `manager.verifyCredential(a, b, c, input)`. This is the same contract-call path as July: hardhat-ethers populates the transaction (gas estimate, fee data, nonce), signs it and sends it. |
| `t_hash` | When that call resolves with the `TransactionResponse`, i.e. after `eth_sendRawTransaction` returns the hash |
| `t_receipt` | When `tx.wait(1)` resolves |

**Three latencies, all kept:**

- `prep_ms = t_hash − t0`
- `hash_to_receipt_ms = t_receipt − t_hash`
- `request_to_receipt_ms = t_receipt − t0`

Each is computed from its own timestamps. The harness asserts that request_to_receipt ≈ prep + hash_to_receipt to within 1 ms.

**Which definition is comparable to earlier measurements.** `request_to_receipt_ms` is.

- **July J2** (`scripts/blockchain/verification.js`, unchanged since c78545d): `performance.now()` before `manager.verifyCredential(...)`, stop after `tx.wait()`.
- **zkUIT** (`scripts/test_sepolia.js` and `scripts/test_zksync.js`, committed in 89da973 on 2025-05-01, unchanged through 312d062): `Date.now()` before `manager.verifyDiploma(...)`, stop after `tx.wait()`. The zkUIT text calls this "from transaction submission to a successful receipt". In the code, "submission" is the contract-call request, which includes the pre-send RPCs.
- **Caveat.** The zkUIT measurements are dated 29–30 April 2025, and the script was committed two days later. That this exact script produced them is therefore likely but not provable.
- **Other components.** `hash_to_receipt_ms` isolates the post-submission network-side part. `prep_ms` captures the client- and RPC-side preparation, which depends on the RPC endpoint. The RPC host is recorded, never the key.

**Polling.** Receipt polling is 500 ms on both networks (hardhat-ethers 3.0.8 on non-Hardhat networks; zksync-ethers 6.17 `pollingInterval`). Both receipt-based latencies are therefore quantised to about 0.5 s. On zkSync, the receipt means L2 block inclusion, not L1 finality. State both.

**Fees and gas.**

- Fee provenance is kept in separate fields, on both networks:
  - `receipt_fee_wei`: the fee as exposed by the provider/library receipt object, when it is exposed, with `receipt_fee_source` naming the field (for example, ethers' `TransactionReceipt.fee`); empty otherwise;
  - `computed_fee_wei = gas_used × effective_gas_price_wei`, from the receipt's own fields;
  - `fee_difference_wei = receipt_fee_wei − computed_fee_wei` (empty when `receipt_fee_wei` is empty);
  - `fee_consistent`: true when the difference is 0, false otherwise, empty when not comparable.
- The provider-reported fee is **not assumed** to equal the computed value on Ethereum Sepolia or on zkSync Sepolia. Reported fees name the field they use; any inconsistency is reported, not reconciled silently.
- L1 and L2 gas units are never compared.
- Block number and block timestamp are fetched after `t_receipt`, outside all timed intervals.

## 6. Artifacts and files

**Regenerate / produce:**

- `CredentialManager.sol` without console, then a clean compile for EVM and EraVM.
- New deployments.
- All prover raw data (three profiles), including the diagnostic block.
- All on-chain deploy and window data.
- Provenance logs (P7) and pre-flight records (§3.7).
- Derived summaries.
- Figures 4, 5, 6 (`Figure_4/5/6.pdf`) and Tables 6, 8, 9, 10.
- A new campaign README and manifest.
- The benchmark image archive (`docker save`, with its digest).
- A new Zenodo version.
- Extend `ARTIFACTS.sha256` with `data/merkle-trees/*` and `data/inputs/*` (recommended).

**Reproducibility package (implemented 2026-09-25, `bench/`):**

- `bench/Dockerfile`: `FROM node:18.20.8-bookworm-slim@sha256:f9ab18e3…830e`; `bench/package.json` + `package-lock.json` (`npm ci --omit=dev`; snarkjs 0.7.5, circom2 0.2.16, circomlib 2.0.5); harness copied in; fixed `NODE_OPTIONS`.
- `bench/compose.yaml`: services `cpu2`/`cpu4`/`cpu8` (and `tools` for untimed work) with `cpuset`, `mem_limit: 8g`, `memswap_limit: 8g`, **no `cpus`**, `network_mode: none`, repository read-only, results directory read-write. Fallback `cpu1` behind a Compose profile.
- `bench/lib/cpu-visibility.js`: the adapter (unchanged from the pre-flight, sha256 `749eea66…`).
- `bench/lib/common.js`, `lib/checks.js`, `lib/pipeline.js`, `lib/schema.js`: cgroup/environment record, container assertions, the pipeline and diagnostic pair, raw schemas.
- `bench/make_schedule.js`: `CAMPAIGN.json`, frozen profile/configuration schedule (`prover/schedule.csv`) and execution plan.
- `bench/harness.js`: one container per (kind, round, profile); in-process input stage; raw `runs.csv`, `diag.csv`, `rounds.csv`.
- `bench/preflight.js`, `bench/record_controls.js`: container pre-flight and adapter controls.
- `bench/provenance.js`: P7.
- `bench/summarize_prover.js`: validation (`derived/validation.json`) and summaries (`derived/prover_summary.csv`, `derived/prover_diag.csv`). Written in Node so it runs in the same image, with no host dependency.
- `bench/run-campaign.sh`: one command (`preflight` | `dryrun` | `campaign` | `resume <dir>`); the full campaign (and its resumption) is refused unless `ZCORP_ALLOW_FULL_CAMPAIGN=1`. Dry runs write to `build/campaigns/<id>/` (git-ignored); the campaign writes to `results/postcorr-<YYYYMMDD>/`.
- `bench/lib/validate.js`, `bench/campaign_state.js`, `bench/validate_round.js`: round acceptance, ledger and resume bookkeeping (§3.2.1).
- `bench/test-resume.sh`, `bench/check_resume_test.js`: the resume test (§3.9).

**Scripts to change or add before the rerun (not changed now):**

- `scripts/proving/benchmark-*.js`: superseded by the container harness in `bench/` (§3); left unchanged in the repository.
- `scripts/blockchain/verification.js`: per §5.3, reading `onchain/schedule/order-<window>.csv`.
- `scripts/blockchain/deploy_credential_manager.js` (O6).
- `hardhat.config.js`: pin zksolc; make `secret.json` optional for local runs.
- New: `scripts/blockchain/make_layer_order.js` (§5.1).
- `plot_stagewise.py`: read `runs.csv`, profiles as series, rounds 1–5.
- `plot_slowdown.py`: replaced by `plot_scaling.py` (Figure 5: observed speedups against allocated vCPUs, §3.5).
- `plot_verification.py`: campaign-directory argument, new state taxonomy, request_to_receipt.
- `figure-sources/build_figures.sh`: `CAMPAIGN=` parameter.
- New, after the campaign: the manuscript-facing derivations (`prover_boundary.csv`, `prover_crossbackend.csv`, `prover_scaling.csv`, `values.tex`) and `summarize_onchain`. The validation summaries already exist (`bench/summarize_prover.js`).

**Unchanged:** Figures 1–3 and Tables 1–5 and 7. Figure 3 and Table 7 are already post-correction. Table 6 changes (§9).

## 7. Raw-data schema, anti-mixing and July provenance

### 7.1 Directory layout

```
results/postcorr-<YYYYMMDD>/
  CAMPAIGN.json            campaign_id, commit, baseline tag, ARTIFACTS.sha256 digest,
                           protocol version "v3", dates, base-image and built-image digests,
                           adapter sha256, schedule and layer-order file sha256s,
                           superseded_campaign → digest of results/PRECORRECTION-2026-07.sha256
  provenance/              P7 logs: recompilation hashes, booleanity scan, G16 zkey verify,
                           PLONK regeneration hashes, vkey/.sol/proof checks
  environment/host.json, vm.json, image.json
  environment/preflight/<session>/profile-<cpu2|cpu4|cpu8>.json, controls.json
  environment/sessions.csv, p9-<session>.json, integrity-<session>.json, …   (§4.6)
  prover/schedule.csv              round, kind (primary|diag), position, profile, config seed
  prover/execution_plan.csv        container order
  prover/round_ledger.csv          one row per round attempt outcome (§3.2.1)
  prover/host_samples.csv          host state before and after every container
  prover/sessions/<session>/units.csv   units still to run at the start of the session
  prover/<cpu2|cpu4|cpu8>/rounds.csv   one row per (round, profile) container
  prover/<cpu2|cpu4|cpu8>/runs.csv     one row per primary pipeline (incl. warm-ups)
  prover/<cpu2|cpu4|cpu8>/diag.csv     one row per diagnostic proving call
  onchain/proof/                   frozen proof + public + sha256
  onchain/schedule/order-<window>.csv
  onchain/<network>/deploy.csv, deploy.json
  onchain/<network>/window-<morning|afternoon|evening>.csv, window-*.json
  derived/prover_summary.csv, prover_boundary.csv, prover_crossbackend.csv,
          prover_scaling.csv, prover_diag.csv, onchain_summary.csv, values.tex
```

### 7.2 Row schemas

Implemented in `bench/lib/schema.js` (column order fixed; headers are checked).

**`rounds.csv`:** campaign_id, session_id, profile_id, kind, round, round_attempt, position_in_round, container_id, image_id, cpuset, zcorp_cpus, os_cpus_length, available_parallelism, ffjs_concurrency, heap_limit_mb, started_at_utc, ended_at_utc, rows_written, memory_peak_bytes, memory_max_bytes, swap_max, cpu_max, oom_kill, nr_throttled, repo_readonly, artifacts_verified, assertions_passed, status, error.

**`runs.csv`:** campaign_id, session_id, profile_id, container_id, kind, run_id, round, round_attempt, order_in_round, seed, is_warmup, warmup_kind (`in_process` | `round0` | empty), backend, depth, leaf_index, started_at_utc, input_ms, witness_ms, prove_ms, verify_first_ms, verify_steady_ms, **stage_sum_ms**, **wall_ms**, zkey_bytes, zkey_sha256, proof_valid, root_matches, input_matches_committed, public_root, expected_root, heap_used_mb, rss_mb, image_id, manifest_sha256, status, error.

**`diag.csv`:** campaign_id, session_id, profile_id, container_id, diag_round, round_attempt, seed, backend, depth, pair_order (path_first|mem_first), call (path|mem), call_position, started_at_utc, zkey_readfile_ms (mem only), prove_ms, zkey_bytes, zkey_sha256, proof_valid, root_matches, heap_used_mb, rss_mb, image_id, manifest_sha256, status, error.

**`host_samples.csv`** (host side, before and after every container): campaign_id, session_id, seq, kind, round, round_attempt, profile_id, phase, utc, loadavg, power_source, low_power_mode, pmset_therm.

**`round_ledger.csv`** (append-only): campaign_id, kind, round, round_attempt, session_id, status (`complete` | `failed` | `incomplete`), accepted, recorded_utc, recorded_by_session, profiles, rows_runs, rows_diag, detail.

**`sessions.csv`:** campaign_id, session_id, event (start | end), utc, mode, git_head, image_id, docker_desktop, engine, kernel, vm_ncpu, vm_mem_bytes, power_source, low_power_mode, caffeinated, detail.

**`window-*.csv`:** campaign_id, network, chain_id, rpc_host, window, seq, pair, layer_attempt, sender, manager, verifier, proof_sha256, root, t0_utc, t_hash_utc, t_receipt_utc, state, error_code, error_msg, tx_hash, nonce, balance_before_wei, est_gas, max_fee_per_gas_wei, prep_ms, hash_to_receipt_ms, request_to_receipt_ms, block_number, block_timestamp, gas_used, effective_gas_price_wei, **receipt_fee_wei, receipt_fee_source, computed_fee_wei, fee_difference_wei, fee_consistent** (fee fields revised 2026-09-25, §5.3).

**`deploy.csv`:** as today, plus chain_id, rpc_host, block_number, block_timestamp, deployer, bytecode_keccak, solc/zksolc versions, commit. (Unchanged.)

### 7.3 Anti-mixing

- Every plot and summary script takes `--campaign <dir>`. It asserts:
  - a single `campaign_id`;
  - the same commit across all inputs;
  - a single built-image digest across all profile rows.
- Summary scripts select rounds explicitly (1–5 or 1–10, §3.3) and write the rounds used into each derived file.
- Rows from a container whose pre-flight failed, or whose `oom_kill` or `nr_throttled` is non-zero, are kept but flagged, and are excluded from summaries. The exclusion is listed in the derived files.
- Only the accepted attempt of each round unit is summarised; rows of failed or incomplete attempts are kept and never summarised (§3.2.1).
- `diag.csv` is never read by the primary summaries.
- Optional native or x86 runs (§4.5) go to a separate campaign directory and are never read by the manuscript summaries.
- `build_figures.sh` no longer references the July paths.
- Manuscript numbers come from `derived/values.tex` macros, not from hand copying.

### 7.4 July (pre-correction) provenance, without a tag

**No July tag is created, because no commit can be identified as the code that produced the July data:**

- Windows 1 and 2 (2026-07-11, 09:12 and 13:14 UTC) predate the first commit, c78545d (14:28 UTC).
- The prover machines' checkouts were not recorded.
- The contracts changed afterwards: eaf1a90 (07-13) and a723c22 (07-22).

**Provenance is carried by the files, their first commits, dates and checksums.** All the blobs below are unchanged through HEAD a723c22.

| July files | First committed | Working tree |
|---|---|---|
| `device{1,2,3}-{groth16,plonk}.csv` | fdddc89 (2026-07-12) | unchanged |
| Window CSVs 20260711T091246/092751 and T131457/132711 | c78545d (2026-07-11) | modified: 2026-09-21 explorer annotations (tx hashes), uncommitted |
| Window CSVs 20260712T030525/031611 | fdddc89 (2026-07-12) | modified: same annotations, uncommitted |
| Deploy CSVs 20260712T134135/134140 | ae401b2 (2026-07-12) | unchanged |
| Pre-correction constraints CSV 20260711T054936 | c78545d | deleted in the working tree (superseded by 20260920T120000) |

**Before the campaign:**

- Write `results/PRECORRECTION-2026-07.sha256`. It lists, for each July file:
  - path;
  - first commit;
  - git blob ID and sha256 of the committed original;
  - where annotated, the sha256 of the annotated copy (committed in P4b).
- Add a README banner to the July folders: "pre-correction campaign, superseded, not used by the CSI manuscript".
- The July files stay where they are. The new campaign never reads them.

## 8. Where the new data flows

| Output | Source | Rounds |
|---|---|---|
| Table 6 (execution environment and profiles) | `environment/*.json` | — |
| Table 8 (`tab:prove_times`) | `prover_summary.csv`: median and IQR of prove, d = 5, 7, 8, 10, 11, 15, both backends, all three profiles | 1–5 |
| Groth16 depth statements (trend, adjacent steps, d = 7→8), per profile | `prover_boundary.csv` | 1–10, plus 1–5 and 6–10 separately |
| PLONK boundary and plateau statements, per profile | `prover_boundary.csv` | 1–5 |
| Groth16/PLONK gap, per profile | `prover_crossbackend.csv` | 1–5, paired within container |
| Resource-scaling statements | `prover_scaling.csv` | 1–5, paired by round |
| Key-loading diagnostic statements, per profile | `prover_diag.csv` | diagnostic rounds 1–5 |
| Table 9 (`tab:deploy_cost`) | `onchain/*/deploy.csv` | — |
| Table 10 (`tab:onchain_summary`) | `onchain_summary.csv` (unchanged from v2) | — |
| Figure 4 | `runs.csv` via `plot_stagewise.py`: stage medians by depth, profiles as series | 1–5 |
| Figure 5 | `prover_scaling.csv` via `plot_scaling.py`: observed speedups relative to `cpu2`, with round-to-round ranges, per backend and stage; the "Total" panel uses `wall_ms`. Any proportional-scaling line is labelled as a reference, not an expectation. | 1–5 |
| Figure 6 | `window-*.csv` via `plot_verification.py` (unchanged from v2) | — |
| Abstract, Results, Discussion, Conclusion, highlights 3–4 | `values.tex` | Each current `\prefix` value maps to one derived quantity. The July machine ratios (1.90/3.28/1.41/2.93) have **no successor**: they are replaced by profile speedups and are not carried over. |

## 9. Manuscript statements that must change after the rerun (not edited now)

**Framing:**

- **RQ2.** From "prover-side cost across backend, depth and three machines" to: how prover cost varies with Merkle depth and proving backend, and how each stage responds to the CPU resources allocated to the prover, under a fixed, reproducible Linux execution environment.
- **Contribution 2.** A backend × depth × allocated-CPU characterization in a pinned, rerunnable container environment. Remove any cross-machine or hardware-generality wording.
- **Terminology.**
  - "Device #1–#3", "machine" and "environment D1–D3" become "resource profile `cpu2`/`cpu4`/`cpu8`", plus "campaign host" and "container image".
  - Never "server", "laptop-class" or "VM vs bare metal".
- **Reproducibility statement.** The image, artifacts, profiles, seeds and procedure are reproducible. Absolute timings and scaling curves are not claimed to reproduce on other hardware.

**Methodology (`main.tex`):**

- **L449** "solc 0.8.20 …": add the pinned zksolc version, optimizer and evmVersion (unchanged from v2).
- **L458** Stage definitions: input in-process; prove = end-to-end snarkjs call including key loading; verify first vs steady; **total = `wall_ms`, the end-to-end pipeline wall clock** (the sum of stages, `stage_sum_ms`, is not called "total"); one sentence on the key-loading diagnostic; "measured in every profile".
- **L460–461 and Table 6 (L476–478):** replace the three machines with:
  - the campaign host (M5, 4 + 6 cores, 32 GiB, macOS);
  - Docker Desktop and the Linux VM (kernel, vCPUs, memory);
  - the image digest and versions;
  - the three profiles (cpuset, workers, 8 GiB, no swap, no quota);
  - the CPU-visibility adapter, as part of the harness.
- **L462 and authornote L464:** warm-up; rounds × profiles in balanced positions; seeded configuration order; R = 10/5; pairing within container (cross-backend) and by round (cross-profile); median and IQR.
- **L489–L493:** on-chain changes exactly as in v2.

**Elsewhere:**

- **L243–244 (Table 2):** the "one run per configuration" and "three machines" cells.
- **L554:** "consistent with measurement noise in single runs".
- **L616 and L776:** the virtualization sentence is deleted, not replaced. Every measurement runs in a Linux VM under Docker Desktop; no virtualization or container-overhead claim is made.
- **L709 and the §6.1 execution-layer paragraph:** as in v2 (budget exhaustion is unlikely to recur).
- **Figure 5 and its caption:** the D-ratio heatmap is replaced by the observed-scaling figure (§8).
- **L763, threats to validity.** Add:
  - one host;
  - one microarchitecture;
  - heterogeneous cores with vCPU placement controlled by macOS;
  - the Linux VM layer;
  - the disclosed CPU-visibility adapter;
  - memory held constant (memory sensitivity not studied);
  - absolute times not transferable.

  Keep the v2 items: prove includes key loading; no causal domain attribution; counterbalanced layer order; zkUIT latency definition inferred from its committed script.
- **Circuit wording anywhere:** the narrow §1.1 claim only.
- **Captions and the top-of-file note:** "pre-correction circuit, one run per configuration".

**Quantities the rerun reports for each earlier interpretation (§3.5; described, not tested against thresholds):**

- the PLONK d = 10→11 ratio and plateau ratio against within-plateau variation, in each profile, with path vs in-memory key calls;
- plateau-end ratios against gate growth (+64 %, +29 %);
- the Groth16 depth trend and the d = 7→8 ratio, in each profile;
- the Groth16/PLONK gap (July: 21–57×), in each profile, from paired rounds;
- observed speedups of every stage from `cpu2` to `cpu4` and `cpu8`. These replace the July machine ratios, which are not carried over;
- verify first vs steady-state times, in each profile;
- the on-chain quantities, unchanged from v2.

## 10. Change log

### v3 corrections (2026-09-25; prover design unchanged)

1. **Pipeline total.** `stages_sum_ms` renamed `stage_sum_ms` and defined as a derived diagnostic (sum of the four stage metrics), not "total time". `wall_ms` defined as the end-to-end wall-clock latency of the complete pipeline. Any "Total" in the paper or Figure 5 is `wall_ms` unless another quantity is named and justified. Both are kept in the raw data.
2. **On-chain fee provenance** (schema only; O1–O9 not implemented). `fee_wei` replaced by `receipt_fee_wei` (+ `receipt_fee_source`), `computed_fee_wei`, `fee_difference_wei` and `fee_consistent`. The provider/library fee is not assumed equal to the computed fee on either network.
3. **Freeze.** Real-host pre-flight PASS after the Docker Desktop change (10 vCPUs, 15.60 GiB visible; Docker Desktop 4.92.0); infrastructure P1–P9 implemented in `bench/`; engineering dry run PASS (24/24). Prover protocol frozen.
4. **Implementation-consistent updates** (no redesign): file layout under `bench/` (§6); implemented raw schemas (§7.2); P7 uses circom 2.1.6 as WebAssembly for R1CS byte identity and witness equivalence for the wasm (§2); adapter path `/opt/zcorp/lib/cpu-visibility.js`; host VM threshold stated as ≥ 11 GiB visible (12 GiB configured); engineering dry run (§3.9).
5. **Operational hardening** (no change to the scientific design, metrics, profiles, repetitions or pairing): round-level resume with sessions, attempts and an append-only round ledger (§3.2.1); `session_id` and `round_attempt` added to the raw schemas, plus `round_ledger.csv` and `sessions.csv` (§7.2); resume test (§3.9); P9 enforced in `preflight` and `campaign` mode and exercised on the host (§2, §4.2); software environment freeze and author requirements (§4.2.1); P4 commits and tag `rerun-baseline-20260925` (§2).

### v2 → v3

1. **Experimental factor.** The heterogeneous machines D1/D2/D3 are replaced by the resource profiles `cpu2`/`cpu4`/`cpu8`: cpuset, workers matched, 8 GiB, no swap, no quota. They run on one Apple Silicon host in one pinned `linux/arm64` image. Fallback: `cpu1`/`cpu2`/`cpu4`. Profile sizes are not derived from core types.
2. **CPU-visibility adapter** added to the harness (§3.1). It aborts on disagreement, changes only `os.cpus()`, and was verified by controls (§4.3). A load-order rule was added so the recorded concurrency is that of the pool snarkjs uses.
3. **Structure.** A fresh container per (round, profile). Profiles in a position-balanced frozen schedule within each round, with the same configuration seed across the profiles of a round (§3.2). The campaign may be split only between complete rounds.
4. **Pairing.** Cross-backend comparisons within a container; cross-profile comparisons paired by round. Rounds 1–5 for both backends; Groth16 rounds 6–10 only for Groth16 depth analyses, per profile.
5. **Diagnostic** runs in every profile, rather than assuming the file-read share is independent of the allocation.
6. **Quantities.** Machine ratios are replaced by per-round speedups and doubling ratios. No stage is assumed to scale or not scale (§3.5, §3.6).
7. **Environment record.** §4 now holds the host/runtime metadata, the pre-flight results, the host-specific limitations, and the optional native and x86 checks (outside the factor, figures and tables). New blockers: P5 (VM memory, VM settings), P8 (packaging), P9 (laptop host conditions).
8. **Reproducibility claim narrowed** to the image, artifacts, profiles, seeds and procedure.
9. **Schema.** `<machine>` becomes `<profile>`. Added `environment/`, `prover/schedule.csv` and the container-level `rounds.csv` fields. Anti-mixing now also checks the image digest.

**Kept from v2 without change:**

- artifact provenance (§1; two contamination rows added);
- repetitions and pairing rules;
- seeded ordering;
- the zkey-loading diagnostic design;
- raw-row preservation;
- campaign IDs and anti-mixing;
- July provenance without a tag;
- the complete on-chain protocol (§5, O1–O9).

### v1 → v2 (for reference)

1. Per-depth provenance for both backends.
2. Decision thresholds replaced by descriptive quantities.
3. Unequal repetitions with paired rounds 1–5 for cross-backend comparisons.
4. Counterbalanced on-chain layer order.
5. Three latency metrics, with `request_to_receipt_ms` as the July/zkUIT definition.
6. `prove_ms` defined end-to-end, with the in-memory-key diagnostic.
7. July tag removed.
8. Narrow circuit wording.
