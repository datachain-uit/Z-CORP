# CSI-CHAIN-PUBLIC-01 final pre-flight, 2026-09-25 (engineering; not scientific data)

On the campaign Mac at harness `0c10900`; accepted by the author. No key was created, read or mounted; nothing was signed
or sent; `eth_sendRawTransaction` was never called.

| Directory | What |
|---|---|
| `image/` | the pre-flight image `sha256:df3da7e3…` (archive `dabef2cb…`): build log, inspect, inventory, `npm ls`, archive listing and index. **Superseded engineering provenance**: the runtime code changed in the pre-freeze fixes and the final image is `sha256:246e35a0…` (`../prefreeze-20260925/image-8674988/`); manifest and config are identical, only the image index (build provenance) differs |
| `checks/` | container dry run 92/92 (`SUMMARY.json`), `check-public-inputs` 27/27, offline doctor, endpoint rule 13/13, `npm audit` / signatures, `compare-native-vs-container.json` |
| `live/` | live read-only `doctor-public` (`doctor-20260925T155152Z.json`, 15:51:48Z) and `rpc-probe.json` (15:51:52–15:52:03Z): Sepolia primary Alchemy (host `eth-sepolia.g.alchemy.com`, URL sha256 `d020365e…`, URL never stored) and the Era primary (`https://sepolia.era.zksync.dev`); raw responses with sha256. `INTERPRETATION-preflight.md` holds the interpretations, apart from the raw records |
| `integrity/`, `integrity-post/` | earlier evidence unchanged before and after the pre-flight |
| `tools/` | the engineering scripts used |
