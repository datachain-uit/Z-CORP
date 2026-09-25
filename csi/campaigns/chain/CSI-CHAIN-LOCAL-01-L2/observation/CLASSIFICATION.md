# Live ZKsync Era Sepolia observation and local-EraVM compatibility class

CSI-CHAIN-LOCAL-01, local-EraVM (L2) arm. This record fixes the observed live protocol version, the local version that
the arm uses, and the compatibility class (CHAIN-PROTOCOL-v1 section 16.1, amendment A6). It is not scientific data.

## 1. Observation (read-only)

| Item | Value |
|---|---|
| Time (UTC) | 2026-09-25T12:11:16Z to 12:11:25Z (`20260925T121116Z/meta.txt`, per-call times in `calls.tsv`) |
| Endpoint and provider | `https://sepolia.era.zksync.dev`, the official public RPC of ZKsync Era Sepolia (Matter Labs) |
| Host and client | the campaign Mac (Darwin 25.6.0), curl 8.7.1, via `chainbench/adapters/eravm/observe-public.sh` |
| Calls | 12 JSON-RPC reads: `eth_chainId`, `web3_clientVersion`, `zks_getProtocolVersion`, `zks_getFeeParams`, `eth_gasPrice`, `eth_blockNumber`, `eth_getBlockByNumber(latest)`, `zks_L1BatchNumber`, `zks_getBlockDetails(latest)`, `zks_getL1BatchDetails` for the two latest batches, `zks_getBridgeContracts`. All HTTP 200, no error bodies. |
| What was not done | No transaction, no signature, no key, no account; nothing deployed; no test ETH used. |
| Raw answers | `20260925T121116Z/*.json`, byte-for-byte as received; digests in `20260925T121116Z/SHA256SUMS` |

`zks_getProtocolVersion` is supported by the endpoint, so no alternative method was needed.

## 2. Live values

| Quantity | Live Era Sepolia |
|---|---|
| Chain id | `0x12c` (300) |
| `web3_clientVersion` | `zkSync/v2.0` |
| Protocol version (`zks_getProtocolVersion`) | `version_id` 29, `minorVersion` 29, activated at 1757332047 (2025-09-08T11:47:27Z) |
| Latest block | 8,561,516, timestamp 2026-09-25T12:10:35Z, in batch 22,261 (sealed); `zks_getBlockDetails` protocol `Version29` |
| Base system contracts (protocol record) | bootloader `0x01000911c4db4fe62c98e180cfa7e9b3a22fb15f505905d4bf36192f481551e6`; default AA `0x010005f73e7c299ed73db937843643bdc276cbc2cc8596287e1e0cf3afc60252`; EVM emulator `0x01000d8bae37b82f311186426184866498b357f41d7a02ced11f3e3fbfbacd63` |
| L2 system upgrade transaction | `0xa1ff3e02225fe7ec1fc05ad9f3a1082f770f7de11095c9a1af5ea88fbba0e4ce` |
| Fee parameters (`zks_getFeeParams`, V2) | minimal L2 gas price 25,000,000; compute overhead part 0; pubdata overhead part 1; batch overhead L1 gas 800,000; max gas per batch 200,000,000; max pubdata per batch 700,000; L1 gas price 1,530,052,834; L1 pubdata price 121,712,918 |
| Fee input of the latest block | L1 gas price 1,527,282,679; fair L2 gas price 25,000,000; fair pubdata price 1,911,153,947, hence gas per pubdata ceil(1,911,153,947 / 25,000,000) = 77 at that block |
| `eth_gasPrice` | 25,000,000 wei |

The protocol's semantic patch version is not exposed by these calls. The live version is identified by the minor
version (29) together with the base-system-contract hashes and the upgrade transaction above.

## 3. Local EraVM

| Quantity | Local (anvil-zksync 0.6.11, offline) |
|---|---|
| Highest supported protocol version | 29 (`--protocol-version 30` is rejected: "protocol version '30' is not supported") |
| Selected protocol version | 29 (`--protocol-version 29`), block details report `Version29` |
| Base system contracts (built-in v29) | bootloader `0x0100092f045c41c21bd08a9c6fa909fa6a8b446e3f6cd9f08356352a3195a40c`; default AA `0x010005f74935e95e527d18ea9bfc82906fb20903a5683c528ee7af404e9bd531`; EVM emulator disabled (no hash) |
| Chain id | 260 (local; the live chain is 300) |
| Fee input (fixed by the binary without a fork; see A6) | base fee 45,250,000; fair L2 gas price 45,250,000; fair pubdata price 3,784,558,330; gas per pubdata 84 |

## 4. Classification: **B (bounded)**

- Not **A (exact)**: the minor version is the same (29), but the local bootloader and default-account bytecode hashes
  differ from the live ones, and the local node runs without the EVM emulator that the live chain has.
- Not **C (incompatible)**: the local node supports the live minor version, and every contract and operation of the
  matrix compiles and executes on it (Groth16 and PLONK verifiers and managers, all negative controls).

Label used for every L2 result: **"EraVM execution under protocol v29 (anvil-zksync 0.6.11 built-in v29 system
contracts; bootloader and default-account hashes differ from live Era Sepolia; no EVM emulator; fixed local fee input)"**.

Consequences:
- L2 results are never presented as a reproduction of the live network.
- EraVM computational gas and pubdata bytes are reported as measured under this local v29 system-contract set; bootloader
  and default-account overheads may differ from live Era Sepolia.
- Receipt `gasUsed` is reported only as derived under the local fee input (gas per pubdata 84 locally against 77 at
  the observed live block; base fee 45,250,000 locally against 25,000,000 live). Live fees, live `gasPerPubdata`, L1
  publication cost, latency, finality, and batch or proving cost are not claimed.
- EraVM gas and EVM gas are different units; no L2 number is compared numerically with an L1 number.
