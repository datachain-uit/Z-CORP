# Local Hardhat network

Use the local network when Ethereum Sepolia or zkSync Sepolia is not required,
or when no funded testnet wallet is available.

Both containers must join the `zknet` Docker network.

## 1. Create the shared network

```bash
docker network inspect zknet >/dev/null 2>&1 || docker network create zknet
```

## 2. Start the Hardhat node

Run this command in the first terminal from the repository root:

```bash
docker run -it --rm \
  --network zknet \
  --name hardhat-node \
  -v "$PWD":/workspace \
  -w /workspace \
  node:18.20.8-bullseye \
  npx hardhat node --hostname 0.0.0.0
```

The Hardhat node must listen on `0.0.0.0` so that the toolchain container can
reach it.

## 3. Start the toolchain container

Run this command in a second terminal:

```bash
docker run -it --rm \
  --network zknet \
  -v "$PWD":/workspace \
  -w /workspace \
  zk-toolchain:node18-circom216 \
  bash
```

Inside the toolchain container:

```bash
npm install
```

`hardhat.config.js` maps the `dockerHardhat` network to:

```text
http://hardhat-node:8545
```

## 4. Deploy locally

```bash
npx hardhat run scripts/blockchain/deploy_credential_manager.js \
  --network dockerHardhat
```

## 5. Run verification locally

Replace the placeholder with the address printed by the deployment command:

```bash
npx hardhat credential-verification \
  --network dockerHardhat \
  --manager 0xYOUR_CREDENTIAL_MANAGER_ADDRESS \
  --depth 11 \
  --index 0 \
  --iterations 50
```

The blockchain experiment also requires the depth-11 Groth16 proof and Merkle
root. Generate them first by following the
[artifact-generation pipeline](artifact-generation.md).
