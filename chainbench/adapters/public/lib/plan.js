'use strict';
// The 40-transaction matrix (CHAIN-PUBLIC-PROTOCOL-v1 section 4), built deterministically from the campaign binding and the
// workload procedure: 16 setup transactions (2 networks x 2 backends x 4 operations) and 24 verification transactions
// (3 sessions x 2 networks x 2 backends x 2 frozen proofs). Within each session and network the backends alternate in an
// order fixed by a seed; each backend uses both frozen proofs; the network order alternates across sessions.
const crypto = require('crypto');
function seedBits(seed, session, network) { return crypto.createHash('sha256').update(`${seed}|${session}|${network}`).digest()[0]; }
function setup(binding, proc, network) {
  const net = binding.networks[network];
  const ops = [];
  for (const backend of proc.backends) {
    for (const s of proc.setup) {
      ops.push({ phase: 'setup', session_id: 'SETUP', network, block_id: `SETUP-${net.short}`, block_position: ops.length + 1, pair_id: '',
        schedule_id: `SETUP-${net.short}-${String(ops.length + 1).padStart(2, '0')}`, op: s.op, backend, depth: proc.depth, proof_id: '', step: s });
    }
  }
  return ops;
}
function block(binding, proc, session, network) {
  const net = binding.networks[network];
  const bits = seedBits(binding.schedule_seed, session, network);
  const first = bits & 1 ? 'plonk' : 'groth16';
  const second = first === 'groth16' ? 'plonk' : 'groth16';
  const order = (backend, flip) => (flip ? [...binding.proofs[backend]].reverse() : [...binding.proofs[backend]]);
  const pr = { groth16: order('groth16', (bits >> 1) & 1), plonk: order('plonk', (bits >> 2) & 1) };
  const seq = [[first, pr[first][0]], [second, pr[second][0]], [first, pr[first][1]], [second, pr[second][1]]];
  return seq.map(([backend, proof_id], i) => ({ phase: 'verification', session_id: session, network, block_id: `${session}-${net.short}`,
    block_position: i + 1, pair_id: `${session}-${net.short}-P${Math.floor(i / 2) + 1}`, schedule_id: `${session}-${net.short}-${i + 1}`,
    op: proc.verification.op, backend, depth: proc.depth, proof_id, step: proc.verification, seed_byte: bits }));
}
function session(binding, proc, sessionId) {
  const s = binding.sessions.find((x) => x.id === sessionId);
  if (!s) throw new Error(`unknown session ${sessionId} (expected ${binding.sessions.map((x) => x.id).join(', ')})`);
  return s.network_order.map((network) => ({ network, ops: block(binding, proc, sessionId, network) }));
}
function schedule(binding, proc) {
  const out = { setup: {}, sessions: [] };
  for (const n of Object.keys(binding.networks)) out.setup[n] = setup(binding, proc, n).map(({ step, ...o }) => o);
  for (const s of binding.sessions) out.sessions.push({ id: s.id, scheduled_start_utc: s.scheduled_start_utc, network_order: s.network_order,
    blocks: session(binding, proc, s.id).map((b) => ({ network: b.network, ops: b.ops.map(({ step, ...o }) => o) })) });
  const n = Object.values(out.setup).reduce((a, v) => a + v.length, 0) + out.sessions.reduce((a, s) => a + s.blocks.reduce((b, x) => b + x.ops.length, 0), 0);
  out.total_transactions = n;
  return out;
}
module.exports = { setup, block, session, schedule };
