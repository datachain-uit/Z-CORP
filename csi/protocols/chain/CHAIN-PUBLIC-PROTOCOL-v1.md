# CHAIN-PUBLIC-PROTOCOL-v1 — CSI-CHAIN-PUBLIC-01: dated public-network case study (Ethereum Sepolia, ZKsync Era Sepolia)

**Status: planned (draft for freeze).** This protocol is frozen, together with the author inputs of section 17, by the
commit of the annotated public baseline tag (`chain-public-baseline-*`), which is created before the first public
transaction. Later changes are appended to section 18 as amendments; the text frozen at the tag is never edited.
Campaign binding: `chainbench/workloads/zcorp/campaigns/CSI-CHAIN-PUBLIC-01.json`. Adapter: `chainbench/adapters/public/`.

## 1. Purpose and claim boundary

CSI-CHAIN-PUBLIC-01 is a small, dated case study on two public test networks. It is **not** the controlled cost
experiment: controlled results come only from CSI-CHAIN-LOCAL-01 (local L1, `chain-l1-baseline-20260925`) and
CSI-CHAIN-LOCAL-01-L2 (local EraVM, `chain-l2-baseline-20260925`), which this study does not change, rerun or recalibrate.

1.1 The study records only what the controlled local environments cannot establish:
- actual deployability of the frozen artifacts on Ethereum Sepolia and ZKsync Era Sepolia (deployment confirmed and the
  deployed code equal to the artifact);
- the actual observed transaction price and paid fee on the session dates;
- request→hash and hash→receipt behaviour through the named RPC endpoints;
- the actual public-network `gasUsed`, as a dated observation;
- the RPC and client failures that actually occurred;
- for Era, post-hoc L1 batch commit, prove and execute information where the endpoint provides it.

1.2 The study is not used to infer, and its results are never presented as evidence of:
- general network latency (three sessions, one endpoint per network, sequential single-account transactions);
- mainnet economics (test ether has no price; no fiat or mainnet conversion is made);
- network reliability (the sample is far too small, and failures of the author's client or endpoint are not network
  failures);
- statistical superiority of a backend or a network (no significance test is made);
- EVM-vs-EraVM gas equivalence (EVM gas and EraVM gas are different units; no ratio across the two VMs is computed);
- causal backend latency differences (receipt latency is dominated by block production and inclusion).

1.3 Wording. Results are "dated observations on <network> through <provider label> on <dates>". Receipt latency is
never called finality; Era batch execution times are reported separately (section 10).

## 2. Artifact identity (frozen inputs)

2.1 Depth d = 11. Contracts: `Groth16LegacyVerifierDepth11` with `CredentialManagerGroth16`, and `PlonkVerifierDepth11` with
`CredentialManagerPlonk` (the corrected verifiers and backend-specific managers of the controlled study).

2.2 Frozen inputs, `csi/campaigns/chain/CSI-CHAIN-PUBLIC-01/inputs/`, generated once by
`chainbench/adapters/public/scripts/build_public_inputs.js` (deterministic; `--check` regenerates them byte for byte):
- `deployment/evm/*.json`: init and runtime bytecode byte-for-byte from the frozen L1 build manifest of the accepted L1
  campaign (`full-71a5854-20260925T115726Z`, both EDR runs identical; solc 0.8.20+commit.a1b79de6, optimizer on, 200 runs,
  evmVersion paris), with keccak-256 and sha256 of both, the ABI and the source sha256;
- `deployment/eravm/*.json`: bytecode recompiled with the pinned zksolc 1.5.15 and era-solc 0.8.20-1.0.2 and the frozen
  settings of the L2 arm; the standard-JSON input and output digests equal the frozen L2 build manifest, and so do every
  bytecode sha256 and EraVM bytecode hash;
- `proofs/d11.json`: PS-01 proofs `G16-d11-p0`, `G16-d11-p1`, `PLK-d11-p0`, `PLK-d11-p1` (proof and public-input sha256), the
  root, the `verifyCredential` calldata of each proof and the `addRoot` calldata, each equal (sha256) to the controlled L1
  and L2 raw rows;
