#!/bin/sh
# CSI-CHAIN-LOCAL-01 (CHAIN-PROTOCOL-v1 §11): reproducible build of geth v1.16.9 for the cross-client replay.
# Requirements: Go 1.24.7, git (HTTPS to github.com), python3. No access to proxy.golang.org / sum.golang.org /
# go.googlesource.com is needed: non-GitHub modules are rebuilt from their official GitHub mirrors by mkproxy.py and
# accepted only if their h1 hash equals geth's committed go.sum; Go re-verifies every module against go.sum.
# Output: /tmp/zcorp-geth-v1.16.9/out/geth-v1.16.9-linux-{arm64,amd64}. Expected sha256: SHA256SUMS in this directory.
# The build directory is FIXED: gnark-crypto's assembly #include paths embed the absolute module-cache path in the
# binary despite -trimpath, so byte-identical output requires the same GOMODCACHE path.
set -eu
G=$(cd "$(dirname "$0")" && pwd)
W=/tmp/zcorp-geth-v1.16.9
[ -e "$W" ] && { echo "$W exists; remove it for a from-scratch build"; exit 1; }
mkdir -p "$W" && cd "$W"
[ -d go-ethereum ] || git clone -q --depth 1 --branch v1.16.9 https://github.com/ethereum/go-ethereum.git go-ethereum
test "$(git -C go-ethereum rev-parse HEAD)" = "95665d5703e1023995a0ff93e4ce9eb77e8a59bd"
cp "$G/mkproxy.py" "$W/mkproxy.py" && python3 "$W/mkproxy.py"
cd go-ethereum
COMMIT=$(git rev-parse HEAD); DATE=$(git log -1 --format=%cd --date=format:%Y%m%d)
export GOPROXY="file://$W/goproxy,direct" GOSUMDB=off GOFLAGS=-mod=readonly GOTOOLCHAIN=local CGO_ENABLED=0 GOMODCACHE="$W/gomodcache" GOCACHE="$W/gocache"
go version | grep -q "go1.24.7 " || { echo "Go 1.24.7 required"; exit 1; }
mkdir -p "$W/out"
for ARCH in arm64 amd64; do
  GOOS=linux GOARCH=$ARCH go build -trimpath -buildvcs=false \
    -ldflags "-s -w -X github.com/ethereum/go-ethereum/internal/version.gitCommit=$COMMIT -X github.com/ethereum/go-ethereum/internal/version.gitDate=$DATE" \
    -o "$W/out/geth-v1.16.9-linux-$ARCH" ./cmd/geth
done
cd "$W/out" && sha256sum geth-v1.16.9-linux-arm64 geth-v1.16.9-linux-amd64 | tee SHA256SUMS.built
cmp SHA256SUMS.built "$G/SHA256SUMS" && echo "REPRODUCED: matches committed SHA256SUMS"
