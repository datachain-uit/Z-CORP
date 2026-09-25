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

### 15.1 Amendments after the L1 scientific run

The L1 arm is complete (campaign `full-71a5854-20260925T115726Z`, baseline tag `chain-l1-baseline-20260925`, validated). The amendments below were made after it, through the route that §14 prescribes. They apply only to the local-EraVM arm. They change nothing in §1–§13, in the L1 matrix, data or records, and the text above this subsection is unchanged: the protocol at the L1 campaign commit is a byte prefix of this file, which `scripts/release/build_csi_bundle.py` checks.

| ID | Date | Section | Change | Reason |
|---|---|---|---|---|
| A6 | 2026-09-25 | §14, §16 | **Activates the local-EraVM arm (L2)** and fills every field that §14 left pending, as specified in §16: the observed live version (Era Sepolia, minor version 29) and the selected local version (29), compatibility class **B (bounded)**; anvil-zksync 0.6.11 with its built-in v29 system contracts; zksolc 1.5.15 with era-solc 0.8.20-1.0.2 (optimizer mode `3`, size fallback, codegen `yul`); the fixed local fee input (base fee 45,250,000 wei, gas per pubdata 84), which the node itself imposes; the matrix, operation sequence, transaction fields, raw schema, derived quantity, validation and acceptance criteria, and limitations. Two departures from the design report: (1) the direct verifier transactions are kept, so each cell runs the whole §7 sequence (25 transactions and 11 calls); (2) the node's price options are not used, because without a fork they do not reach the executed fee model. | §14 requires an amendment before any anvil-zksync measurement. The values were fixed after the read-only live observation (2026-09-25T12:11:16Z) and after the packaged reduced dry run `dry-l2-3e0f6c8-20260925T125852Z` (runs a and b from scratch identical on all 3,960 field values; smoke runs on linux/arm64 and, emulated, linux/amd64 equal to the smoke reference on every compared field). No scientific L2 run preceded this amendment. |

## 16. Local-EraVM arm (L2), frozen by A6

Harness: `chainbench/adapters/eravm/` (a thin adapter; the workload `zcorp` is reused unchanged). Binding: `chainbench/workloads/zcorp/campaigns/CSI-CHAIN-LOCAL-01-L2.json`. Records: `csi/campaigns/chain/CSI-CHAIN-LOCAL-01/l2/`.

### 16.1 Live observation and compatibility class

- **Observation.** `l2/observation/20260925T121116Z/`: 12 read-only JSON-RPC calls to `https://sepolia.era.zksync.dev` (official ZKsync Era Sepolia RPC) from the campaign Mac, 2026-09-25T12:11:16Z to 12:11:25Z, with `chainbench/adapters/eravm/observe-public.sh`. No transaction, key or account. Raw answers and their sha256 values are committed.
- **Live:** chain 300; `zks_getProtocolVersion` minor version **29** (activated 2025-09-08T11:47:27Z); bootloader `0x01000911…51e6`, default AA `0x010005f73e7c…0252`, EVM emulator `0x01000d8bae37…cd63`; upgrade transaction `0xa1ff3e02…e4ce`. At block 8,561,516: base fee 25,000,000 wei, fair pubdata price 1,911,153,947 wei, i.e. 77 gas per pubdata byte.
- **Local:** anvil-zksync 0.6.11 supports protocol versions up to 29 (30 is rejected). Selected: **29**, with the built-in v29 system contracts (bootloader `0x0100092f045c41c21bd08a9c6fa909fa6a8b446e3f6cd9f08356352a3195a40c`, default AA `0x010005f74935e95e527d18ea9bfc82906fb20903a5683c528ee7af404e9bd531`, no EVM emulator).
- **Class B (bounded).** It is the same minor version with different bootloader and default-account code and no EVM emulator; all contracts and operations of the matrix run. Every L2 result carries the label: *EraVM execution under protocol v29 (anvil-zksync 0.6.11 built-in v29 system contracts; bootloader and default-account hashes differ from live Era Sepolia; no EVM emulator; fixed local fee input)*. It is never presented as a reproduction of the live network. Details: `l2/observation/CLASSIFICATION.md`.

### 16.2 Environment `L2-EraVM`

