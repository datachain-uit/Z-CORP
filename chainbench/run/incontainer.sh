#!/usr/bin/env bash
# chainbench in-container dispatcher (runs inside the toolchain image; started by chainbench/run.sh).
# Workload- and venue-neutral: workload-specific scripts are resolved through core/workload.js.
set -euo pipefail
cd "$(dirname "$0")/.."
cmd=${1:-}; shift || true
wscript() { node core/workload.js "$1"; }
case "$cmd" in compare|smoke-check|head) ;; *)
  # node_modules comes from the image (anonymous volume populated from the image at container start).
  [ -f node_modules/hardhat/package.json ] || { echo "chainbench (in container): node_modules is missing or empty; the image volume was not populated. Rebuild with ./chainbench/run.sh build-image." >&2; exit 90; } ;;
esac
case "$cmd" in
  identity)       exec node docker/identity.js "$@" ;;
  doctor)         exec node doctor/doctor.js "$@" ;;
  unit-tests)     exec node "$(wscript unit_tests)" ;;
  # One container = one complete run: no per-call time budget (the step budget exists for time-limited shells).
  run)            exec node scripts/run_l1.js --budget-seconds 86400 "$@" ;;
  compare)        exec python3 scripts/compare_runs.py "$@" ;;
  summarize)      exec python3 "$(wscript summarize)" "$@" ;;
  smoke-check)    exec python3 smoke/check_smoke.py "$@" ;;
  verifier-check) exec node "$(wscript verifier_check)" --check-only ;;
  workload)       exec node core/workload.js --json ;;
  sources)        exec node core/sources.js ;;
  head)           exec git rev-parse --short=7 HEAD ;;
  smoke-ref)      exec node -e "console.log(require('./core/workload').workload.smoke_reference)" ;;
  dry-ref)        exec node -e "const r=require('./core/workload').campaign.reference_dry_run||{};console.log((r[process.argv[1]]||''))" "${1:-edr}" ;;
  *) echo "chainbench (in container): unknown command '$cmd'" >&2; exit 2 ;;
esac