- `IDENTITY.json` (43 identity checks, all pass) and `INPUTS.sha256` (verified on every load by the runner).

2.3 ABIs keep the compiler's order; sha256(JSON of the ABI) equals the ABI digest of both frozen manifests. Reviewers
check all of this without compilers or keys: `./chainbench/run.sh check-public-inputs` (27 checks).

2.4 Before deployment the runner verifies the inputs; after each deployment it reads `eth_getCode` and compares it with
the artifact (EVM runtime bytecode; EraVM bytecode). A deployment whose code differs is recorded and is not used by any
later operation. After setup, read-only calls check `verifier()`, `owner()`, `isIssuer(signer)` and `isValidRoot(root)`.

2.5 No July 2026 deployment, no zkUIT deployment and no earlier public result is reused or mixed into this entry.

## 3. Networks and endpoints

| Network | Chain id | Transactions | Native unit |
|---|---|---|---|
| Ethereum Sepolia (`sepolia`) | 11155111 | EIP-1559, type 2 | Sepolia ETH (test ether, no monetary value) |
| ZKsync Era Sepolia (`era-sepolia`) | 300 | EIP-712, type 113 (deployments carry the bytecode as a factory dependency) | Era Sepolia ETH (test ether, no monetary value) |

3.1 One endpoint per network is used for setup and all three sessions (author input, section 17). Endpoints are given by
environment variables, must be `https`, and are identified in the records by a provider label, the host and the sha256 of
the URL (a provider URL may contain an API key); a URL is recorded in full only if the binding lists it as public. A
change of endpoint after setup is a deviation (section 18).

3.3 Provider and fallback policy. The binding freezes, per network, the primary endpoint (`endpoints.frozen`: provider
label, host, URL sha256; the URL itself only if it is public) and, optionally, a validated secondary endpoint
(`endpoints.secondary`) that passed a read-only compatibility check of every JSON-RPC method the runner and the finality
collector use (tools/rpc_compat_public.js; no key, no transaction). Setup and S1–S3 use the primary. The secondary is a
fallback only: it may be used only after a documented operational failure of the primary, recorded as a deviation
(section 18) before it is used and named by `CHAINBENCH_PUBLIC_DEVIATION`; never because another provider appears cheaper
or faster. There is no automatic fail-over and no duplicate transaction through two providers; the provider is not an
experimental factor and providers are not compared. The live runner and the finality collector refuse any other endpoint,
the secondary without a deviation id, and a label other than the frozen one for a frozen URL; every row carries the label,
host and URL sha256 of the endpoint actually used, so a provider change is visible in each affected row.

3.2 The endpoint's `eth_chainId` must equal the profile's chain id before anything is signed. Always refused: Ethereum
mainnet (1), ZKsync Era mainnet (324), local/dev chains (31337, 1337, 260, 270, 271, 272), the other public network's id
(cross-network), and any other id. Live mode refuses loopback and non-https endpoints; the dry run refuses anything but
`http://127.0.0.1:<port>`.

## 4. Matrix: 40 transactions

4.1 Setup, 16 transactions (2 networks × 2 backends × 4 operations), once, before session 1; the deployments are reused by
all sessions:

| Operation | What | Calldata |
|---|---|---|
| `deploy_verifier` | verifier contract | EVM: frozen init code. Era: `ContractDeployer.create(0, bytecodeHash, "")` with the bytecode as factory dependency |
| `deploy_manager` | backend-specific manager | init code (or `create`) + ABI-encoded verifier address |
| `set_issuer` | `setIssuer(signer, true)` | encoded with the public signer address |
| `add_root` | `addRoot(root)` | frozen (equal to the controlled study) |

Order per network: Groth16 then PLONK, each in the order above (`SETUP-SEP-01..08`, `SETUP-ERA-01..08`).

4.2 Verification, 24 transactions: 3 sessions × 2 networks × 2 backends × 2 frozen proofs, each a manager-level
`verifyCredential` transaction with the frozen calldata (the application path of the controlled study; the manager
has no replay protection, so a proof can be verified in every session). The manager-level operation is the only
verification operation on the public networks; direct `verifyProof` transactions are not repeated there.

