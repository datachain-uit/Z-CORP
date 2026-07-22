# Troubleshooting

| Issue | Likely cause or action |
|---|---|
| `Missing ptau` | Confirm that `pot16_final.ptau` exists in the repository root |
| `Missing merkle_tree_data_depth_N.json` | Run `node scripts/merkletree/prep_full_merkle_all_depths.js` |
| `Missing Plonk zkey` | Run `node scripts/proving/prove_all_depths-plonk.js` first |
| zkSync `isValidRoot` returns `0x` | Deploy through `scripts/blockchain/deploy_credential_manager.js`; do not use a plain `ethers.deploy` workflow |
| Hardhat or zkSync plugin errors | Use Node.js 18.20.8 and Hardhat 2.23.x |
| Depths 14–15 are very slow or cause OOM | Run one depth at a time, for example `--from 14 --to 14` |
| Toolchain container cannot reach Hardhat | Confirm that both containers use `zknet`, the node is named `hardhat-node`, and Hardhat listens on `0.0.0.0` |
| `HH108: Cannot connect to the network localhost` | From the toolchain container, use the configured `dockerHardhat` network rather than container-local `localhost` |
| Public-testnet deployment fails because of balance | Fund the dedicated Sepolia test account and verify that `secret.json` contains that test account's key |

Return to the [documentation index](../README.md).