| Item | Value |
|---|---|
| Image | `chainbench-l2`, built only by `./chainbench/run.sh build-image-l2` from `chainbench/adapters/eravm/Dockerfile`. Base `node:22.23.2-bookworm-slim` @ `sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9` (the L1 base). npm dependencies by `npm ci` from `adapters/eravm/package-lock.json` (sha256 `2987f02e0807e9b354a1d90742bac4b71a565e43a478d1fbaf247ec6174f7f81`): ethers 6.13.5, zksync-ethers 6.21.2, snarkjs 0.7.5 (ffjavascript 0.3.1), @openzeppelin/contracts 4.9.0. The L1 lockfile and image are not used. |
| Binaries | Official GitHub release assets, accepted only if their sha256 equals `adapters/eravm/pins.env`. anvil-zksync **0.6.11**: tarball arm64 `f7d85fd2…a7285`, amd64 `127f1a75…8728`; binary arm64 `565ea541…8216`, amd64 `4a801b25…228b`. zksolc **1.5.15** (LLVM build `fa0fc0bc…`): arm64 `ee4f02f8…8b44`, amd64 `b52df6ae…1b4b`. era-solc **0.8.20-1.0.2** (`0.8.20+commit.3b523ea3`): arm64 `d98d1068…50b2`, amd64 `9516f4ee…8756`. |
| Frozen image | Identity: `adapters/eravm/IMAGE.json` (linux/arm64). Archive: `adapters/eravm/ARCHIVE.json`, image `sha256:255d0dacac2629988c339d311630e3efa99b6153478378570a63ad1b9a7491cc`, `docker save` archive `chainbench-l2-arm64.oci.tar`, 205,223,936 bytes, sha256 `8790cf4d90c8380aa348c76b7feeacd973f2a99169c719a2b8288fb2421db2e5`. `full-local-l2` refuses any other image on linux/arm64. |
| Container | A fresh container per run; the repository read-only; a tmpfs work directory; writable output roots only; `--network none`, checked and recorded. No public RPC, no private key, no test ETH. |
| Node | A fresh anvil-zksync process per cell: `--offline --timestamp 1000 --protocol-version 29 --dev-system-contracts built-in --enforce-bytecode-compression false --host 127.0.0.1 --port 18011 --cache none --chain-id 260 -m "test test … junk" -a 2 --balance 10000 --show-gas-details none --show-vm-details none --show-storage-logs none --log info --log-file-path <cell>/anvil.log run`, with `RUST_LOG=zksync_multivm::versions::vm_latest::utils::refund=trace`. Auto-mining; each transaction is sealed in its own block and batch. Accounts A0 and A1 as in §5. |
| Fee input | Fixed by the binary: without a fork, anvil-zksync 0.6.11 builds its fee model from built-in defaults (FeeModelConfigV2: minimal L2 gas price 45,250,000; compute overhead 0; pubdata overhead 1; batch overhead 800,000 L1 gas; max 200,000,000 gas and 500,000 pubdata bytes per batch; L1 gas price 2,365,348,956; L1 pubdata price 1). The executed batch input is therefore fair L2 gas price **45,250,000**, fair pubdata price **3,784,558,330**, base fee **45,250,000** and **84** gas per pubdata byte. `--l1-gas-price`, `--l2-gas-price` and `--l1-pubdata-price` change only the start-up banner, so they are not used. The API values (`eth_gasPrice` 45,250,000; `zks_gasPerPubdata` 168 and the block-detail prices, scaled by the estimation factor 2) are recorded and never used as inputs. |
| Environment check | Before a run's cells: binary sha256 values equal the pins; anvil-zksync version; chain id 260; `zkSync/v2.0`; block 0 reports `Version29` and the two base-system-contract hashes above, no EVM emulator; genesis timestamp 1000; balances; API values; network isolation; and a fee-accounting probe, where one 0-value self-transfer must reproduce its receipt `gasUsed` from its fee record (§16.6). |

### 16.3 Compilation

- zksolc standard JSON, invoked as `zksolc --standard-json <input> --solc <era-solc>`, in a fresh work directory per run. Settings: `optimizer {enabled: true, mode: "3", fallback_to_optimizing_for_size: true}`, `codegen: "yul"`, `evmVersion: "paris"`; output ABI, method identifiers and metadata (the EraVM bytecode is always emitted).
- Sources: the 25 files of the §4 `primary` profile (3 managers, 11 PLONK and 11 Groth16 verifiers), read from the repository, with `@openzeppelin/contracts` 4.9.0 imports. This gives 24 deployable contracts (the abstract base has no bytecode), all within the EraVM bytecode limit (2^16 − 1 words).
- Each run writes `build_manifest.eravm.json`: compiler versions and binary sha256 values, settings, source sha256 values and equality with `HEAD`, input and output sha256, and, per contract, bytecode size, words, sha256 and versioned bytecode hash. Two runs must give byte-identical manifests. In the packaged dry run the compiler output (sha256 `04aba3ac…15db`) was identical on the arm64 and the amd64 compilers.

### 16.4 Matrix and cell procedure

