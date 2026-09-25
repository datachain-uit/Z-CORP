# CSI-CHAIN-PUBLIC-01: dated public-network case study (Ethereum Sepolia, ZKsync Era Sepolia)

Status: **planned**. Harness, design and frozen inputs are registered and the engineering dry run passed; the author
inputs of protocol section 17 are open; **no public transaction has been sent**. This entry is separate from the
controlled local entries CSI-CHAIN-LOCAL-01 (L1) and CSI-CHAIN-LOCAL-01-L2 (local EraVM), which it does not change, and it
contains no July 2026 or zkUIT result.

Protocol: `csi/protocols/chain/CHAIN-PUBLIC-PROTOCOL-v1.md` (draft for freeze at the public baseline tag). Adapter:
`chainbench/adapters/public/` (reviewer commands in its README). Binding: `chainbench/workloads/zcorp/campaigns/CSI-CHAIN-PUBLIC-01.json`.

| Path | What it is | Status |
|---|---|---|
| `campaign.json` | registration: identities, matrix, sessions, fee policy, readiness, open author inputs (`record_campaign_public.py`) | planned |
| `inputs/` | frozen deployment artifacts (`deployment/evm`, `deployment/eravm`) and depth-11 proof calldata (`proofs/d11.json`); `IDENTITY.json` (43 checks against the controlled study), `INPUTS.sha256` | frozen |
| `notes/DEPENDENCY-AUDIT.md`, `notes/dependency-audit/` | dependency and security audit of the public runner (npm audit evidence) | record |
| `readiness/` | engineering dry run (mock endpoints, ephemeral key; not scientific data) and an offline doctor report | record |
| `notes/INTERPRETATION.md` | interpretations of public-network observations (fork names, protocol versions), kept apart from raw evidence | to be written at the sessions |
| `derived/` | dated descriptive summaries (`scripts/analysis/derive_chain_public.py`) | after the sessions |
| raw public observations | `results/chain-public-<date>/` (the only source of truth once registered; `SOURCE.sha256`) | after the sessions |
