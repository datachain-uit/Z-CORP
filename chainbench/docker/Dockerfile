# chainbench local-chain toolchain image (workload- and venue-neutral).
# Contents: Node from a digest-pinned base image, the chainbench npm dependencies installed with `npm ci` from
# chainbench/package-lock.json, git + python3 (provenance and derivation scripts), and a geth binary (official
# ethereum/client-go image, digest-pinned; or the reproducible from-source build). It contains NO harness code,
# contracts or inputs: run.sh mounts the repository read-only at /repo and runs with --network none.
# Build only through ./chainbench/run.sh build-image, which supplies the pinned build arguments. No `# syntax=` line:
# the builder's built-in Dockerfile frontend is used, so no unpinned frontend image is fetched.
ARG BASE_IMAGE
ARG GETH_STAGE=geth-from-source

FROM scratch AS geth-from-source
COPY geth-from-source/ /usr/local/bin/

FROM ${GETH_STAGE} AS geth

FROM ${BASE_IMAGE}
ARG BASE_IMAGE
ARG GETH_STAGE
# git (provenance: blob hashes, clean-tree checks) and python3 (run comparison and summaries) are not on the measured
# path; their exact versions are recorded in /opt/chainbench/APT-PACKAGES.txt and in the image identity.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*' \
 && mkdir -p /opt/chainbench \
 && dpkg-query -W -f='${Package} ${Version}\n' git python3 python3-minimal ca-certificates > /opt/chainbench/APT-PACKAGES.txt
WORKDIR /repo/chainbench
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
 && npm cache clean --force \
 && chmod -R a+rX /repo/chainbench/node_modules
COPY --from=geth /usr/local/bin/geth /opt/geth/geth
RUN /opt/geth/geth version | tee /opt/geth/VERSION.txt
ENV CHAINBENCH_GETH_BIN=/opt/geth/geth \
    HOME=/tmp
LABEL org.opencontainers.image.title="chainbench local L1 toolchain" \
      org.opencontainers.image.description="Hardhat/EDR + solc (npm) + geth for deterministic local EVM gas measurement; no workload code inside" \
      io.chainbench.base-image="${BASE_IMAGE}" \
      io.chainbench.geth-stage="${GETH_STAGE}"
