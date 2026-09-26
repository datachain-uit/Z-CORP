# CSI-CHAIN-PUBLIC-01 funded pre-baseline verification, 2026-09-26 (engineering; not scientific data)

Read-only `doctor-public` with the dedicated key, run by the author on the campaign Mac (Darwin arm64) at commit
`79d2eb1` (campaign paths clean) in the frozen public image `sha256:246e35a0…` (checked by `verify-image-public`, then by the wrapper when it started the doctor),
through `tools/funded_doctor_mac.sh`. The key was used only by the key-safety module to derive the address; nothing was
signed, sent or deployed, and only read-only JSON-RPC methods were called (`eth_chainId`, `web3_clientVersion`,
`eth_getBlockByNumber`, `eth_gasPrice`, `eth_getBalance`, `eth_getTransactionCount`; Sepolia `eth_maxPriorityFeePerGas`,
`eth_feeHistory`; Era `zks_getProtocolVersion`, `zks_getFeeParams`, `zks_L1BatchNumber`, `zks_getL1BatchDetails`,
`zks_getBlockDetails`).

| File | What |
|---|---|
| `doctor-20260926T024728Z.json` | the funded doctor report (sha256 `0bd5518193a2e7e42b1ffe2cd8a6ba49f98cb24d42c4cc1907b9bc0c5990562e`): 23 PASS, 0 WARN, 0 FAIL |
| `funded-doctor.log` | the helper's log: HEAD and clean paths, `verify_public_key.sh` (PASS, address = the frozen signer), `verify-image-public` (PASS), the Sepolia URL check (host and sha256 only), the doctor output, the URL leak search (none) |
| `funded-gate.json` | `record_campaign_public.py --check-funded-doctor` on this report: the D5 funding gate, PASS |
| `tools/funded_doctor_mac.sh` | the helper that was run |

Observed state of the signer `0x6C58f325404dFF6c860034ceDA59D1de789Ac2E3` (block tag `latest`):

| Network | Endpoint (label, host, URL sha256) | Chain id | Block | Balance (wei) | Target (wei) | Nonce latest / pending | Observed (UTC) |
|---|---|---|---|---|---|---|---|
| Ethereum Sepolia | Alchemy, `eth-sepolia.g.alchemy.com`, `d020365e…dee10` (URL not recorded) | 11155111 | 11,783,374 | 500000000000000000 (0.5 test ETH) | 200000000000000000 | 0 / 0 | 2026-09-26T02:47:22.162Z–02:47:23.888Z |
| ZKsync Era Sepolia | ZKsync Era Sepolia official public RPC, `sepolia.era.zksync.dev`, `8366bcd4…2b23d` | 300 | 8,565,576 | 300000000000000000 (0.3 test ETH) | 10000000000000000 | 0 / 0 | 2026-09-26T02:47:23.889Z–02:47:28.231Z |

Both frozen primaries were used; the Era secondary was not used and no deviation exists. Nonce 0 (latest and pending)
on both networks means the signer has sent no transaction on either network, so its balances come from inbound
transfers only; this is the nonce condition of the baseline, not a reconstruction of the account history. The full
Sepolia URL and its key segment appear in none of these files (checked on the Mac by the helper and again here).
