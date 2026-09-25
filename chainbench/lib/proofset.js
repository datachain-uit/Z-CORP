'use strict';
// Load and verify the frozen proof set PS-01 and build backend-native calldata arguments (CHAIN-PROTOCOL-v1 §3, §7).
const fs = require('fs');
const path = require('path');
const snarkjs = require('snarkjs');
const C = require('./common');
const K = require('./constants');
const TAG = { groth16: 'G16', plonk: 'PLK' };
function hex32(x) { return '0x' + BigInt(x).toString(16).padStart(64, '0'); }
async function load() {
  const dir = C.PROOFSET_DIR;
  const lines = fs.readFileSync(path.join(dir, 'PROOFSET.sha256'), 'utf8').trim().split('\n');
  for (const l of lines) { const [h, f] = l.split(/\s+/); if (C.sha256File(path.join(dir, f)) !== h) throw new Error(`proof set file changed: ${f}`); }
  const csv = fs.readFileSync(path.join(dir, 'PROOFSET.csv'), 'utf8').trim().split('\n');
  const cols = csv[0].split(',');
  const rows = csv.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
  const byId = Object.fromEntries(rows.map((r) => [r.proof_id, r]));
  const cache = {};
  async function get(backend, depth, j) {
    const id = `${TAG[backend]}-d${depth}-p${j}`;
    if (cache[id]) return cache[id];
    const r = byId[id]; if (!r) throw new Error(`no proof ${id}`);
    const proof = JSON.parse(fs.readFileSync(path.join(dir, r.proof_file), 'utf8'));
    const pub = JSON.parse(fs.readFileSync(path.join(dir, r.public_file), 'utf8'));
    let args;
    if (backend === 'groth16') args = JSON.parse('[' + (await snarkjs.groth16.exportSolidityCallData(proof, pub)) + ']');
    else args = JSON.parse('[' + (await snarkjs.plonk.exportSolidityCallData(proof, pub)).replace('][', '],[') + ']');
    return (cache[id] = { id, backend, depth, j, leaf_index: Number(r.leaf_index), root: BigInt(pub[0]), args });
  }
  return {
    get, rows,
    manifest: { csv_sha256: C.sha256File(path.join(dir, 'PROOFSET.csv')), sha256_file_sha256: C.sha256File(path.join(dir, 'PROOFSET.sha256')), json_sha256: C.sha256File(path.join(dir, 'PROOFSET.json')), files_verified: lines.length },
  };
}
// Tamper rule (§7.1): last word w of the proof vector -> w+1 if w+1 < m else w-1.
function tamper(backend, args) {
  const a = JSON.parse(JSON.stringify(args));
  if (backend === 'groth16') { const w = BigInt(a[2][1]); a[2][1] = hex32(w + 1n < K.BN254_Q ? w + 1n : w - 1n); }
  else { const w = BigInt(a[0][23]); a[0][23] = hex32(w + 1n < K.BN254_R ? w + 1n : w - 1n); }
  return a;
}
module.exports = { load, tamper, hex32, TAG };
