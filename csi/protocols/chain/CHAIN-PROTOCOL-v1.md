# CHAIN-PROTOCOL-v1: `CSI-CHAIN-LOCAL-01`, on-chain verification in local environments

| Field | Value |
|---|---|
| Campaign | `CSI-CHAIN-LOCAL-01` |
| Protocol version | v1 |
| Status | **L1 arm FROZEN** (this file, as committed). **Local-EraVM arm PENDING** (§14). |
| Frozen | 2026-09-25. The commit that adds this file is recorded in `campaign.json`. |
| Design basis | *CSI blockchain experiment design report* (2026-09-25), accepted with the author decisions of §1.2 |
| Supersedes | RERUN-PROTOCOL-v3 §5, the testnet 3 × 50 × 2 design, as the design for on-chain measurement. Its July data remain provenance only. |

---

## 0. Change control

- **Before the L1 scientific run starts,** this protocol may be amended only by a dated entry in §15 that states the reason.
- **After the L1 scientific run starts,** it may be changed only for a **documented material defect**. The defect is recorded in §15, every affected run is repeated, and both versions are kept.
- **Not evidence:** the engineering dry run (§10.7) and every earlier feasibility probe are engineering only.
- **Wording:** no statement in this protocol or in its outputs calls the circuit, the contracts or the artifact chain "sound" or "correct" in general.

## 1. Scope

### 1.1 What is measured

| Quantity | Measured? |
|---|---|
| Gas consumed (`gasUsed`) by deployment, setup and verification transactions on a local EVM | yes |
| Calldata and bytecode sizes | yes |
| Accept/reject behaviour | yes |
| Fees, gas prices, latency, inclusion | **no** |

- **Backends:** Groth16 and PLONK.
- **Gas price:** a local gas price is `bookkeeping_only`. The base fee is 0. No local ETH fee and no local latency is ever reported as a scientific output.
- **Network:** no external network is contacted during measurement.

### 1.2 Author decisions (2026-09-25), frozen

1. **Primary compile profile:** optimizer on, 200 runs, solc 0.8.20, explicit `evmVersion` (§4).
2. **July configuration:** optimizer off plus the `console.log`-instrumented manager. It appears **only** as one bridge cell (§6).
3. **New contracts:** under `contracts/chain/`. The historical `contracts/CredentialManager.sol` is not modified.
4. **Proofs:** K = 8 distinct valid proofs per backend and depth, generated outside `data/` and frozen by manifest (§3).
5. **Harness:** a separate `chainbench/` package and lockfile. The repository root Hardhat environment is not upgraded.
6. **Cross-client check:** one `geth --dev` replay is included (§11).
7. **No further backends:** no FFLONK or other proof backend.
8. **Public networks:** `CSI-CHAIN-PUBLIC-01` runs only after LOCAL-01 is validated, under whichever fork is then active. It is not governed by this protocol.
9. **Manuscript:** no RQ3 or other manuscript change is part of this campaign.

## 2. Contracts

### 2.1 Groth16 verifiers (unchanged)

- **Files:** `contracts/Groth16LegacyVerifierDepth{d}.sol`, manifest-covered in `ARTIFACTS.sha256`.
- **Provenance:** snarkjs 0.7.5 `verifier_groth16.sol.ejs` output for the corrected vkeys, with only the contract name changed.
- **Interface:** `verifyProof(uint[2], uint[2][2], uint[2], uint[1]) view returns (bool)`.

### 2.2 PLONK verifiers (generated)

- **Files:** `contracts/chain/PlonkVerifierDepth{d}.sol`, for d = 5…15.
- **Generator:** `chainbench/scripts/export_plonk_verifiers.js`, which calls `snarkjs.zKey.exportSolidityVerifier`, the official export, on the manifest-covered PLONK zkeys.
- **Only modification:** `contract PlonkVerifier {` becomes `contract PlonkVerifierDepth{d} {`.
- **Checks, per depth (recorded in `inputs/plonk-verifiers.provenance.json`):**
  1. the zkey sha256 equals `ARTIFACTS.sha256`;
  2. the vkey exported from the zkey equals the committed vkey;
  3. the snarkjs output equals `verifier_plonk.sol.ejs` rendered from the committed vkey;
  4. only the contract name differs from the snarkjs output;
  5. the written file re-reads identically.
