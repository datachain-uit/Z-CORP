# CSI-CHAIN-PUBLIC-01 final pre-flight — interpretation (kept apart from the raw records)

Raw records in this directory: `doctor-20260925T155152Z.json` (doctor-public, live, read-only) and `rpc-probe.json`
(read-only compatibility probe). Nothing below changes or annotates those files. Engineering notes only; no scientific
claim.

Ethereum Sepolia (Alchemy, host eth-sepolia.g.alchemy.com, reth/v1.10.2):
- Latest-block header fields present: withdrawals/withdrawalsRoot, blobGasUsed, excessBlobGas, parentBeaconBlockRoot,
  requestsHash. eth_config "current": activationTime 1761607008 (2025-10-27T23:16:48Z), forkId 0x268956b6, blob schedule
  target 14 / max 21, 18 precompiles including P256VERIFY; "next" and "last" are null.
- Interpretation: consistent with a post-Prague chain running the Fusaka (Osaka) rules with the second blob-parameter-only
  schedule (target 14 / max 21); this node reported no scheduled next fork at 2026-09-25T15:51Z. Under Osaka the
  per-transaction gas limit cap is 2^24 = 16,777,216 (EIP-7825); the largest frozen Sepolia gas limit is 6,000,000.

ZKsync Era Sepolia (official public RPC, zkSync/v2.0):
- zks_getProtocolVersion: version_id 29, minorVersion 29; base system contracts bootloader 0x01000911…, default_aa
  0x010005f7…, evm_emulator 0x01000d8b… — the same values as the live observation recorded for CSI-CHAIN-LOCAL-01-L2
  on 2026-09-25 (campaign.json classification.live_base_system_contracts, live_protocol 29).
- Interpretation: no Era protocol upgrade between that observation (12:11Z) and this one (15:51Z).