4.3 Frozen proof IDs (PS-01, depth 11): `G16-d11-p0`, `G16-d11-p1`, `PLK-d11-p0`, `PLK-d11-p1` — proofs j = 0 and j = 1 of
each backend, fixed by index before any public run (the default of this protocol), never by gas. No proof is generated.

4.4 Schedule rule. Within each session and network block the backends alternate; which backend goes first and the order of
each backend's two proofs come from the first byte of sha256(`CSI-CHAIN-PUBLIC-01/CHAIN-PUBLIC-PROTOCOL-v1|<session>|<network>`)
(bit 0: first backend, 0 = Groth16; bit 1: Groth16 proof order; bit 2: PLONK proof order). Network order alternates across
sessions (S1 Sepolia first, S2 Era first, S3 Sepolia first). The frozen schedule (`chainbench/adapters/public/lib/plan.js`):

| Session | Block (in order) | Transactions in order | Seed byte |
|---|---|---|---|
| S1 | Sepolia | S1-SEP-1 PLK-d11-p0 → S1-SEP-2 G16-d11-p1 → S1-SEP-3 PLK-d11-p1 → S1-SEP-4 G16-d11-p0 | 0x93 |
| S1 | Era Sepolia | S1-ERA-1 PLK-d11-p0 → S1-ERA-2 G16-d11-p0 → S1-ERA-3 PLK-d11-p1 → S1-ERA-4 G16-d11-p1 | 0xd1 |
| S2 | Era Sepolia | S2-ERA-1 G16-d11-p1 → S2-ERA-2 PLK-d11-p0 → S2-ERA-3 G16-d11-p0 → S2-ERA-4 PLK-d11-p1 | 0x7a |
| S2 | Sepolia | S2-SEP-1 G16-d11-p1 → S2-SEP-2 PLK-d11-p0 → S2-SEP-3 G16-d11-p0 → S2-SEP-4 PLK-d11-p1 | 0x12 |
| S3 | Sepolia | S3-SEP-1 PLK-d11-p0 → S3-SEP-2 G16-d11-p0 → S3-SEP-3 PLK-d11-p1 → S3-SEP-4 G16-d11-p1 | 0xa1 |
| S3 | Era Sepolia | S3-ERA-1 G16-d11-p1 → S3-ERA-2 PLK-d11-p0 → S3-ERA-3 G16-d11-p0 → S3-ERA-4 PLK-d11-p1 | 0x9a |

Pairs: positions 1–2 and 3–4 of a block (`<session>-<net>-P1`, `-P2`), each one Groth16 and one PLONK transaction.

4.5 Why 40 is sufficient (and not more). The study is descriptive. (a) On Sepolia, `gasUsed` of a transaction is
determined by its calldata and the contract state; the controlled L1 study already measured it for the same calldata, so
repeating it does not add information — the public value is a dated identity observation. (b) Price, fee and latency vary
over time and across endpoint conditions, which is covered better by sessions on different days than by more
transactions in one session. (c) Six verification observations per backend and network (3 sessions × 2 proofs) support
minimum/median/maximum and session-by-session reporting; no significance test is made, so no power calculation applies.
(d) A single setup limits the spend of test ether. No concrete reason for a larger matrix was found.

## 5. Sessions