- **Cells (`full`):** backend ∈ {Groth16, PLONK} × d ∈ {5, 10, 11, 15}: **8 primary cells**, each on a fresh node. There is no bridge cell on EraVM.
- **Proofs:** K = 8 per cell (p0…p7) from the frozen proof set PS-01 (§3), with calldata built as in §7. The partner depth and the tamper rule are those of §7.1. Nothing is regenerated.
- **Sequence:** exactly the §7 sequence per cell: `deploy_verifier`, `deploy_manager` (verifier address as constructor argument), `set_issuer`, `add_root` p0, `precheck_call`, K × `verify_credential`, K × `verify_proof_call`, K × `verify_proof_direct`, `neg_unknown_root`, `neg_tampered_call`, `neg_tampered`, `neg_cross_depth_setup`, `neg_cross_depth_call`, `neg_cross_depth`, `neg_non_issuer` (from A1). Per cell that is 36 rows (25 transactions, 11 calls); `full` has 288 rows and 200 transactions.
- **Transactions:** EIP-712 (type 113), signed locally and sent raw. value 0; nonces from 0 per account and cell; `maxFeePerGas` = `maxPriorityFeePerGas` = 45,250,000 wei; `gasPerPubdataByteLimit` 50,000; no paymaster. A deployment calls `ContractDeployer.create(0, bytecodeHash, constructorArgs)` with the bytecode as its only factory dependency. There is no gas estimation. Gas limits: deployments 20,000,000; `set_issuer`, `add_root`, `neg_cross_depth_setup`, `neg_non_issuer` 2,000,000; verifications and the other negatives 10,000,000.
- **Calls:** `eth_call` at `latest` from A0.
- **Non-scientific plans:** `smoke` (Groth16 d5, PLONK d10; p0) and `dry` (Groth16 d5 and d11, PLONK d10 and d11; p0, p1).

### 16.5 Raw data

- `local_l2_ops.csv`: one row per transaction or call, 56 columns (`adapters/eravm/lib/schema.js`). Per transaction:
  - `status` and `gas_used` from the receipt;
  - `revert_reason`, decoded from the output of `debug_traceTransaction` (callTracer);
  - `return_value` of `verify_credential` and `verify_proof_direct`, decoded from the frame in which the account calls the target (a direct verifier transaction counts only if it returns `true`);
  - `computational_gas`, `pubdata_bytes`, `pubdata_gas` and `fee_trace_gas_limit`, from the node's own fee record for that transaction hash (the four TRACE lines of zksync-era multivm `compute_refund` in `nodes/<cell>/anvil.log`; exactly one record per transaction, anything else fails);
  - `gas_per_pubdata` = `pubdata_gas` / `pubdata_bytes`;
  - `gas_used_derived` and `accounting_ok` (§16.6);
  - calldata size and sha256, raw transaction size, factory dependencies, bytecode size and versioned hash, and whether `eth_getCode` equals the compiled bytecode;
  - hash, block, batch, timestamp, effective gas price.
- `computational_gas` is the EraVM gas the bootloader charges for computation: gas limit − bootloader refund − pubdata charge. It includes intrinsic, validation, bytecode-preparation and execution gas. `pubdata_bytes` is the growth of the VM pubdata counter during the transaction: state diffs, L2-to-L1 messages and published (compressed) bytecode.
- Per run: `run.json`, `environment.json`, `env_check.json`, `build_manifest.eravm.json`, `cells/<cell>.json` and `nodes/<cell>/anvil.{log,stdout}`. Scientific runs write to `build/campaigns/chain-l2/`; smoke and dry runs write to `build/chainbench/l2/`.

### 16.6 Derived quantity, validation and acceptance

