# CSI-CHAIN-PUBLIC-01: dependency and security audit of the public runner (2026-09-25)

Scope: only the dependency graph that executes on the live RPC/signing path of the public runner. The frozen local
scientific environments (L1 and L2 images, lockfiles) are not upgraded or changed. Evidence: `dependency-audit/`
(`npm audit --json` of every tracked lockfile, npm 10.9.8, GitHub advisory database via registry.npmjs.org).

## 1. What executes on the live path

| Component | Role on the live path | Source |
|---|---|---|
| Node.js 22.23.2 (`node@sha256:48e4b67d…f0f9`, the base of the frozen images) | runtime; `node:https`/`node:http` for JSON-RPC; `node:crypto` | image base |
| `ethers` 6.13.5 | secp256k1 signing, EIP-1559 serialisation and hashing, ABI encoding, HD derivation (only to refuse development accounts) | `chainbench/adapters/public/package-lock.json` |
| `zksync-ethers` 6.21.2 (no dependencies of its own; peer `ethers`) | EIP-712 (type 113) signing input and serialisation, bytecode hash, ContractDeployer ABI, deployed-address decoding | same |
| `@noble/curves` 1.2.0, `@noble/hashes` 1.3.2, `aes-js` 4.0.0-beta.5, `@adraffy/ens-normalize` 1.10.1, `tslib` 2.7.0 | loaded by `ethers` (curves/hashes are the signing code) | same |
| `ws` 8.17.1 | loaded by `ethers` (module evaluated at `require`), used only by `ethers.WebSocketProvider` | same |
| `@types/node`, `undici-types` | type declarations; never executed | same |

The runner never constructs an ethers provider: JSON-RPC is its own client over `node:https` (`lib/rpc.js`), with
`accept-encoding: identity`, https-only live endpoints and loopback-only dry-run endpoints. `doctor-public` checks
statically that the adapter code creates no WebSocket, no ethers `JsonRpcProvider`/`WebSocketProvider` and calls no
`fetch`.

**Hardhat is not needed at run time.** Precompiled artifacts and proof calldata are frozen inputs
(`csi/campaigns/chain/CSI-CHAIN-PUBLIC-01/inputs/`, section 2 of the protocol); signing and serialisation need only
`ethers` and `zksync-ethers`. Compilers (solc, zksolc/era-solc) and snarkjs were used once, by
`build_public_inputs.js`, and are not on the live path.

## 2. Isolated package

A separate package with its own lockfile, `chainbench/adapters/public/package.json` / `package-lock.json`, holds only
`ethers` and `zksync-ethers` (exact versions of the frozen EraVM adapter, so signing and serialisation use the library
versions already exercised in the controlled L2 study). It installs with `npm ci --ignore-scripts` (no install scripts
run). Size of the graph:

| Lockfile | Packages | Vulnerable packages reported (critical / high / moderate / low) |
|---|---|---|
| `package-lock.json` (repository root; July-era Hardhat toolchain, zkUIT) | 882 | 5 / 25 / 47 / 19 |
| `chainbench/package-lock.json` (frozen L1 image) | 276 | 0 / 10 / 4 / 11 |
| `bench/package-lock.json` (prover benchmark) | 71 | 0 / 3 / 0 / 0 |
| `chainbench/adapters/eravm/package-lock.json` (frozen L2 image) | 49 | 0 / 4 / 2 / 0 |
| **`chainbench/adapters/public/package-lock.json` (public runner)** | **10** | **0 / 1 / 1 / 0** (both: `ws`, via `ethers`) |

The GitHub Dependabot count reported at push time (168 alerts: 7 critical, 78 high, 66 moderate, 17 low) is per advisory
and per manifest over the four tracked lockfiles; `npm audit` counts vulnerable packages. None of the critical
packages of the root lockfile (`form-data`, `handlebars`, `pbkdf2`, `protobufjs`, `sha.js`) nor any high package other
than `ws` (for example `axios`, `undici`, `lodash`, `tar-fs`, `hardhat`, `mocha`, `@grpc/grpc-js`) is in the public
runner's graph (`dependency-audit/npm-audit-summary.json`, field `in_public_runner_graph`).

## 3. Findings in the public runner's graph and their applicability

| Advisory | Package / range | Severity | Applicable? | Evidence |
|---|---|---|---|---|
| GHSA-96hv-2xvq-fx4p "Memory exhaustion DoS from tiny fragments and data chunks" (CWE-400/770/1050, CVSS 7.5) | `ws` ≥ 8.0.0 < 8.21.0 (installed 8.17.1) | high | **No** | exploitable only by a WebSocket peer sending frames to a `ws` client or server; the runner opens no WebSocket (no `WebSocketProvider`, https-only endpoints, `ws://`/`wss://` refused by `lib/rpc.js`; checked by `doctor-public`) |
| GHSA-58qx-3vcg-4xpx "Uninitialized memory disclosure" (CWE-908, CVSS 4.4) | `ws` ≥ 8.0.0 < 8.20.1 | moderate | **No** | same: requires a `ws` connection |
| `undici` advisories (GHSA-g9mf-h72j-4rw9, -2mjp-6q6p-2qxm, -vrm6-8vpv-qv8q, -v9p9-hfj2-hcw8, -vxpw-j846-p89q, …; all ranges < 6.28.0) | npm `undici` in the root and L1 lockfiles | high/moderate | **No** | not in the public graph; Node 22.23.2 bundles undici 6.28.0, outside every listed range, and the runner does not use `fetch` |

No critical or high advisory applies to the live RPC/signing path. `npm audit` of the public lockfile will still list
the `ws` entries (fix available only through `ethers` 6.17.0); the versions are kept identical to the frozen EraVM
adapter, and the non-applicability rests on the facts above, which `doctor-public` re-checks on every run. No broad
dependency modernisation was made; the repository's other lockfiles are unchanged.