5.1 Three sessions, S1–S3, on at least two different UTC calendar days (the earlier 10:00/16:00/22:00 design is not
recreated). Each session runs the two network blocks of section 4.4, one after the other; within a block the four
transactions are sequential (each is sent after the previous one's receipt or timeout).

5.2 The scheduled start time of each session (UTC) is an author input, written into the binding (`sessions[].
scheduled_start_utc`) and committed at the baseline tag before session 1. The live runner refuses a session without a
frozen start time and records the actual start offset. A session starts within ±60 minutes of its scheduled time; a
larger offset, or moving a session after the schedule is frozen, is a protocol deviation that is recorded in section 18
with its reason, before the session is run. A session is never moved because of observed network conditions.

5.3 Setup (section 4.1) runs after the baseline tag and before S1, on each network, and is dated like a session. It is
not repeated; if it cannot be completed, the reason is recorded and a new setup is a documented deviation.

## 6. Key safety

6.1 Public transactions are signed only with a dedicated, externally supplied, funded key used for nothing else: an
absolute key file outside the repository (`CHAINBENCH_PUBLIC_KEY_FILE`, mode 0600 or 0400, one 0x-prefixed 32-byte hex
key) or `CHAINBENCH_PUBLIC_PRIVATE_KEY`. In the image, the key file is mounted read-only at `/run/secrets/`; an
environment key is passed by name only, so its value never appears on a command line.

6.2 Hard refusals (exit 3; nothing is signed or sent): no key; two key sources; a relative path; a key file inside the
repository; a group- or world-readable key file; a mnemonic; a malformed key; any key whose address is a known development
account — the first 20 accounts of every mnemonic of the reproducibility configuration (read from
`chainbench/lib/constants.js` and `chainbench/adapters/eravm/lib/constants.js` at run time) and the ten legacy
anvil-zksync / era-test-node rich wallets (addresses present in the pinned anvil-zksync 0.6.11 binary). No mnemonic is
accepted by the public runner at all. Before the key file is mounted, the host wrapper also refuses (lib/guards.sh, the
same code on macOS/BSD and GNU/Linux `stat`): a symbolic link, a non-regular file, a key file not owned by the invoking
user, a mode other than 0600/0400, and a key directory not owned by the invoking user or with any group/other permission.
The dedicated key is created and checked with the versioned tools `chainbench/adapters/public/tools/new_public_key.sh`
(generated in the frozen image with `--network none`, written exclusively with mode 0600, only the address printed) and
`tools/verify_public_key.sh` (the same host rules and the runner's own key-safety module; the key is never printed).

6.3 The key never leaves the key-safety module: it is not printed, logged, recorded, copied into CSI evidence, or included
in raw JSON or CSV. Only the signer address is recorded. Every file the runner writes passes a guard that aborts the run
if the key (with or without `0x`, any case) would occur in it, and the run directory is scanned again at the end.

## 7. Network observations

7.1 Before each network block (and again after it) the runner makes read-only calls and keeps every response byte for
byte (`observations/<block>-pre.json`, `-post.json`, with request and response times and sha256):
- both networks: `eth_chainId`, `web3_clientVersion`, `eth_getBlockByNumber(latest)` (number, timestamp, `baseFeePerGas`),
  `eth_gasPrice`, the signer's `eth_getBalance` and `eth_getTransactionCount` (latest and pending);
- Sepolia: `eth_maxPriorityFeePerGas`, `eth_feeHistory(5, latest, [10, 50, 90])`;
- Era: `zks_getProtocolVersion`, `zks_getFeeParams`, `zks_L1BatchNumber`, `zks_getL1BatchDetails` of the latest two batches,
  `zks_getBlockDetails(latest)`.
Every transaction row carries the id of its block's observation. The readiness-era observation of 2026-09-25 is not
assumed to be current.

7.2 A failed observation call is recorded as a failure, not retried. The block proceeds only if `eth_chainId` succeeds and
matches (section 3.2) and the pending and latest nonces agree (otherwise every operation of the block is recorded as
`unsent_preflight_failure` with the reason).

7.3 Interpretations (for example the name of the Ethereum fork active on Sepolia at the session date, or the meaning of
an Era protocol version) are written only in `notes/INTERPRETATION.md` with their source and date, never into raw
records. `doctor-public` (read-only) is run before setup and before each session.

## 8. Fee and send policy (frozen before session 1)

8.1 Ethereum Sepolia: EIP-1559 (type 2). `gasLimit` = the controlled L1 study's fixed limit (deploy 6,000,000;
`setIssuer`/`addRoot` 300,000; `verifyCredential` 1,000,000; the paid fee depends on `gasUsed`, not on the limit).
`maxPriorityFeePerGas` = P, a fixed constant (default 1 gwei; author input, frozen). `maxFeePerGas` = 2 × `baseFeePerGas`
of the latest block read immediately before signing + P. The base fee and that block number are recorded.

8.2 ZKsync Era Sepolia: EIP-712 (type 113). `zks_estimateFee` on the exact transaction (from, to, data, value 0,
`gasPerPubdata` 50,000 and, for deployments, the factory dependency); the returned `gas_limit`, `max_fee_per_gas`,
`max_priority_fee_per_gas` and `gas_per_pubdata_limit` are used unchanged and recorded; `eth_gasPrice` and the sha256 of
the `zks_getFeeParams` response are recorded beside them.

8.3 A transaction is sent only if the latest balance ≥ `gasLimit` × `maxFeePerGas`; otherwise it is
`unsent_insufficient_balance`. Nonces are sequential from the latest nonce at the start of the block. A transaction is
never replaced, re-priced, accelerated or re-sent, and no operation is retried inside a session: a failed or unsent
operation stays in the record in its original state.

## 9. Timing

9.1 For every operation: `t_prepare` (before the fee read or estimate and signing), `t0` (immediately before
`eth_sendRawTransaction`), `t_hash` (when that call returns the hash) and `t_receipt` (when the first poll returns a
receipt), each as UTC wall clock (ms) and monotonic clock (ms, microsecond resolution).

9.2 Derived separately: send-to-hash = `t_hash − t0`; hash-to-receipt = `t_receipt − t_hash`; request-to-receipt =
`t_receipt − t0` (and preparation `t0 − t_prepare`). Receipt polling: `eth_getTransactionReceipt` at a fixed interval of
1,000 ms (the first poll immediately after the block-number read below); timeout 900 s (Sepolia) and 600 s (Era); poll
errors are counted, not hidden.

9.3 Also recorded: the block number observed right after `t_hash` (`eth_blockNumber`), the inclusion block, its
timestamp and base fee. Receipt latency is not finality.

## 10. Era batch lifecycle (post hoc)

After the Era transactions have aged (at least 24 hours after the last session, or until their batches report execution),
`./chainbench/run.sh collect-era-finality` records, read-only and without a key, for every Era transaction with a hash:
the current receipt (post hoc; the original row is never changed), `zks_getTransactionDetails`, and
`zks_getL1BatchDetails` of its L1 batch: status, commit/prove/execute times, transactions and settlement chain ids where
reported. Delays from `t_receipt` to commit, prove and execute are derived and kept separate from receipt latency. No
transaction is needed. The collection may be repeated; each collection is dated.

## 11. Failure taxonomy

| State | Meaning |
|---|---|
| `unsent_preflight_failure` | not sent because a check before signing failed (chain id, nonce, dependency, halting rule, build/sign error) |
| `unsent_client_error` | not sent because an RPC/client call failed (fee estimate, balance read, or the send call itself without the transaction becoming known) |
| `unsent_insufficient_balance` | not sent: balance below `gasLimit × maxFeePerGas`, or the node refused it for insufficient funds |
| `submitted_no_receipt` | a hash was obtained but no receipt arrived within the timeout |
| `reverted` | receipt status 0 (revert reason recovered by `eth_call` replay at the parent block) |
| `confirmed_success` | receipt status 1 |

11.1 Every row also has an error class (for example `send_rpc_error`, `node_insufficient_funds`, `fee_rpc_jsonrpc`,
`receipt_timeout`, `halted_after_no_receipt`, `setup_incomplete`, `dependency_missing`, `send_error_tx_known`).
If the send call fails but the transaction is known to the node by its locally computed hash, it is followed as submitted
(`send_error_tx_known`).

11.2 Halting: after `submitted_no_receipt` the rest of that network block is `unsent_preflight_failure`
(`halted_after_no_receipt`, a pending nonce would block it); after an unsent operation the block continues only if the
pending and latest nonces equal the next local nonce (otherwise `halted_nonce_uncertain`).

11.3 Insufficient funds and RPC/client failures are never classified or reported as network unreliability. A failed
observation is never replaced to restore the intended sample size.

## 12. Raw records

12.1 Live runs write to `build/campaigns/chain-public/<run id>/` (git-ignored) and are later moved unchanged to the tracked
`results/chain-public-<date>/`, frozen by the entry's `SOURCE.sha256`. Per run: `run.json` (identity: campaign, run id,
mode, phase, commit, dirty paths, protocol and binding sha256, inputs manifest sha256, signer address, key source,
Node and package versions, lockfile sha256, endpoint identities, timing, fee policy, schedule, scheduled and actual start),
`tx.jsonl` and `tx.csv` (one row per scheduled operation, whatever happened), `observations/`, `checks/` (prechecks and
post-setup checks), `rpc-log.jsonl` (method, times, outcome of every call; no parameters) and, for setup,
`deployments-<network>.json`. Deployments that pass all checks are also written to `DEPLOYMENTS/<network>.json`, which
the sessions read. Era batch collections go to `FINALITY/<collection id>/`.