- **Re-check:** `--check-only` re-verifies without writing.
- **Interface:** `verifyProof(uint256[24] _proof, uint256[1] _pubSignals) view returns (bool)`.

### 2.3 Managers (new, console-free)

**Files:**
- `contracts/chain/CredentialManagerBase.sol` (abstract, `Ownable`, OpenZeppelin 4.9.0);
- `contracts/chain/CredentialManagerGroth16.sol`;
- `contracts/chain/CredentialManagerPlonk.sol`.

**Kept from the historical `CredentialManager.sol`:**

| Element | Behaviour |
|---|---|
| Ownership | The owner is the deployer. |
| `setIssuer(address, bool)` | `onlyOwner`; `"CredentialManager: zero address"`; emits `IssuerSet` |
| `setVerifier(address)` | `onlyOwner`; zero-address check; emits `VerifierSet` |
| `addRoot(uint256)` | `onlyIssuer`, with `"CredentialManager: not issuer"`; emits `RootAdded` |
| Getters | `isIssuer`, `isValidRoot`, `issuers`, `validRoots`, `verifier` (an address) |
| `verifyCredential` | Requires a registered root (`"Invalid root"`), calls the verifier, requires `true` (`"Invalid proof"`), emits `CredentialVerified(root)` and returns `true` |
| Constructor | Sets the verifier without emitting an event |

**Signatures (backend-native):**
- Groth16: `verifyCredential(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[1] input)`, the same selector as the historical manager.
- PLONK: `verifyCredential(uint256[24] proof, uint256[1] input)`.

**Differences from the historical contract:**
- no `hardhat/console.sol`;
- the verifier is stored as an `address` and cast to the backend interface at call time;
- `verifyCredential` is `external`, with `calldata` parameters, for **both** backends;
- there is no generic `bytes` proof abstraction.

### 2.4 Historical contracts (bridge cell only, unchanged)

`contracts/CredentialManager.sol` (with `hardhat/console.sol`) and `contracts/IGroth16Verifier.sol`.

## 3. Proof set PS-01 (frozen inputs)

### 3.1 Leaf-index selection rule (fixed before any proof is generated)

- **Depths:** D = {5, 10, 11, 15}.
- **Rule:** for each depth d ∈ D and each j = 0…7, **i_j = (2j + 1) · 2^(d−4)**.
- **Properties:** the indices lie at the centres of 8 equal blocks of the 2^d leaves. The rule is data-independent, it gives the same indices for both backends, and it excludes index 0 (the committed proof).

| d | i_0 … i_7 |
|---|---|
| 5 | 2, 6, 10, 14, 18, 22, 26, 30 |
| 10 | 64, 192, 320, 448, 576, 704, 832, 960 |
| 11 | 128, 384, 640, 896, 1152, 1408, 1664, 1920 |
| 15 | 2048, 6144, 10240, 14336, 18432, 22528, 26624, 30720 |

### 3.2 Generation

Run `chainbench/scripts/gen_proofset.js`. For each (backend, d, j):

1. **Input.** `scripts/setup/generate_input_depth.js::generateInputForDepth(d, i_j)` reads `data/merkle-trees/…`.
2. **Witness.** Computed with the manifest-covered wasm.
3. **Proof.** `snarkjs.{groth16|plonk}.prove` with the manifest-covered zkey, using snarkjs 0.7.5 from the chainbench lockfile.
4. **Off-chain verification.** Against the committed vkey.
5. **Root check.** The public signal must equal the committed root for depth d (`data/{backend}-public-proof/public_depth_d_index_0.json`).

**Before generation:** every zkey, wasm, vkey and committed public file is checked against `ARTIFACTS.sha256`. The tree and processed-record files are not manifest-covered, so their sha256 values are recorded instead.

**Outputs:**
- proofs and public signals go **only** to `csi/campaigns/chain/CSI-CHAIN-LOCAL-01/inputs/proofset/{groth16|plonk}/d{d}/p{j}.{proof|public}.json`;
- circuit inputs, which contain synthetic credential fields, are **not** stored; their sha256 is recorded;
- witnesses go to process-local temporary storage.