- **Derived `gasUsed`** (the bootloader's refund rule, vm_latest `compute_refund`): `gas_used_derived = gas_limit − ceil((gas_limit·B − (computational_gas·F_l2 + pubdata_bytes·min(B·84, F_pd))) / B)` with B = F_l2 = 45,250,000 and F_pd = 3,784,558,330. `accounting_ok = 1` iff the node's fee record exists exactly once, its gas limit equals the sent one, `pubdata_gas = 84 · pubdata_bytes`, the effective gas price equals B, and `gas_used_derived` equals the receipt `gasUsed`. Receipt `gasUsed` is reported only as this derived value under the stated local fee input.
- **Validation** (`adapters/eravm/scripts/validate_l2.py`, recomputed from the raw files):
  - V1 the header equals the schema;
  - V2 row and transaction counts;
  - V3–V4 cells in plan order, each with the §16.4 sequence;
  - V5 every expected status, revert reason (`Invalid root`, `Invalid proof`, `CredentialManager: not issuer`) and return value;
  - V6 frozen transaction fields, chain id and protocol version;
  - V7 fee accounting, recomputed;
  - V8 deployed bytecode equals the compiled artifact (size, versioned hash, one factory dependency);
  - V9 EraVM size limit;
  - V10 a fresh chain per cell (nonces from 0, increasing blocks, distinct hashes);
  - V11 binaries equal the pins;
  - V12 environment check passed;
  - V13 base system contracts equal the v29 built-ins.
- **Acceptance of the scientific L2 result:**
  1. The pre-flight `doctor-l2` passes with `--require-clean --require-baseline --require-archived-image`: clean tracked paths; an annotated tag `chain-l2-baseline-*` whose measurement paths equal `HEAD`; the archived image.
  2. Two runs, a and b, each from scratch in a fresh container, are accepted by the runner and pass V1–V13.
  3. They are identical on every raw field except `run_id`, with byte-identical build manifests and identical environment-check probes (`adapters/eravm/scripts/compare_l2.py`). Differences are reported, never normalised.
  4. The post-flight `doctor-l2` passes.

  The commit semantics are those of the binding (`measurement_code_commit`, `baseline_commit`). There is no second EraVM implementation, so there is no cross-client replay.
- **Portability (not data).** `smoke-l2` on linux/amd64 (emulated) must equal `chainbench/workloads/zcorp/smoke-reference-l2.csv` on the 17 compared fields.

### 16.7 Execution

`./chainbench/run.sh full-local-l2` runs, in order: pre-flight, run a, validation, run b, validation, determinism comparison, the per-cell summary (`summary.csv`, EraVM units, with the compile-size table for all 11 depths), and post-flight. For reviewers: `doctor-l2`, then `smoke-l2`, then `full-local-l2`. Docker is the only prerequisite.

### 16.8 What L2 results may and may not state

- **May:** success or revert on EraVM; EraVM computational gas and pubdata bytes per operation under the §16.1 label; EraVM bytecode size; the configured gas per pubdata (84) and fee input; receipt `gasUsed` only as the derived value under that local input.
- **May not:** actual L1 publication cost; any live network fee; the live `gasPerPubdata`; latency or finality; batch or proving cost; behaviour under protocol versions other than 29 or under the live bootloader; anything about ZKsync OS chains.
- **Units:** EraVM gas and EVM gas are different units. No L2 value is compared numerically with an L1 value of §8–§9, and L2 data are never pooled with L1 data.

### 16.9 Amendments to the local-EraVM arm after A6

Logged here, appended, so that every earlier byte of this file (including §15.1) is unchanged. Made before the L2 scientific run.

| ID | Date | Section | Change | Reason |
|---|---|---|---|---|
| A7 | 2026-09-25 | §16 | **Administrative only.** It changes nothing in the design, matrix, environment, image, fee input, measurement definitions, validation or acceptance of §16. (1) *Evidence identity:* the L2 arm is registered in `csi/campaign-index.csv` as **`CSI-CHAIN-LOCAL-01-L2`**, the local-EraVM arm of CSI-CHAIN-LOCAL-01, with its own baseline tag `chain-l2-baseline-20260925`, image archive, raw data, derived results and code manifest; the L1 entry `CSI-CHAIN-LOCAL-01` is unchanged. Raw rows keep `campaign_id` = CSI-CHAIN-LOCAL-01 (the study) and `arm` = L2-EraVM. (2) *Records:* moved unchanged from `csi/campaigns/chain/CSI-CHAIN-LOCAL-01/l2/` to `csi/campaigns/chain/CSI-CHAIN-LOCAL-01-L2/`; the `l2/…` paths of §16 are read as that directory. The accepted scientific campaign is moved byte-identically to `results/chain-local-l2-20260925/`, frozen by the entry's `SOURCE.sha256`. (3) *Image:* the archived image of §16.2 is kept, not rebuilt, in `csi/release/CSI-CHAIN-LOCAL-01-L2/image/` (not versioned; sha256 `8790cf4d…e2e5`), with `IMAGE-ARCHIVE.json` (`scripts/release/chain_image_record_l2.py`: archive sha256, image id, platform, base image, and the sha256 of the anvil-zksync, zksolc and era-solc binaries read from the archived layers). `full-local-l2` refuses any image other than the archived one. (4) *Pre-registered derivation:* `scripts/analysis/derive_chain_l2.py`, fixed before the scientific run and tested only on the readiness dry run. It re-checks §16.6 (V1–V13, determinism of runs a and b, identities of campaign, commit, tag, image, protocol and PS-01, pre- and post-flight) and derives from run a, in EraVM units only: per cell and operation the computational gas, pubdata bytes and derived `gasUsed` (verifier and manager deployment, `setIssuer`, `addRoot`, manager-level and direct verification); the manager overhead (manager-level − direct, same proof); ranges over backend, depth and proof; EraVM bytecode sizes; the compile-size table of §16.7; descriptive PLONK/Groth16 ratios within EraVM units; and `values.tex`. Negatives are summarised by status only (§7.2). It produces no EVM comparison, no fee or ETH value, no L1 publication cost, and no latency or finality. | Author instruction of 2026-09-25: the L2 evidence must have a distinct identity so that its baseline, image, raw data and derived results cannot be confused with the completed L1 arm, and its analysis must be fixed before its data exist. |