12.2 Transaction row columns (`chainbench/adapters/public/lib/schema.js`, 100 columns): identity (campaign, run, mode,
protocol and inputs digests, commit, session, phase, block, position, pair, schedule id, operation, backend, depth, proof,
network, chain id, provider label, endpoint host and URL sha256, observation id, signer address, contract role and name,
target and deployed address, artifact and calldata sha256, calldata size, factory dependencies, EraVM bytecode hash);
transaction fields and send policy (type, nonce, gas limit, max fee, priority fee, gas per pubdata, fee rule, preparation
block and base fee, Era estimate components, `eth_gasPrice`, fee-parameters sha256, balance before and required, raw
transaction sha256 and size, local and RPC hash and their agreement); timing (section 9); inclusion and fee (block, hash,
timestamp, base fee, status, `gasUsed`, effective gas price, receipt fee = `gasUsed × effectiveGasPrice`, the expected
EIP-1559 effective price and its agreement, balance at the parent and inclusion blocks, their difference and its
agreement with the receipt fee); Era (L1 batch number and index, `zks_getTransactionDetails` status, fee, gas per pubdata
and fee agreement); outcome (deployed code sha256 and agreement, revert reason, state, error class, error message, notes).
No column holds a secret.

## 13. Reviewer commands and environment