### 3.3 Freeze

- **Manifest:** `inputs/proofset/PROOFSET.csv`, with one row per proof giving backend, depth, j, proof ID, leaf index, root, file sha256 values, input sha256, zkey and vkey sha256, the off-chain verification result and the generation environment; plus `PROOFSET.sha256` and `PROOFSET.json`.
- **No overwriting.** The generator refuses to write into an existing proof set.
- **No regeneration.** A frozen proof is never regenerated, including to obtain different gas values. Groth16 and PLONK proof randomness is accepted as generated.
- **No selection.** No proof is selected or discarded on calldata, gas or any other on-chain characteristic.
- **A failed proof is a defect.** A proof that fails off-chain verification or the root check stops generation (§15). It is not silently replaced.
- **Proof IDs:** `G16-d{d}-p{j}` and `PLK-d{d}-p{j}`.

## 4. Compile profiles

**Compiler:**
- solc **0.8.20**, the npm `solc@0.8.20` build (`soljson.js` sha256 `033dc42a16378dd036a475b8a7080af83cfae1841eb6848ce1667c56193972ba`, long version `0.8.20+commit.a1b79de6`);
- supplied to Hardhat through a `TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD` override;
- no compiler download.

| Profile | Settings | Sources (repository-relative) |
|---|---|---|
| `primary` | `optimizer {enabled: true, runs: 200}`, `evmVersion: "paris"`, default metadata (ipfs) | `contracts/chain/*.sol` (3 managers, 11 PLONK verifiers) and `contracts/Groth16LegacyVerifierDepth{5..15}.sol` |
| `bridge` | `optimizer {enabled: false, runs: 200}`, `evmVersion: "paris"`, default metadata. These are the July 2026 settings recorded in `artifacts/build-info`. | `contracts/CredentialManager.sol`, `contracts/IGroth16Verifier.sol`, `contracts/Groth16LegacyVerifierDepth11.sol`. `hardhat/console.sol` comes from chainbench's hardhat 2.29.1 (sha256 `5a6db75e…4e31dd`, identical to the repository root's hardhat 2.23.0 copy). |

**Staging.**
- Sources are copied byte for byte into a fresh per-run work directory, `chainbench/.work/<run_id>/stage/<profile>/` (§15, A2), keeping their repository-relative paths. That directory is the Hardhat project root, so the source names in the metadata are repository-relative (`contracts/…`). Library imports resolve to `chainbench/node_modules`.
- The bytecode includes the metadata hash, and deployment gas depends on its bytes. The staging layout is therefore part of the protocol.
- Each build writes `build_manifest.<profile>.json` (§8.3).

## 5. Environment `L1-EDR`

| Item | Value |
|---|---|
| Harness | `chainbench/`: own `package.json` and `package-lock.json`, installed with `npm ci` |
| Packages (exact) | hardhat **2.29.1** (EDR **0.12.0-next.23**), @nomicfoundation/hardhat-ethers 3.0.8, ethers 6.13.5, snarkjs 0.7.5, solc 0.8.20, @openzeppelin/contracts 4.9.0, ejs 3.1.10 |
| Runtime | Node as recorded per run (v22.23.2 on the campaign VM) |
| Host | Linux VM (Claude desktop app, Ubuntu 22.04, aarch64) on the campaign host (Apple M5). No container image is used; `environment.json` records the OS, kernel, Node, npm, the lockfile sha256, the EDR native-binary sha256 and the `soljson.js` sha256. |
| Chain | In-process Hardhat network (EDR; `web3_clientVersion` reports `HardhatNetwork/2.29.1/@nomicfoundation/edr/0.3.8`). **hardfork `osaka`**, chainId 31337, `initialBaseFeePerGas` 0, block gas limit 60,000,000, automine, `initialDate` 2026-01-01T00:00:00Z, `throwOnTransactionFailures: false`. |
| Accounts | From the mnemonic `test test test test test test test test test test test junk`, path `m/44'/60'/0'/0/{0,1}`: A0 is the owner/issuer and A1 the non-issuer. |
| Network | None. EDR runs in-process, and the runner opens no external connection. |

