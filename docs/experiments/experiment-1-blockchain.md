# Experiment 1: Blockchain deployment and verification

This experiment deploys `CredentialManager` and executes Groth16 proof
verification on Ethereum Sepolia, zkSync Sepolia, or a local Hardhat network.

## Experimental configuration

- Default Merkle-tree depth: 11
- Selected leaf index: 0
- Verification calls per run: 50
- Proof system used on-chain: Groth16
- Required proof directory: `data/groth16-public-proof/`
- Required tree directory: `data/merkle-trees/`

Generate the depth-11 circuits, tree, input, and Groth16 proof before running
this experiment. See the
[artifact-generation pipeline](../setup/artifact-generation.md).

## Ethereum Sepolia

### Deploy

```bash
npx hardhat run scripts/blockchain/deploy_credential_manager.js \
  --network sepolia
```

Example output:

```text
=== Deploy CredentialManager (depth 11) ===
Groth16LegacyVerifierDepth11 deployed to: 0x...
CredentialManager deployed to: 0x...
Added root: ...
```

Deployment result:

```text
results/blockchain/deploy/{timestamp}-deploy-sepolia.csv
```

### Verify

Replace the placeholder with the deployed `CredentialManager` address:

```bash
npx hardhat credential-verification \
  --network sepolia \
  --manager 0xYOUR_CREDENTIAL_MANAGER_ADDRESS \
  --depth 11 \
  --index 0 \
  --iterations 50
```

Verification result:

```text
results/blockchain/{timestamp}-11-50-sepolia.csv
```

## zkSync Sepolia

Contracts on zkSync are deployed through `hre.deployer.deploy()`. The repository
handles this automatically in `deploy_credential_manager.js` when
`zksync: true`.

### Deploy

```bash
npx hardhat run scripts/blockchain/deploy_credential_manager.js \
  --network zkSyncSepolia
```

Deployment result:

```text
results/blockchain/deploy/{timestamp}-deploy-zkSyncSepolia.csv
```

### Verify

```bash
npx hardhat credential-verification \
  --network zkSyncSepolia \
  --manager 0xYOUR_CREDENTIAL_MANAGER_ADDRESS \
  --depth 11 \
  --index 0 \
  --iterations 50
```

Verification result:

```text
results/blockchain/{timestamp}-11-50-zkSyncSepolia.csv
```

Addresses differ by network and deployment. Always use the address printed by
the corresponding deployment command.

## Local Hardhat

Start the local node as described in the
[local Hardhat guide](../setup/local-hardhat.md).

```bash
npx hardhat run scripts/blockchain/deploy_credential_manager.js \
  --network dockerHardhat

npx hardhat credential-verification \
  --network dockerHardhat \
  --manager 0xYOUR_CREDENTIAL_MANAGER_ADDRESS \
  --depth 11 \
  --index 0 \
  --iterations 50
```

## Result columns

The verification CSV files contain:

```text
iteration, gas, gasPrice, latency_ms, status, error
```

## Issuer-access test

The test verifies that `CredentialManager.addRoot` is protected by the
`onlyIssuer` modifier. An account must be granted issuer status through
`setIssuer` before it can register a Merkle root.

Test file:

```text
test/CredentialManager.issuerAccess.js
```

Run:

```bash
npx hardhat test test/CredentialManager.issuerAccess.js
```

## Published artifacts

The published raw measurements and Figure 5 are documented in:

[results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows](../../results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/)
