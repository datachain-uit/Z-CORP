'use strict';
// Local-EraVM matrix and plans (CHAIN-PROTOCOL-v1 §16.4). Cells, contracts and depths come from the workload
// (lib/plan.js cell(), lib/constants.js DEPTHS); only primary-profile cells exist on EraVM (no bridge cell).
const W = require('../../../core/workload');
const K = W.module('constants');
const { cell } = W.module('plan');
const P = W.module('profiles');
const BACKENDS = ['groth16', 'plonk'];
const PLANS = {
  // Packaging smoke test (smoke-l2): NOT scientific data.
  smoke: { scientific: false, cells: [cell('primary', 'groth16', 5), cell('primary', 'plonk', 10)], proofs: [0] },
  // Reduced engineering dry run (dry-run-l2): NOT scientific data.
  dry: { scientific: false, cells: [cell('primary', 'groth16', 5), cell('primary', 'groth16', 11), cell('primary', 'plonk', 10), cell('primary', 'plonk', 11)], proofs: [0, 1] },
  // Scientific matrix (full-local-l2): 2 backends x 4 depths, K proofs.
  full: { scientific: true, cells: BACKENDS.flatMap((b) => K.DEPTHS.map((d) => cell('primary', b, d))), proofs: [...Array(K.K).keys()] },
};
// The same source set as the L1 primary profile: all 3 managers and all 22 verifiers (depths 5..15).
const COMPILE_FILES = P.PROFILES.primary.files;
// Rows per cell, as in §7: 4 setup tx + 1 precheck call + K verify tx + K verify calls + K direct tx + 7 negative (5 tx + 2 calls).
function expectedRows(plan) { const k = PLANS[plan].proofs.length; return PLANS[plan].cells.length * (4 + 1 + 3 * k + 7); }
function expectedTx(plan) { const k = PLANS[plan].proofs.length; return PLANS[plan].cells.length * (4 + 2 * k + 5); }
module.exports = { PLANS, COMPILE_FILES, expectedRows, expectedTx };
