#FROM node:18.20.8-bullseye

# Install dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    build-essential \
    pkg-config \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install npm at the pinned version
RUN npm install -g npm@10.8.2

# Install snarkjs at the pinned version
RUN npm install -g snarkjs@0.7.5

# Install Rust
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install circom 2.1.6
RUN git clone https://github.com/iden3/circom.git /opt/circom \
    && cd /opt/circom \
    && git checkout v2.1.6 \
    && cargo build --release \
    && cp target/release/circom /usr/local/bin/circom

WORKDIR /workspace

CMD ["/bin/bash"]