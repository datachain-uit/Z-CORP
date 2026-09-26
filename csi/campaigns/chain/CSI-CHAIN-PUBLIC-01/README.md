# CSI-CHAIN-PUBLIC-01: dated public-network case study (Ethereum Sepolia, ZKsync Era Sepolia)

Status: **planned** (pre-freeze). Harness, design, frozen inputs, the frozen public image (`chainbench/adapters/public/
ARCHIVE.json`), the session times, the frozen endpoints (Sepolia primary Alchemy; Era primary the official public RPC; Era
secondary Alchemy, read-only validated fallback used only under a recorded deviation), P = 1 gwei and the dedicated signer's
public address (`0x6C58f325404dFF6c860034ceDA59D1de789Ac2E3`, binding `key.signer_address`; the key itself is never recorded)
are recorded; its funding, the results label and the baseline tag are open; the signer is not funded and **no public
transaction has been sent**. This entry is separate from the
controlled local entries CSI-CHAIN-LOCAL-01 (L1) and CSI-CHAIN-LOCAL-01-L2 (local EraVM), which it does not change, and it
contains no July 2026 or zkUIT result.

Protocol: `csi/protocols/chain/CHAIN-PUBLIC-PROTOCOL-v1.md` (draft for freeze at the public baseline tag). Adapter:
`chainbench/adapters/public/` (reviewer commands in its README). Binding: `chainbench/workloads/zcorp/campaigns/CSI-CHAIN-PUBLIC-01.json`.

| Path | What it is | Status |
|---|---|---|
| `campaign.json` | registration: identities, matrix, sessions, fee policy, readiness, open author inputs (`record_campaign_public.py`) | planned |
| `inputs/` | frozen deployment artifacts (`deployment/evm`, `deployment/eravm`) and depth-11 proof calldata (`proofs/d11.json`); `IDENTITY.json` (43 checks against the controlled study), `INPUTS.sha256` | frozen |
| `notes/DEPENDENCY-AUDIT.md`, `notes/dependency-audit/` | dependency and security audit of the public runner (npm audit evidence) | record |
| `readiness/` | engineering dry runs (mock endpoints, ephemeral key; not scientific data), doctor reports, the final pre-flight (`preflight-20260925/`) and the pre-freeze validation (`prefreeze-20260925/`) | record |
| `notes/INTERPRETATION.md` | interpretations of public-network observations (fork names, protocol versions), kept apart from raw evidence | to be written at the sessions |
| `derived/` | dated descriptive summaries (`scripts/analysis/derive_chain_public.py`) | after the sessions |
| raw public observations | `results/chain-public-<date>/` (the only source of truth once registered; `SOURCE.sha256`) | after the sessions |
