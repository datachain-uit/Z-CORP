# geth v1.16.9 for the cross-client replay (CSI-CHAIN-LOCAL-01, CHAIN-PROTOCOL-v1 §11)

`geth --dev` replays the L1 operation set. That checks the EDR (Hardhat) results against a production execution client under the same Osaka rules.

| Item | Value |
|---|---|
| Source | https://github.com/ethereum/go-ethereum, tag `v1.16.9`, commit `95665d5703e1023995a0ff93e4ce9eb77e8a59bd` |
| Toolchain | Go 1.24.7, `CGO_ENABLED=0`, `-trimpath -buildvcs=false -ldflags "-s -w"`, plus the version stamp |
| Targets | linux/arm64 (used on the campaign VM) and linux/amd64 |
| Expected sha256 | `SHA256SUMS` |
| Dev-mode forks | Through Osaka (`params.AllDevChainProtocolChanges`: `OsakaTime = 0`, no later fork) |

## Module integrity

- **The problem.** The build environment cannot reach `proxy.golang.org`, `sum.golang.org` or `go.googlesource.com`.
- **The fix.** `mkproxy.py` builds a file-based GOPROXY for every non-GitHub module version that geth's `go.sum` names (`golang.org/x/*`, `google.golang.org/protobuf`, `gopkg.in/*`, `go.uber.org/*`) from their official GitHub mirrors.
- **The check.** A module's `.zip` and `.mod` are accepted only if their `h1:` dirhash equals the entry in geth's committed `go.sum`: 129 of 129 matched. GitHub-hosted modules are fetched directly with git.
- **Go's own verification.** With `GOSUMDB=off`, Go still verifies every module against `go.sum`, and `-mod=readonly` rejects any missing entry.

## Reproducibility

- **Fixed build directory.** `build_geth.sh` builds in `/tmp/zcorp-geth-v1.16.9`. gnark-crypto's assembly `#include` paths embed the absolute module-cache path in the binary despite `-trimpath`, so byte-identical output requires this path.
- **Verified.** Two from-scratch builds with this recipe produced identical binaries (the `SHA256SUMS` values).
- **Not versioned.** The binaries are not in git. The arm64 binary used on the campaign VM is kept xz-compressed under `build/chain/geth/`, which is git-ignored, and is archived with the campaign release.

## Use in the chainbench image

`chainbench/run.sh build-image` prefers the official `ethereum/client-go:v1.16.9` image. It pins the image by digest in `chainbench/docker/pins.env` and accepts it only if `geth version` reports `Git Commit: 95665d5703e1023995a0ff93e4ce9eb77e8a59bd`.

If the official image is unavailable or fails that check, the build uses this from-source binary. The binary must be uncompressed at `build/chain/geth/geth-v1.16.9-linux-<arch>` and match the sha256 in `SHA256SUMS`, which is also in `pins.env`.

The source actually used is recorded in `chainbench/docker/IMAGE.json` (`toolchain.geth`) and in every run's `environment.json` (`container.geth_source`, `geth.sha256`).
