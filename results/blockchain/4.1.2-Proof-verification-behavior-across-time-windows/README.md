# Proof-verification behavior across time windows

<!-- pre-correction banner (rerun protocol v3, section 7.4) -->
> **Pre-correction campaign (July 2026) — superseded, not used by the CSI manuscript.**
> These on-chain measurements were taken before the selector-booleanity correction of `circuits/CredentialVerifier.circom` (commit `2524431`, P4a). They are kept unchanged as historical evidence. First commits,
> git blob IDs and sha256 of every file: [`results/PRECORRECTION-2026-07.sha256`](../../PRECORRECTION-2026-07.sha256).
> The only change to these CSV files since July is the 2026-09-21 transaction-hash annotation (P4b), which
> altered no measured value. The post-correction on-chain rerun (protocol v3, section 5) has not been run yet.

This directory contains the published blockchain-side proof-verification
measurements and the corresponding figure used in the paper.

## Experimental configuration

- Merkle-tree depth: 11
- Verification attempts per network and window: 50
- Networks:
  - Ethereum Sepolia
  - zkSync Sepolia
- Recorded fields:
  - iteration
  - gas consumption
  - gas price
  - transaction latency
  - execution status
  - error message, where applicable
  - transaction hash of each on-chain `verifyCredential` call

### Published experimental results

The on-chain evaluation was conducted in a campaign. Each CSV file contains 50 verification attempts and records the iteration number, gas consumption, gas price, transaction latency, execution status, error message where applicable, and the transaction hash of each call that reached the chain.

| Campaign | Network | Raw transaction measurements | Result figure |
|---|---|---|---|
| Campaign, depth 11 | Ethereum Sepolia | [Window 1](20260711T091246-11-50-sepolia.csv)<br>[Window 2](20260711T131457-11-50-sepolia.csv)<br>[Window 3](20260712T030525-11-50-sepolia.csv) | [Figure 5 (PDF)](Figure_5.pdf) |
| Campaign, depth 11 | zkSync Sepolia | [Window 1](20260711T092751-11-50-zkSyncSepolia.csv)<br>[Window 2](20260711T132711-11-50-zkSyncSepolia.csv)<br>[Window 3](20260712T031611-11-50-zkSyncSepolia.csv) | [Figure 5 (PDF)](Figure_5.pdf) |

Complete artifact directories:

- This directory contains the complete measurement campaign.

## On-chain provenance

Verified against the public explorers on 2026-09-21. All transactions were sent
from the same externally owned account on both networks:
`0x67EA2D06F70969C9E1D9A42f0184b5A05a60D3d8`.

The timestamp in each CSV file name is the start time of
`scripts/blockchain/verification.js`, taken from a UTC clock.

### Ethereum Sepolia

| Item | Value |
|---|---|
| `CredentialManager` | [`0x97A8A1890ce63D80d232be2B965Ca5DE8075B6A9`](https://sepolia.etherscan.io/address/0x97a8a1890ce63d80d232be2b965ca5de8075b6a9) |
| Groth16 verifier (depth 11) | `0x8FFb65a4237f4E9f07c74764d5a2a8963cCF423a` |
| Deploy | `0x09e676be…2f5d` — 2026-07-11 09:11:48 UTC |
| `setIssuer` | `0x8bf63d54…247d` — 2026-07-11 09:12:00 UTC |
| `addRoot` | `0xcf4a9311…82af` — 2026-07-11 09:12:12 UTC |

| CSV | `verifyCredential` transactions on-chain (UTC) |
|---|---|
| `20260711T091246-11-50-sepolia.csv` | 50 — 2026-07-11 09:13:00 → 09:24:00 |
| `20260711T131457-11-50-sepolia.csv` | 47 — 2026-07-11 13:15:00 → 13:25:12 |
| `20260712T030525-11-50-sepolia.csv` | 50 — 2026-07-12 03:05:36 → 03:16:00 |

### zkSync Sepolia

| Item | Value |
|---|---|
| `CredentialManager` | [`0xC15058464195A02A751F9eEa04f998cb59F0CB6b`](https://sepolia.explorer.zksync.io/address/0xC15058464195A02A751F9eEa04f998cb59F0CB6b) |
| Groth16 verifier (depth 11) | `0x7B22dacE8FCe0324486d79EE4684F43220e537cF` |
| Deploy | `0x4821b792…3c14` — 2026-07-11 09:26 UTC |
| `setIssuer` | `0x1dd552e8…34e8` — 2026-07-11 09:27:01 UTC |
| `addRoot` | `0x61e7246f…2b61` — 2026-07-11 09:27:04 UTC |

| CSV | `verifyCredential` transactions on-chain (UTC) |
|---|---|
| `20260711T092751-11-50-zkSyncSepolia.csv` | 50 — 2026-07-11 09:27:54 → 09:30:28 |
| `20260711T132711-11-50-zkSyncSepolia.csv` | 50 — 2026-07-11 13:27:15 → 13:30:52 |
| `20260712T031611-11-50-zkSyncSepolia.csv` | 50 — 2026-07-12 03:16:14 → 03:18:49 |

### Notes

- The deployment files in `../4.1.1-Deployment-and-root-publication-cost/`
  named `20260712T1341xx-*` list the deployment used here. Their file names
  record when the files were written; the transactions they list took place on
  2026-07-11 between 09:11 and 09:27 UTC.
- Both `CredentialManager` contracts enforce issuer authorisation: `addRoot`
  was accepted only after `setIssuer`.

---

## Reproduction

See the
[blockchain deployment and verification guide](../../../docs/experiments/experiment-1-blockchain.md).
