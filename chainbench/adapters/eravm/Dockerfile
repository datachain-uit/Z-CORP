# chainbench local-EraVM (L2) toolchain image (workload- and venue-neutral).
# Contents: Node from the digest-pinned base image (the same base as the L1 image), the adapter's npm dependencies
# installed with `npm ci` from adapters/eravm/package-lock.json, git + python3 (provenance, validation, comparison), and
# three official release binaries accepted only by sha256 (adapters/eravm/pins.env): anvil-zksync 0.6.11, zksolc 1.5.15,
# era-solc 0.8.20-1.0.2. It contains NO harness code, contracts or inputs: run-l2.sh mounts the repository read-only at
# /repo and runs every container with --network none. Build only through ./chainbench/run.sh build-image-l2, which
# supplies the pinned build arguments. No `# syntax=` line: the builder's built-in Dockerfile frontend is used.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG BASE_IMAGE
ARG ERAVM_ARCH
COPY pins.env /opt/eravm/pins.env
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends git python3 ca-certificates curl; \
    [ "$(dpkg --print-architecture)" = "${ERAVM_ARCH}" ] || { echo "platform is $(dpkg --print-architecture), expected ${ERAVM_ARCH}"; exit 1; }; \
    . /opt/eravm/pins.env; \
    case "${ERAVM_ARCH}" in \
      arm64) A_URL=$ANVIL_ZKSYNC_URL_ARM64; A_TGZ=$ANVIL_ZKSYNC_TGZ_SHA256_ARM64; A_BIN=$ANVIL_ZKSYNC_BIN_SHA256_ARM64; \
             Z_URL=$ZKSOLC_URL_ARM64; Z_SHA=$ZKSOLC_SHA256_ARM64; S_URL=$ERA_SOLC_URL_ARM64; S_SHA=$ERA_SOLC_SHA256_ARM64 ;; \
      amd64) A_URL=$ANVIL_ZKSYNC_URL_AMD64; A_TGZ=$ANVIL_ZKSYNC_TGZ_SHA256_AMD64; A_BIN=$ANVIL_ZKSYNC_BIN_SHA256_AMD64; \
             Z_URL=$ZKSOLC_URL_AMD64; Z_SHA=$ZKSOLC_SHA256_AMD64; S_URL=$ERA_SOLC_URL_AMD64; S_SHA=$ERA_SOLC_SHA256_AMD64 ;; \
      *) echo "unsupported architecture ${ERAVM_ARCH}"; exit 1 ;; \
    esac; \
    mkdir -p /opt/eravm/bin /tmp/eravm-dl; \
    curl -fsSL --retry 3 -o /tmp/eravm-dl/anvil.tgz "$A_URL"; echo "$A_TGZ  /tmp/eravm-dl/anvil.tgz" | sha256sum -c -; \
    tar -xzf /tmp/eravm-dl/anvil.tgz -C /opt/eravm/bin anvil-zksync; echo "$A_BIN  /opt/eravm/bin/anvil-zksync" | sha256sum -c -; \
    curl -fsSL --retry 3 -o /opt/eravm/bin/zksolc "$Z_URL"; echo "$Z_SHA  /opt/eravm/bin/zksolc" | sha256sum -c -; \
    curl -fsSL --retry 3 -o /opt/eravm/bin/solc "$S_URL"; echo "$S_SHA  /opt/eravm/bin/solc" | sha256sum -c -; \
    chown root:root /opt/eravm/bin/*; chmod 755 /opt/eravm/bin/*; rm -rf /tmp/eravm-dl; \
    apt-get purge -y --auto-remove curl; rm -rf /var/lib/apt/lists/*; \
    git config --system --add safe.directory '*'; \
    mkdir -p /opt/chainbench; \
    dpkg-query -W -f='${Package} ${Version}\n' git python3 python3-minimal ca-certificates > /opt/chainbench/APT-PACKAGES.txt; \
    { /opt/eravm/bin/anvil-zksync --version; /opt/eravm/bin/zksolc --version; /opt/eravm/bin/solc --version | tail -n +2; } > /opt/eravm/VERSIONS.txt; \
    cat /opt/eravm/VERSIONS.txt
WORKDIR /repo/chainbench
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
 && npm cache clean --force \
 && chmod -R a+rX /repo/chainbench/node_modules
ENV CHAINBENCH_ANVIL_ZKSYNC_BIN=/opt/eravm/bin/anvil-zksync \
    CHAINBENCH_ZKSOLC_BIN=/opt/eravm/bin/zksolc \
    CHAINBENCH_ERA_SOLC_BIN=/opt/eravm/bin/solc \
    HOME=/tmp
LABEL org.opencontainers.image.title="chainbench local EraVM toolchain" \
      org.opencontainers.image.description="anvil-zksync 0.6.11 + zksolc 1.5.15 + era-solc 0.8.20-1.0.2 (sha256-pinned) + npm deps for deterministic local EraVM measurement; no workload code inside" \
      io.chainbench.base-image="${BASE_IMAGE}" \
      io.chainbench.eravm-arch="${ERAVM_ARCH}"
