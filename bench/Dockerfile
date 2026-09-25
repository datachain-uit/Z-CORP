# Z-CORP rerun protocol v3: prover benchmark image (linux/arm64 on the campaign host).
# Base image pinned by digest; dependencies pinned by package-lock.json; no network at run time.
ARG BASE_IMAGE=node:18.20.8-bookworm-slim@sha256:f9ab18e354e6855ae56ef2b290dd225c1e51a564f87584b9bd21dd651838830e
FROM ${BASE_IMAGE}
WORKDIR /opt/zcorp
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY lib ./lib
COPY harness.js preflight.js provenance.js make_schedule.js summarize_prover.js record_controls.js campaign_state.js validate_round.js check_resume_test.js ./
ENV ZCORP_HARNESS_DIR=/opt/zcorp \
    ZCORP_REPO=/work \
    ZCORP_RESULTS=/results \
    NODE_OPTIONS="--require /opt/zcorp/lib/cpu-visibility.js --max-old-space-size=4096"
LABEL org.opencontainers.image.title="zcorp-bench" \
      org.opencontainers.image.description="Z-CORP rerun protocol v3 prover harness" \
      org.opencontainers.image.version="3.0.0"
