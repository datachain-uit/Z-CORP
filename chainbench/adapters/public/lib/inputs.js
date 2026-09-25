'use strict';
// Frozen public inputs (deployment artifacts, depth-11 proof calldata), verified against inputs/INPUTS.sha256 on every load.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function load(repo, binding) {
  const dir = path.join(repo, binding.inputs_dir);
  const man = fs.readFileSync(path.join(dir, 'INPUTS.sha256'), 'utf8');
  const bad = [];
  for (const l of man.trim().split('\n')) { const [h, f] = l.split(/\s+/); if (sha(fs.readFileSync(path.join(dir, f))) !== h) bad.push(f); }
  if (bad.length) throw new Error(`frozen public inputs changed: ${bad.join(', ')}`);
  const identity = JSON.parse(fs.readFileSync(path.join(dir, 'IDENTITY.json'), 'utf8'));
  if (!identity.all_pass) throw new Error('frozen public inputs: IDENTITY.json reports a failed identity check');
  const artifacts = { evm: {}, eravm: {} };
  for (const venue of ['evm', 'eravm']) for (const f of fs.readdirSync(path.join(dir, 'deployment', venue))) { const a = JSON.parse(fs.readFileSync(path.join(dir, 'deployment', venue, f), 'utf8')); artifacts[venue][a.name] = a; }
  const proofs = JSON.parse(fs.readFileSync(path.join(dir, 'proofs', 'd11.json'), 'utf8'));
  return { dir, manifest_sha256: sha(man), artifacts, proofs, proofById: Object.fromEntries(proofs.proofs.map((p) => [p.proof_id, p])), identity_checks: identity.checks.length };
}
module.exports = { load };
