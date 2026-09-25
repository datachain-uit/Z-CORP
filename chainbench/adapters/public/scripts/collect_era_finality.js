'use strict';
// Post-hoc ZKsync Era batch lifecycle (CHAIN-PUBLIC-PROTOCOL-v1 section 10). Read-only; no key, no transaction.
// For every Era row that has a transaction hash it records the current receipt (post hoc; the row's own state is never
// changed), zks_getTransactionDetails and zks_getL1BatchDetails of the receipt's L1 batch: commit, prove and execute times
// and transactions where the endpoint reports them. Kept separate from receipt latency; receipt latency is not finality.
// Live mode requires the frozen public image (verified by ./chainbench/run.sh; lib/imageid.js) and the frozen Era endpoint
// (lib/endpoints.js; a secondary only under a recorded deviation), like the runner; both are recorded.
//   node collect_era_finality.js --mode live|dry --root <out root> [--runs <run dir> ...]
process.env.CHAINBENCH_CAMPAIGN = process.env.CHAINBENCH_CAMPAIGN || 'CSI-CHAIN-PUBLIC-01';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CB = path.resolve(__dirname, '..', '..', '..');
const REPO = path.resolve(CB, '..');
const W = require(path.join(CB, 'core', 'workload.js'));
const { Refusal, profile, checkChainId } = require('../lib/networks');
const { Rpc } = require('../lib/rpc');
const { now } = require('../lib/clock');
const { stable } = require('../lib/recorder');
const IMG = require('../lib/imageid');
const EP = require('../lib/endpoints');
const B = W.campaign;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
function die(code, msg) { console.error(`[REFUSED] ${code}: ${msg}`); process.exit(3); }