| Command | Needs | What it does |
|---|---|---|
| `./chainbench/run.sh build-image-public` | Docker, network once | pinned image: `node@sha256:48e4b67d…f0f9` (as the frozen images) + git, python3 + `npm ci --ignore-scripts` of `ethers` 6.13.5 and `zksync-ethers` 6.21.2 (10 packages) |
| `./chainbench/run.sh doctor-public [--offline]` | — | adapter, inputs, schedule, key rules, endpoints; read-only observation unless `--offline`; never signs or sends |
| `./chainbench/run.sh dry-run-public` | — | engineering dry run with mock endpoints, `--network none`, an ephemeral key; no public network |
| `./chainbench/run.sh check-public-inputs` | — | section 2 checks against the controlled study (no compiler, key or network) |
| `./chainbench/run.sh derive-public [ROOT]` | — | validation and derived summaries of recorded runs (no key, no network) |
| `./chainbench/run.sh run-public-setup NETWORK` | key, endpoints, test ether | live setup (asks to type `setup-<network>`) |
| `./chainbench/run.sh run-public-session S1\|S2\|S3` | key, endpoints, test ether | one live session (asks to type the session id) |
| `./chainbench/run.sh collect-era-finality` | Era endpoint | section 10, read-only |

The runtime path uses no Hardhat, compiler or prover: signing, ABI encoding and EIP-1559/EIP-712 serialisation come from
`ethers` and `zksync-ethers`; JSON-RPC goes through `node:https` (no WebSocket, no ethers provider, no `fetch`).
`CHAINBENCH_PUBLIC_NATIVE=1` runs the reviewer commands with a host Node 22 instead of the image; live commands refuse it.

13.1 Frozen public image. The live commands (setup, sessions, finality collection) run only in the image recorded in the
versioned `chainbench/adapters/public/ARCHIVE.json`, written by `save-image-public` from the saved OCI archive: the
image-index digest (the Docker image ID under the containerd image store), the platform manifest, the config, the archive
sha256 and the architecture, with the three blobs verbatim so that the chain index → manifest → config can be re-verified
offline. A Docker tag is never identity. Before anything else (before the key file is examined) the wrapper verifies that
the selected and loaded image has exactly that ID, OS, architecture and rootfs layer list; it starts the container by
digest and passes the verified identity in; the runner refuses a live run without it or with any difference, before the key
is loaded, and records it in `run.json`; after the container exits the wrapper verifies the image again. Both checks are
appended to `IMAGE-LEDGER.jsonl` in the live output root. `load-image-public` loads the archive after checking its sha256;
`verify-image-public` reports the identity; `test-guards-public` runs the guard tests (key-file rules on both `stat`
branches, image record and guards, endpoint policy, VP12/VP13) without key or network.

