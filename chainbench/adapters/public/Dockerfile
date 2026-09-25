# chainbench public-network adapter image (CSI-CHAIN-PUBLIC-01). Contents: Node from the digest-pinned base image (the same
# base as the frozen L1 and L2 images), git and python3 (provenance, validation, derivation) and the adapter's two npm
# dependencies installed with `npm ci --ignore-scripts` from package-lock.json. No Hardhat, no compiler, no prover, no
# harness code, contracts, inputs or keys: run-public.sh mounts the repository read-only at /repo. Dry runs use
# --network none; live commands get network access and a read-only key mount. Build only through
# ./chainbench/run.sh build-image-public.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
RUN set -eu; apt-get update; apt-get install -y --no-install-recommends git python3; rm -rf /var/lib/apt/lists/*; \
    git config --system --add safe.directory '*'; mkdir -p /opt/chainbench; \
    dpkg-query -W -f='${Package} ${Version}\n' git python3 python3-minimal > /opt/chainbench/APT-PACKAGES.txt
WORKDIR /repo/chainbench/adapters/public
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && npm cache clean --force \
 && node -e "for (const p of ['ethers','zksync-ethers']) console.log(p, require('./node_modules/'+p+'/package.json').version)" > /opt/chainbench/NPM-PACKAGES.txt