async function main() {
  const mode = arg('--mode'); const root = path.resolve(REPO, arg('--root') || B.out_roots[mode || 'live']);
  if (!['live', 'dry'].includes(mode)) { console.error('usage: collect_era_finality.js --mode live|dry --root DIR [--runs DIR ...]'); process.exit(2); }
  let image = IMG.fromEnv();
  if (mode === 'live') { try { image = IMG.verifyLive(); } catch (e) { if (e instanceof Refusal) die(e.code, e.message); throw e; } }
  let runs = [];
  const ri = argv.indexOf('--runs');
  if (ri >= 0) runs = argv.slice(ri + 1).filter((x) => !x.startsWith('--')).map((x) => path.resolve(REPO, x));
  else runs = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'tx.jsonl'))).map((d) => path.join(root, d));
  const rows = [];
  for (const d of runs) for (const l of fs.readFileSync(path.join(d, 'tx.jsonl'), 'utf8').trim().split('\n')) { if (!l) continue; const r = JSON.parse(l); if (r.network === 'era-sepolia' && r.tx_hash && r.mode === mode) rows.push(r); }
  const prof = profile(B, 'era-sepolia');
  const url = process.env.CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA || (mode === 'live' ? B.endpoints.public_defaults['era-sepolia'] : null);
  if (!url) die('no_endpoint', 'set CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA');
  let rpc;
  try {
    rpc = new Rpc(url, { label: process.env.CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA || '', mode, timeoutMs: B.timing.rpc_timeout_ms, publicUrls: Object.values(B.endpoints.public_defaults) });
    if (mode === 'live') EP.apply(B, 'era-sepolia', rpc, process.env.CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA, { deviation: process.env.CHAINBENCH_PUBLIC_DEVIATION });
  } catch (e) { if (e instanceof Refusal) die(e.code, e.message); throw e; }
  const started = now();
  try { checkChainId(B, prof, await rpc.call('eth_chainId')); } catch (e) { if (e instanceof Refusal) die(e.code, e.message); die('chain_id_unavailable', e.message); }
  const raw = async (method, params) => { try { const r = await rpc.request(method, params); return { ok: true, t_response_utc: r.t_res.utc, response_raw: r.raw, result: r.result }; } catch (e) { return { ok: false, error_kind: e.kind || 'error', error_message: String(e.message).slice(0, 200) }; } };
  const out = []; const batches = {};
  for (const r of rows) {
    const rc = await raw('eth_getTransactionReceipt', [r.tx_hash]);
    const det = await raw('zks_getTransactionDetails', [r.tx_hash]);
    const bn = rc.ok && rc.result && rc.result.l1BatchNumber !== null && rc.result.l1BatchNumber !== undefined ? Number(BigInt(rc.result.l1BatchNumber)) : null;
    if (bn !== null && !batches[bn]) batches[bn] = await raw('zks_getL1BatchDetails', [bn]);
    const bd = bn !== null && batches[bn].ok ? batches[bn].result : null;
    const delay = (iso) => (iso && r.t_receipt_utc ? +((Date.parse(iso) - Date.parse(r.t_receipt_utc)) / 1000).toFixed(3) : '');
    out.push({ run_id: r.run_id, schedule_id: r.schedule_id, session_id: r.session_id, op: r.op, backend: r.backend, proof_id: r.proof_id, tx_hash: r.tx_hash, row_state: r.state,
      t_receipt_utc: r.t_receipt_utc, receipt_now: rc.ok ? (rc.result ? 'present' : 'absent') : `error:${rc.error_kind}`, l1_batch_number: bn === null ? '' : bn,
      batch_status: bd ? bd.status || '' : '', committed_at: bd ? bd.committedAt || '' : '', proven_at: bd ? bd.provenAt || '' : '', executed_at: bd ? bd.executedAt || '' : '',
      commit_tx_hash: bd ? bd.commitTxHash || '' : '', prove_tx_hash: bd ? bd.proveTxHash || '' : '', execute_tx_hash: bd ? bd.executeTxHash || '' : '',
      commit_chain_id: bd && bd.commitChainId !== undefined ? bd.commitChainId : '', execute_chain_id: bd && bd.executeChainId !== undefined ? bd.executeChainId : '',
      receipt_to_commit_s: bd ? delay(bd.committedAt) : '', receipt_to_prove_s: bd ? delay(bd.provenAt) : '', receipt_to_execute_s: bd ? delay(bd.executedAt) : '',
      tx_details_status: det.ok && det.result ? det.result.status || '' : '', raw: { receipt: rc, tx_details: det } });
  }
  const finished = now();
  const id = `finality-${mode}-${started.utc.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
  const dir = path.join(root, 'FINALITY', id);
  fs.mkdirSync(dir, { recursive: true });
  const rec = { kind: 'era-batch-lifecycle', collection_id: id, mode, endpoint: rpc.identity, image, deviation: process.env.CHAINBENCH_PUBLIC_DEVIATION || null, started_utc: started.utc, finished_utc: finished.utc, runs: runs.map((d) => path.relative(REPO, d)),
    transactions: out, batches: Object.fromEntries(Object.entries(batches).map(([k, v]) => [k, { ok: v.ok, t_response_utc: v.t_response_utc || null, response_raw: v.response_raw || null, response_sha256: v.response_raw ? sha(v.response_raw) : null, error: v.ok ? null : v.error_kind }])),
    note: 'post-hoc read-only observation; receipt latency and batch lifecycle are separate quantities; nothing here changes a transaction row' };
  fs.writeFileSync(path.join(dir, 'finality.json'), JSON.stringify(stable(rec), null, 2) + '\n');
  const cols = Object.keys(out[0] || { run_id: '' }).filter((k) => k !== 'raw');
  const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  fs.writeFileSync(path.join(dir, 'finality.csv'), [cols.join(','), ...out.map((o) => cols.map((c) => cell(o[c])).join(','))].join('\n') + '\n');
  console.log(`FINALITY ${id}: ${out.length} Era transactions, ${Object.keys(batches).length} batches -> ${path.relative(REPO, dir)}`);
}
main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
