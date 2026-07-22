# Docker environment

## 1. Clone the repository

```bash
git clone https://github.com/datachain-uit/Z-CORP.git
cd Z-CORP
```

## 2. Build the toolchain image

Build the image from the `Dockerfile` in the repository root:

```bash
docker build -t zk-toolchain:node18-circom216 .
```

Rebuild the image whenever the repository's `Dockerfile` or toolchain
dependencies are changed.

## 3. Create the shared network

The shared network is required when the toolchain container communicates with a
separate Hardhat node container.

```bash
docker network inspect zknet >/dev/null 2>&1 || docker network create zknet
```

## 4. Start the toolchain container

```bash
docker run -it --rm \
  --network zknet \
  -v "$PWD":/workspace \
  -w /workspace \
  zk-toolchain:node18-circom216 \
  bash
```

## 5. Install project dependencies

Run inside the container:

```bash
npm install
```

All setup and experiment commands should be executed inside this container from
`/workspace`.

## Compatibility note

Use Node.js 18.20.8 and Hardhat 2.23.x as pinned by the project. Newer Hardhat
major versions may break compatibility with the zkSync plugins used by the
repository.

## Next step

Continue with the [artifact-generation pipeline](artifact-generation.md).
