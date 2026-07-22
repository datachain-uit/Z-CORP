# Proof-verification behavior across time windows

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

### Published experimental results

The on-chain evaluation was conducted in a campaign. Each CSV file contains 50 verification attempts and records the iteration number, gas consumption, gas price, transaction latency, execution status, and error message, where applicable.

| Campaign | Network | Raw transaction measurements | Result figure |
|---|---|---|---|
| Campaign, depth 11 | Ethereum Sepolia | [Window 1](20260711T091246-11-50-sepolia.csv)<br>[Window 2](20260711T131457-11-50-sepolia.csv)<br>[Window 3](20260712T030525-11-50-sepolia.csv) | [Figure 5 (PDF)](Figure_5.pdf) |
| Campaign, depth 11 | zkSync Sepolia | [Window 1](20260711T092751-11-50-zkSyncSepolia.csv)<br>[Window 2](20260711T132711-11-50-zkSyncSepolia.csv)<br>[Window 3](20260712T031611-11-50-zkSyncSepolia.csv) | [Figure 5 (PDF)](Figure_5.pdf) |

Complete artifact directories:

- This directory contains the complete measurement campaign.

---

## Reproduction

See the
[blockchain deployment and verification guide](../../../docs/experiments/experiment-1-blockchain.md).