## 14. Derivations (descriptive only)

`scripts/analysis/derive_chain_public.py` (standard library) writes: `public_ops.csv` (every row); `public_summary.csv`
(per phase, network, backend and operation: planned count, counts per state, and n/min/median/max of `gasUsed`, effective
gas price, receipt fee, send-to-hash, hash-to-receipt and request-to-receipt over `confirmed_success` rows);
`public_sessions.csv` (session-by-session medians and ranges); `public_gas_vs_controlled_l1.csv` (Sepolia `gasUsed` beside
the controlled L1 `gasUsed` of the same operation, as a dated identity observation); `era_batch_lifecycle.csv` (section 10);
`validation.json` and `derivation.json` (input and output sha256). Fees are in wei of test ether. No significance test, no
cross-VM ratio, no fiat or mainnet conversion. Groth16 and PLONK are compared only within one network and only
descriptively.

## 15. Validation and acceptance

15.1 Before the first public transaction: `dry-run-public` passes all its expectations; `check-public-inputs` passes;
`doctor-public` (read-only, with the key and endpoints) shows no FAIL.

15.2 A public record is accepted if `derive_chain_public.py` passes: VP1 schema (header = schema, CSV = JSONL); VP2 one
row per scheduled operation in schedule order, mode as expected; VP3 states from the taxonomy with error classes; VP4
timing arithmetic (t0 ≤ t_hash ≤ t_receipt, derived latencies equal the clock differences); VP5 receipt fee = `gasUsed ×
effectiveGasPrice`; VP6 the frozen send policy; VP7 chain ids; VP8 an observation before every block, linked from its rows;
VP9 RPC hash = locally computed hash; VP10 the signer recorded as an address only; VP11 Era receipts carry an L1 batch
number; and, for live records, VP12 every run recorded the frozen public image (section 13.1), re-verified after the run
(`IMAGE-LEDGER.jsonl`), one image for all runs, and VP13 every endpoint is the frozen primary (the secondary only under a
recorded deviation) and every row carries the endpoint used. Acceptance concerns the integrity of the record, not the success of transactions: states, deployed-code identity
and balance-based fee agreement are reported as findings, never used to exclude or normalise a row.

## 16. CSI evidence identity

16.1 Evidence entry `CSI-CHAIN-PUBLIC-01` (experiment "dated public-network case study (Ethereum Sepolia, ZKsync Era
Sepolia)"), separate from the local entries. Status: `planned` (harness and design registered; author inputs open) →
`ready` (author inputs frozen, baseline tag, dry run and read-only doctor passed) → `validated` (setup, sessions S1–S3 and
the Era batch collection recorded and accepted). It stays `planned`/`ready` until then.

16.2 Separate locations: protocol (`csi/protocols/chain/CHAIN-PUBLIC-PROTOCOL-v1.md`); deployment artifacts and proof
calldata (`csi/campaigns/chain/CSI-CHAIN-PUBLIC-01/inputs/`); raw public observations (`results/chain-public-<date>/`, the
only source of truth once registered); derived dated summaries (`csi/campaigns/chain/CSI-CHAIN-PUBLIC-01/derived/`);
public-network environment observations (inside each run's `observations/` and `FINALITY/`, and `notes/INTERPRETATION.md`
for interpretations). Engineering records (dry runs, doctor reports) go to `readiness/` and are not scientific data.

## 17. Author inputs to freeze before any public transaction

