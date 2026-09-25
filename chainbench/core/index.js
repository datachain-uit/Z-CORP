'use strict';
// Reusable, workload- and venue-neutral parts of chainbench (see core/README.md).
// Workload-specific parts (plan, cell procedure, inputs, compile profiles, constants) are resolved through
// core/workload.js from workloads/<name>/workload.json.
module.exports = {
  workload: require('./workload'),        // workload + campaign binding, module resolution
  rpc: require('../lib/rpc'),             // JSON-RPC access: in-process EDR or HTTP (geth); revert-data extraction; receipts
  geth: require('../lib/geth'),           // fresh in-memory `geth --dev` per cell; funding of test accounts
  envcheck: require('../lib/envcheck'),   // behavioural hardfork markers (Osaka: P256VERIFY, CLZ, EIP-7825 cap)
  gas: require('../lib/gas'),             // calldata tokens, intrinsic/floor/create gas, execution-gas derivation
  schema: require('../lib/schema'),       // raw row schema and CSV writer
  build: require('../lib/build'),         // fresh-directory staging + compilation + build manifest
  common: require('../lib/common'),       // hashing, canonical JSON, git state, artifact manifest checks
};
// Scripts (not modules): scripts/run_l1.js (run orchestration: init/build/envcheck/exec/finish),
// scripts/env_check.js, scripts/compare_runs.py (determinism and cross-client comparison),
// docker/identity.js (toolchain identity), doctor/doctor.js (pre-flight checks).
