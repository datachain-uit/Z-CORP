'use strict';
// Matrix and plans (CHAIN-PROTOCOL-v1 §6).
const K = require('./constants');
function cell(profile, backend, depth) {
  const g = backend === 'groth16';
  const bridge = profile === 'bridge';
  return {
    cell_id: `${profile}-${backend}-d${depth}`, profile, backend, depth, partner_depth: K.PARTNER[depth],
    verifier: { source: g ? `contracts/Groth16LegacyVerifierDepth${depth}.sol` : `contracts/chain/PlonkVerifierDepth${depth}.sol`,
      name: g ? `Groth16LegacyVerifierDepth${depth}` : `PlonkVerifierDepth${depth}` },
    manager: bridge ? { source: 'contracts/CredentialManager.sol', name: 'CredentialManager' }
      : { source: g ? 'contracts/chain/CredentialManagerGroth16.sol' : 'contracts/chain/CredentialManagerPlonk.sol', name: g ? 'CredentialManagerGroth16' : 'CredentialManagerPlonk' },
  };
}
const PLANS = {
  full: {
    cells: [...['groth16', 'plonk'].flatMap((b) => K.DEPTHS.map((d) => cell('primary', b, d))), cell('bridge', 'groth16', 11)],
    proofs: [0, 1, 2, 3, 4, 5, 6, 7],
  },
  dry: {
    cells: [cell('primary', 'groth16', 5), cell('primary', 'groth16', 11), cell('primary', 'plonk', 10), cell('primary', 'plonk', 11), cell('bridge', 'groth16', 11)],
    proofs: [0, 1],
  },
};
// Rows per cell: 4 setup tx + 1 precheck call + K verify tx + K verify calls + K direct tx + 7 negative (5 tx + 2 calls)
function expectedRows(plan) { const k = PLANS[plan].proofs.length; return PLANS[plan].cells.length * (4 + 1 + 3 * k + 7); }
module.exports = { PLANS, cell, expectedRows };