### 5.1 Hardfork verification (`chainbench/scripts/env_check.js`)

This must pass before any run is accepted. The result is recorded in `environment.json`.

| Check | Required under `osaka` | Required under the `prague` control |
|---|---|---|
| Hardhat and EDR accept the hardfork name | yes | yes |
| P256VERIFY precompile (0x100, EIP-7951) returns 1 for a valid P-256 signature | yes | returns empty |
| CLZ opcode (0x1e, EIP-7939) executes | yes | fails |
| A transaction with gas limit 2^24 + 1 is rejected (EIP-7825) | yes | accepted |

## 6. Matrix

**Primary cells** (profile `primary`, `L1-EDR`, Osaka): backend ∈ {Groth16, PLONK} × d ∈ {5, 10, 11, 15}, i.e. **8 cells**.

**Bridge cell:** Groth16, d = 11, profile `bridge`, with the historical `CredentialManager` and `Groth16LegacyVerifierDepth11` compiled under the July settings. It is **1 cell**.

**Plans:**

| Plan | Cells | Proofs per cell |
|---|---|---|
| `full` | the 8 primary cells and the bridge cell | K = 8 (p0…p7) |
| `dry` | Groth16 d5 and d11, PLONK d10 and d11, and the bridge cell | 2 (p0, p1) |

**No repetition.** No identical transaction is repeated for statistical purposes. The K proofs are distinct inputs.

## 7. Cell procedure

**Fresh chain per cell.** EDR uses `hardhat_reset`; geth starts a new in-memory `--dev` process. A0 and A1 start at nonce 0.

**Transactions.** Every transaction is a signed EIP-1559 (type 2) transaction produced by ethers 6.13.5 and sent with `eth_sendRawTransaction`, with a **fixed gas limit** per operation:

| Environment | `maxFeePerGas` | `maxPriorityFeePerGas` | Status |
|---|---|---|---|
| EDR | 0 | 0 | bookkeeping only |
| geth | 100 gwei | 1 gwei (§15, A1) | bookkeeping only |

**Calls.** `eth_call` operations consume no recorded gas.

**Operations, in this order.**
- d′ is the partner depth (§7.1) and R_d is the root of depth d.
- For the bridge cell, the manager is `CredentialManager`.

| # | op | kind | from → to | payload | gas limit | expected |
|---|---|---|---|---|---|---|
| 1 | `deploy_verifier` | tx | A0 → create | verifier initcode | 6,000,000 | success |
| 2 | `deploy_manager` | tx | A0 → create | manager initcode + `abi.encode(verifier)` | 6,000,000 | success |
| 3 | `set_issuer` | tx | A0 → manager | `setIssuer(A0, true)` | 300,000 | success |
| 4 | `add_root` | tx | A0 → manager | `addRoot(R_d)` | 300,000 | success |
| 5 | `precheck_call` | call | A0 → manager | `verifyCredential(p0)` | — | returns `true` |
| 6 | `verify_credential` × K | tx | A0 → manager | `verifyCredential(p_j)`, j ascending | 1,000,000 | success |
| 7 | `verify_proof_call` × K | call | A0 → verifier | `verifyProof(p_j)` | — | returns `true` |
| 8 | `verify_proof_direct` × K | tx | A0 → verifier | `verifyProof(p_j)`, j ascending | 1,000,000 | success |
| 9 | `neg_unknown_root` | tx | A0 → manager | `verifyCredential(p0 of d′)`; R_d′ is not registered | 3,000,000 | revert `"Invalid root"` |
| 10 | `neg_tampered_call` | call | A0 → verifier | `verifyProof(tamper(p0))` | — | returns `false` |
| 11 | `neg_tampered` | tx | A0 → manager | `verifyCredential(tamper(p0))` | 3,000,000 | revert `"Invalid proof"` |
| 12 | `neg_cross_depth_setup` | tx | A0 → manager | `addRoot(R_d′)` | 300,000 | success |
| 13 | `neg_cross_depth_call` | call | A0 → verifier | `verifyProof(p0 of d′)` | — | returns `false` |
| 14 | `neg_cross_depth` | tx | A0 → manager | `verifyCredential(p0 of d′)` | 3,000,000 | revert `"Invalid proof"` |
| 15 | `neg_non_issuer` | tx | A1 → manager | `addRoot(R_d)` | 300,000 | revert `"CredentialManager: not issuer"` |

