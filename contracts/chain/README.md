# contracts/chain (CSI-CHAIN-LOCAL-01, CHAIN-PROTOCOL-v1)

| File | Origin |
|---|---|
| `CredentialManagerBase.sol` | Hand-written. Issuer and root registry, with the semantics of `contracts/CredentialManager.sol` and no `hardhat/console.sol`. |
| `CredentialManagerGroth16.sol` | Hand-written. `verifyCredential(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[1] input)` |
| `CredentialManagerPlonk.sol` | Hand-written. `verifyCredential(uint256[24] proof, uint256[1] input)` |
| `PlonkVerifierDepth{5..15}.sol` | **Generated. Do not edit.** Produced by `chainbench/scripts/export_plonk_verifiers.js`, which calls snarkjs 0.7.5 `zKey.exportSolidityVerifier` on `data/plonk-zkeys/*`. The only change is the contract name. Provenance: `csi/campaigns/chain/CSI-CHAIN-LOCAL-01/inputs/plonk-verifiers.provenance.json`. |

- The Groth16 verifiers are the existing, manifest-covered `contracts/Groth16LegacyVerifierDepth{d}.sol`.
- `contracts/CredentialManager.sol` is historical: it is kept unchanged and is used only in the July bridge cell.