| # | Input | Where it is frozen |
|---|---|---|
| 1 | Scheduled UTC start of S1, S2, S3 (at least two calendar days; not a repeat of the 10:00/16:00/22:00 design) | binding `sessions[].scheduled_start_utc` |
| 2 | Ethereum Sepolia endpoint and provider label (https; one for the whole study) | binding `endpoints.frozen` (label, host, URL sha256; the URL itself is given in the environment at run time); recorded in every row |
| 3 | ZKsync Era Sepolia endpoint and provider label (default: the official public `https://sepolia.era.zksync.dev`); optionally a validated secondary (section 3.3) | as above; secondary in `endpoints.secondary` |
| 4 | The dedicated signing key (created for this study only, kept outside the repository, chmod 600) and its public address | key file outside git; address in the ready record |
| 5 | Funding of that address on both networks, after checking the current base fees with `doctor-public` | balances recorded in every observation |
| 6 | Priority fee P for Sepolia (default 1 gwei) | binding `fee_policy.sepolia.max_priority_fee_per_gas_wei` |
| 7 | The date label of the results directory | binding `results_dir` |
| 8 | A containerized `dry-run-public` and a live read-only `doctor-public` on the campaign host, then the baseline tag | readiness records; tag `chain-public-baseline-<date>` |

Funding guide (not frozen; the author checks current fees). Sepolia: the balance rule requires `gasLimit × maxFeePerGas`
at each send, the largest being a deployment (6,000,000 × (2 × base fee + P)); the expected spend is about 6.0 million gas
(2.87 million for setup and 3.14 million for the 12 verifications, from the controlled L1 values) × (base fee + P) for
the 20 Sepolia transactions. Era Sepolia: fees at the fair L2 gas price observed on 2026-09-25 (0.025 gwei) are of the
order of 10⁻⁴ ETH per deployment.

## 18. Amendments and deviations

None. (Each later entry: date, what changes, why, whether it was decided before or after any public transaction it affects.)

Entries after the baseline tag `chain-public-baseline-20260926` (commit `7bb0156`; the two lines above are the text frozen
there):

| ID | Date | Section | Change | Reason | Decided relative to the public transactions it affects |
|---|---|---|---|---|---|
| A1 | 2026-09-26 | §15.2 VP11 (with §10, §14) | **Validation semantics only.** VP11 no longer requires every Era receipt to carry an L1 batch number *at recording*. (1) An Era row whose recorded receipt carries an L1 batch number is validated at once (*available*). (2) A row recorded while its Era status was `included` (`zks_getTransactionDetails`), with no L1 batch number yet, is not a failed record: the absence is kept and reported as an observed property of the live run, and its L1-batch check is *deferred*. (3) The existing read-only `collect-era-finality` (§10) later supplies the batch evidence; `derive_chain_public.py` reconciles it to the original row by transaction hash (and run id and schedule id), using only collections taken in the same mode through the frozen Era endpoint (a secondary only under a recorded deviation) in the frozen image. (4) A deferred row becomes *reconciled* when such a collection reports its receipt present with an L1 batch number; VP11 fails if a row has no batch number at any other stage, if a collection reports the receipt absent, or if batch numbers disagree. (5) VP11 passes only when every Era row is available or reconciled; until then its status is DEFERRED (validation status DEFERRED, exit code 3), neither PASS nor FAIL. (6) Original rows are never backfilled, rewritten or changed; per-row outcomes go to `derived/era_vp11_reconciliation.csv` and the counts to `validation.json` findings (`era_l1_batch_at_recording`, `vp11_rows`). Nothing else changes: runner, transaction measurement code, image, schedule, receipt-timing definition, fee policy, endpoints, proofs, states and the other validation properties are as frozen at the tag, and S1–S3 run from the tag. | Found by the public setup on 2026-09-26 (run `live-setup-era-sepolia-7bb0156-20260926T045759Z`): all eight Era setup transactions were confirmed and recorded at their first receipt poll (1–2 s after inclusion) with status `included` and no L1 batch number, because on live ZKsync Era an included L2 transaction is sealed into an L1 batch only later. The frozen engineering dry run did not represent this lifecycle state (its mock endpoint returned a batch number with every receipt), so VP11 as frozen could not be met by any live Era row. | Decided after the 16 setup transactions (which it re-validates without changing them) and before S1, the first session transaction; published on a separate branch before S1 and merged only after the sessions and the §10 collection. |