### 7.1 Partner depth and tamper rule

- **Partner depth d′:** 5→10, 10→11, 11→15, 15→5. The partner proof has the same backend and index j = 0. For the bridge cell, d′ = 15.
- **Tamper rule:** replace the last word w of the proof vector (Groth16 `c[1]`, PLONK `proof[23]`) with w + 1 if w + 1 < m, and with w − 1 otherwise. For Groth16, m is the BN254 base field modulus q; for PLONK, m is the scalar field modulus r.

### 7.2 Negative-control gas

The `gasUsed` of the negative controls (#9, #11, #14, #15) is recorded but **not interpreted**. A failed precompile call consumes all the gas forwarded to it, so for some controls `gasUsed` depends on the fixed gas limit. The scientific content of these rows is the expected status and revert reason.

### 7.3 Revert reasons

After a reverted transaction, the same call (same from, to, data and gas) is replayed with `eth_call` at block `receipt.blockNumber − 1`. The returned `Error(string)` data is decoded and recorded.

## 8. Raw data

The raw data of one run is written to `build/campaigns/chain/<run_id>/`, which is git-ignored. The scientific run's raw data are archived into `csi/release/CSI-CHAIN-LOCAL-01/` (§13).

### 8.1 `local_l1_ops.csv` (one row per transaction or call)

| Group | Columns |
|---|---|
| Identification | `campaign_id`, `run_id`, `plan`, `env` (`L1-EDR`, `L1-geth`), `client_version`, `hardfork`, `chain_id`, `profile`, `cell_id`, `backend`, `depth`, `partner_depth`, `op_seq`, `op`, `kind` (`tx`, `call`), `proof_id`, `proof_j`, `leaf_index` |
| Accounts and target | `from_account` (`A0`, `A1`), `to_contract` (verifier, manager or empty), `contract_name`, `contract_address`, `nonce`, `gas_limit` |
| Expectations and outcome | `expected_status` (1, 0, `call`), `status`, `expected_revert`, `revert_reason`, `expected_return`, `return_value`, `check_pass` (1 or 0) |
| Gas | `gas_used`, `calldata_bytes`, `calldata_zero_bytes`, `calldata_tokens`, `calldata_gas_standard`, `floor_gas_7623`, `create_gas`, `intrinsic_gas`, `exec_gas_derived`, `floor_binding`, `code_deposit_gas` |
| Deployments | `initcode_bytes`, `runtime_bytes`, `runtime_keccak`, `runtime_matches_artifact` |
| Hashes and block | `calldata_sha256`, `tx_hash`, `block_number` |
| Bookkeeping | `gas_price_wei`, `gas_price_semantics` (= `bookkeeping_only`) |

### 8.2 Other files per run

| File | Contents |
|---|---|
| `run.json` | plan, env, `run_id`, commit, protocol sha256, proof-set manifest sha256, timestamps, row counts |
| `environment.json` | host, OS, Node, npm, package versions, lockfile and binary sha256 values, the env-check result; for geth, its binary sha256 and `web3_clientVersion` |
| `build_manifest.primary.json`, `build_manifest.bridge.json` | as in §8.3 |

### 8.3 Build manifest

- **Header:** the compiler, the settings and the staged files (repository path, sha256, git blob).
- **Per contract:** source name, init and runtime bytecode (hex, length, keccak256), the ABI sha256, and whether runtime ≤ 24,576 and initcode ≤ 49,152.

### 8.4 Allowed metadata differences

These are the only fields excluded from the identity checks:
- `run_id`;
- timestamps (`started_at_utc`, `finished_at_utc`, `at_utc`);
- host and process fields in `environment.json`.

The EDR vs geth comparison additionally excludes `env`, `client_version`, `chain_id`, `tx_hash`, `block_number` and `gas_price_wei`, because they legitimately differ between clients.

## 9. Derived quantities

These follow the Prague and later rules, unchanged in Osaka.

| Quantity | Formula |
|---|---|
| `calldata_tokens` | zero_bytes + 4 · nonzero_bytes |
| `calldata_gas_standard` | 4 · tokens (= 4 per zero byte + 16 per non-zero byte) |
| `floor_gas_7623` | 21,000 + 10 · tokens |
| `create_gas` | for deployments, 32,000 + 2 · ⌈initcode_bytes / 32⌉; otherwise 0 |
| `intrinsic_gas` | 21,000 + `calldata_gas_standard` + `create_gas` |
| `exec_gas_derived` | `gas_used` − `intrinsic_gas`. For a deployment it includes the constructor and the code deposit. |
| `floor_binding` | 1 if `gas_used` = `floor_gas_7623` |
| `code_deposit_gas` | 200 · `runtime_bytes` (deployments only) |

**Metrics reported per cell** in the scientific run:
- deployment gas (verifier and manager);
- setup gas (`set_issuer`, `add_root`);
- manager-level verification gas (min and max over K);
- direct verification gas (min and max over K);
- the derived components;
- the sizes.

Negative controls are summarised by status only.

## 10. Validation criteria

A run is **accepted** only if every item below holds.

1. **Build.**
   - Every contract compiles.
   - Every runtime is ≤ 24,576 B and every initcode ≤ 49,152 B.
   - The staged sources equal the committed files.
   - `export_plonk_verifiers.js --check-only` passes.
2. **Proof set.** The `PROOFSET.sha256` check passes, and every proof verifies off-chain.
3. **Rows.**
   - `check_pass = 1` on every row.
   - `runtime_matches_artifact = 1` on every deployment.
   - The row counts equal the plan.
4. **Hardfork.** `env_check` passes (§5.1).
5. **Determinism.** Two complete EDR runs from scratch are identical on every non-metadata field (§8.4). "From scratch" means:
   - `.stage`, `artifacts-*` and `cache-*` are removed;
   - sources are re-staged and recompiled;
   - each run is a new process;
   - each cell gets a fresh chain.

   "Identical" covers statuses, gas values, bytecode sizes and hashes, calldata sizes and the derived gas decomposition. Both build manifests must be identical as well. **Any difference is investigated before acceptance.**
6. **Cross-client.** The geth replay (§11) must match EDR run 1 on every transaction row (`status`, `gas_used`, `revert_reason`, contract addresses and runtime keccak) and on every call row (`return_value`). Its build manifests must also be identical. A difference is **not normalised**: it is diagnosed and reported, and the campaign is not accepted until the cause is understood and documented.
7. **Dry run** (engineering, before the scientific run): plan `dry`, items 1–6 including both EDR runs and the geth replay. The dry run is not evidence. The full scientific run requires a passed dry run.

## 11. Cross-client replay: `L1-geth`

**Client:**
- geth **v1.16.9**: tag `v1.16.9`, commit `95665d5703e1023995a0ff93e4ce9eb77e8a59bd`.
- Built from source with Go 1.24.7, `CGO_ENABLED=0`, `-trimpath -buildvcs=false -ldflags "-s -w"` (plus the version stamp), for linux/arm64 and linux/amd64.
- **Module integrity:** every downloaded module was verified by Go against geth's committed `go.sum`. The non-GitHub modules were served from a local file proxy built from their official GitHub mirrors, and each one's h1 hash was checked against `go.sum` before use.
- The binary sha256 is recorded in `environment.json`.
- **Build recipe:** `chainbench/geth/` (`build_geth.sh`, `mkproxy.py`, `SHA256SUMS`), with a fixed build directory, `/tmp/zcorp-geth-v1.16.9` (§15, A4).

**Rules:**
- `--dev` mode activates every fork through **Osaka** (`params.AllDevChainProtocolChanges`: `OsakaTime = 0`, no later fork).
- `env_check` (§5.1, the `osaka` column) must pass against geth.

**Procedure:**
- Plan and cells are the same as the reference EDR run.
- For each cell, start a new `geth --dev --dev.period 0 --dev.gaslimit 60000000 --rpc.txfeecap 0 --http` on 127.0.0.1 with in-memory state. `--rpc.txfeecap 0` disables geth's RPC-level fee cap, a node-local policy that is not an EVM rule, so that the EIP-7825 check in §5.1 exercises the protocol rule.
- The dev account funds A0 and A1 with 1,000 ETH each. This does not change A0's or A1's nonce.
- Then run the identical operation sequence, with the same keys, nonces, payloads and gas limits (§7).
- Contract addresses therefore equal EDR's.
- The chain ID is geth's dev chain ID, and the fee fields follow §7.
- The comparison follows §10 item 6.

## 12. Execution

From `chainbench/`:

1. `npm ci`
2. `node scripts/export_plonk_verifiers.js --check-only`
3. `node scripts/env_check.js --geth-bin <path>`: EDR under `osaka` plus the `prague` control, then geth. Each run repeats this and records the result in its `env_check.json`.
4. `npm test`: the unit tests (§12.1).
5. `node scripts/run_l1.js --plan <dry|full> --env edr --run-id <id> --step <init|build|envcheck|exec|finish>`, twice from scratch, as runs a and b. Each step is one invocation (§15, A3). `exec` processes the cells in plan order, each on a fresh chain, and resumes at the first cell not yet written.
6. The same steps with `--env geth --geth-bin <path> --reference <run a dir>`. The `build` step fails unless both build manifests are byte-identical to run a's.
7. `python3 scripts/compare_runs.py --mode determinism --a <run a> --b <run b>` and `--mode crossclient --a <run a> --b <geth run>`. The report goes to `compare.json`.
8. `python3 scripts/summarize_l1.py <run dir>`: the per-cell summary (§9).

**Rows per cell:** 4 setup transactions, 1 pre-check call, 3·K verification rows (K transactions, K calls and K direct transactions) and 7 negative-control rows (5 transactions, 2 calls). That is 18 rows per cell in `dry` (K = 2) and 36 in `full` (K = 8), so 90 and 324 rows respectively.

### 12.1 Unit tests (`chainbench/test/`, profile `primary`)

For both managers, the tests cover:
- a valid proof is accepted, with the event emitted and `true` returned;
- a tampered proof makes the verifier return false and the manager revert;
- an unknown root reverts;
- `addRoot` by a non-issuer reverts;
- a cross-depth proof is rejected even when its root is registered;
- the owner-only and zero-address guards.

## 13. Outputs and packaging (after the scientific run)

- **Raw data.** `build/campaigns/chain/<run_id>/` is archived as a tar with sha256 in `csi/release/CSI-CHAIN-LOCAL-01/`.
- **Derived outputs.** `csi/campaigns/chain/CSI-CHAIN-LOCAL-01/derived/`, produced by a committed deterministic script.
- **Campaign records.** `campaign.json` (IDs, commit, protocol sha256, manifests, outputs sha256), `SOURCE.sha256` and `VALIDATION.md`.
- **Registry.** A row in `csi/campaign-index.csv`.
- **Separation.** CSI-PROVER-01 is not modified.

## 14. Local-EraVM arm (PENDING, not executable under v1)

These fields are **pending**:

| Field | Status |
|---|---|
| EraVM protocol version | Awaiting a read-only `zks_getProtocolVersion` query on ZKsync Era Sepolia from the campaign host |
| anvil-zksync | v0.6.11, release-asset digests as in the design report; the configuration is not frozen |
| Fee parameters (L1 gas price, L2 gas price, pubdata price) | not frozen |
| zksolc and era-solc | pins and codegen not frozen |

The arm is activated only by a §15 amendment that fills these fields. No anvil-zksync scientific measurement may run before that.

## 15. Amendments

All of the following were made **before** the L1 scientific run and before the engineering dry run. None changes the matrix, the proof set, the compile profiles, the hardfork or any measured quantity. They are procedural, and they were found while the harness was being implemented.

| ID | Date | Section | Change | Reason |
|---|---|---|---|---|
| A1 | 2026-09-25 | §7 | The geth `maxPriorityFeePerGas` becomes 1 gwei (it was 0). | geth's transaction pool rejects tips below its minimum ("gas tip cap 0, minimum needed 1"). Fee fields are bookkeeping only; `gasUsed` does not depend on them, as the cross-client comparison verifies. |
| A2 | 2026-09-25 | §4 | Staging, artifacts and cache go into a fresh per-run directory, `chainbench/.work/<run_id>/`, instead of `chainbench/.stage/<profile>/`. | Every run is guaranteed to build from scratch, with no reuse or deletion of earlier builds. The source names in the metadata are unchanged (`contracts/…`). |
| A3 | 2026-09-25 | §12 | A run is executed in steps (`init`, `build`, `envcheck`, `exec`, `finish`), and `exec` can resume per cell. | The execution environment of the campaign VM ends every process of a shell call after about 3 minutes. Cells are independent and each uses a fresh chain, so resuming at a cell boundary does not change any transaction. |
| A4 | 2026-09-25 | §11 | The geth build recipe is committed at `chainbench/geth/`. It builds in a fixed directory, `/tmp/zcorp-geth-v1.16.9`, and the replay uses its output (sha256 in `SHA256SUMS`). | gnark-crypto's assembly include paths embed the absolute module-cache path in the binary despite `-trimpath`. Byte-identical rebuilds therefore need the same path; two from-scratch builds with the recipe gave identical binaries. |
| A5 | 2026-09-25 | §5, §11, §12 | **Environment packaging (procedural only; made after the engineering dry runs and before the scientific run).** The scientific L1 campaign runs through `./chainbench/run.sh full-local-l1` in the final packaged chainbench container environment, which replaces the host description of §5 ("Linux VM … No container image is used") and the geth client of §11: (1) a digest-pinned Docker environment: base image `node:22.23.2-bookworm-slim` @ `sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9` (Debian 12, Node v22.23.2, glibc 2.36), pins in `chainbench/docker/pins.env`, the image's toolchain identity in `chainbench/docker/IMAGE.json`, and the exact image that the campaign uses archived with `docker save` (its identity and sha256 in `chainbench/docker/ARCHIVE.json`; `full-local-l1` refuses any other image on that platform); (2) the repository is mounted read-only, each run uses a fresh container and a fresh tmpfs work directory, and only the output roots are writable; (3) `--network none`: no interface except loopback is up and there is no route, checked by the pre-flight doctor and recorded in every run's `environment.json`; (4) the npm dependencies are installed with `npm ci` from the unchanged `chainbench/package-lock.json` at image build (sha256 `0add12b8…68cd`), which replaces §12 step 1; (5) the primary cross-client implementation is the official geth v1.16.9 image `ethereum/client-go:v1.16.9` @ `sha256:2dd7ef210a1a3fb87887676f7ead1b98161af83810928cdf6fc5b84bcdcc8ef4`, accepted only because `geth version` reports Git Commit `95665d5703e1023995a0ff93e4ce9eb77e8a59bd` (Go 1.24.13; binary sha256 `a437c0a5…8f84`); the reproducible from-source build of A4 (Go 1.24.7, `SHA256SUMS`) is retained only as a fallback; (6) the §12 scientific procedure and every measurement definition are unchanged: the pre-flight checks (steps 2 and 3), the unit tests (step 4), EDR runs a and b from scratch and the geth replay with one runner invocation per step (steps 5 and 6, A3), the comparisons (step 7) and the summary (step 8); the matrix, proof set, contracts, compile profiles, hardfork, operation sequence, gas limits, raw schema, derived quantities and validation criteria (§6–§10) are unchanged. | Reviewer reproducibility, with Docker as the only prerequisite, in the same environment as the scientific run. This amendment packages the environment; it changes no measured quantity. The final packaged engineering dry run `dry-fbe3794-20260925T112745Z` (commit `fbe3794`) reproduced the accepted readiness dry run `e141816` on every scientific field: EDR runs a and b against the readiness runs, 4500/4500 field comparisons each, with byte-identical build manifests; the geth replay against the readiness replay, 3960/3960 under the §8.4 cross-client exclusions; unit tests 12/12, all Osaka markers, and all negative controls as expected. The geth-to-geth differences are only `client_version` (Go version), and `block_number` / `gas_price_wei` in the first cell, which also vary between two runs of the same geth binary. |
