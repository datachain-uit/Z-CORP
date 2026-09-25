#!/usr/bin/env bash
# chainbench local-EraVM (L2) in-container dispatcher (runs inside the chainbench-l2 image; started by
# adapters/eravm/run-l2.sh). Selects the L2 campaign binding; everything else is resolved from the repository at /repo.
set -euo pipefail
cd "$(dirname "$0")/../.."
export CHAINBENCH_CAMPAIGN=CSI-CHAIN-LOCAL-01-L2
A=adapters/eravm
cmd=${1:-}; shift || true
case "$cmd" in compare|validate|smoke-check|make-smoke-ref|summarize|head) ;; *)
  # node_modules comes from the image (anonymous volume populated from the image at container start).
  [ -f node_modules/zksync-ethers/package.json ] || { echo "chainbench-l2 (in container): node_modules is missing or empty; the image volume was not populated. Rebuild with ./chainbench/run.sh build-image-l2." >&2; exit 90; } ;;
esac
case "$cmd" in
  identity)       exec node "$A/scripts/identity_l2.js" "$@" ;;
  doctor)         exec node "$A/doctor/doctor_l2.js" "$@" ;;
  # One container = one complete run; each step is one invocation of the runner (as for L1, A3/A5).
  run)            for s in init build envcheck exec finish; do node "$A/scripts/run_l2.js" --budget-seconds 86400 "$@" --step "$s" || exit $?; done ;;
  validate)       exec python3 "$A/scripts/validate_l2.py" "$@" ;;
  compare)        exec python3 "$A/scripts/compare_l2.py" "$@" ;;
  smoke-check)    exec python3 "$A/scripts/check_smoke_l2.py" "$@" ;;
  make-smoke-ref) exec python3 "$A/scripts/check_smoke_l2.py" --make-reference "$@" ;;
  summarize)      exec python3 "$A/scripts/summarize_l2.py" "$@" ;;
  head)           exec git rev-parse --short=7 HEAD ;;
  *) echo "chainbench-l2 (in container): unknown command '$cmd'" >&2; exit 2 ;;
esac
