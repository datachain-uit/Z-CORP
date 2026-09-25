'use strict';
// CHAIN-PROTOCOL-v1 §3: generate and freeze proof set PS-01 (K = 8 proofs per backend x depth in {5,10,11,15}).
// Leaf indices i_j = (2j+1) * 2^(d-4). Outputs only to csi/campaigns/chain/CSI-CHAIN-LOCAL-01/inputs/proofset/.
// Resumable across invocations (the execution environment limits one invocation to ~3 min): items are
// processed in a fixed order into inputs/.proofset-staging/; an item is complete only when its proof has
// verified off-chain, its root matched, and its files and row were written. When all 64 items are complete
// the manifest is written and the staging directory is renamed to inputs/proofset/ (frozen).
// Refuses to run once the frozen proof set exists (a frozen proof is never regenerated).
// Usage: node scripts/gen_proofset.js [--budget-seconds 140]
const fs = require('fs');
const os = require('os');
const path = require('path');
const snarkjs = require('snarkjs');
const C = require('../lib/common');
const K = require('../lib/constants');
const { generateInputForDepth } = require(path.join(C.REPO, 'scripts', 'setup', 'generate_input_depth.js'));
const { merkleTreeDepthFile, processedDiplomasFileForLeafCount } = require(path.join(C.REPO, 'scripts', 'setup', 'paths.js'));

const BACKENDS = ['groth16', 'plonk'];
const TAG = { groth16: 'G16', plonk: 'PLK' };
const arg = (n, dflt) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : dflt; };
const BUDGET_MS = Number(arg('--budget-seconds', '140')) * 1000;
const STAGING = path.join(C.CAMPAIGN_DIR, 'inputs', '.proofset-staging');
const ROWS = path.join(STAGING, '_rows');
function writeAtomic(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p + '.tmp', s); fs.renameSync(p + '.tmp', p); }

function preChecks() {
  const pre = {};
  for (const d of K.DEPTHS) {
    pre[d] = {
      tree: path.relative(C.REPO, merkleTreeDepthFile(d)), tree_sha256: C.sha256File(merkleTreeDepthFile(d)),
      processed: path.relative(C.REPO, processedDiplomasFileForLeafCount(2 ** d)), processed_sha256: C.sha256File(processedDiplomasFileForLeafCount(2 ** d)),
    };
    for (const b of BACKENDS) {
      const a = C.art(b, d);
      pre[d][b] = { zkey: a.zkey, zkey_sha256: C.assertManifest(a.zkey), wasm: a.wasm, wasm_sha256: C.assertManifest(a.wasm),
        vkey: a.vkey, vkey_sha256: C.assertManifest(a.vkey), committed_public: a.committedPublic, committed_public_sha256: C.assertManifest(a.committedPublic),
        committed_root: String(JSON.parse(fs.readFileSync(path.join(C.REPO, a.committedPublic), 'utf8'))[0]) };
    }
    if (pre[d].groth16.committed_root !== pre[d].plonk.committed_root) throw new Error(`committed roots differ at d${d}`);
  }
  return pre;
}
function items() {
  const out = [];
  for (const d of K.DEPTHS) for (let j = 0; j < K.K; j++) for (const b of BACKENDS) out.push({ d, j, b, leaf: K.leafIndex(d, j), id: `${TAG[b]}-d${d}-p${j}` });
  return out;
}

(async () => {
  const t0 = Date.now();
  if (fs.existsSync(C.PROOFSET_DIR)) throw new Error(`proof set already exists (frozen): ${C.PROOFSET_DIR}`);
  const pre = preChecks();
  if (!fs.existsSync(STAGING)) {
    fs.mkdirSync(ROWS, { recursive: true });
    C.writeJson(path.join(STAGING, '_attempt.json'), { started_at_utc: C.nowUtc(), commit: C.gitHead(), protocol_sha256: C.sha256File(path.join(C.REPO, C.PROTOCOL_REL)) });
  }
  const attempt = JSON.parse(fs.readFileSync(path.join(STAGING, '_attempt.json'), 'utf8'));
  const inv = { started_at_utc: C.nowUtc(), node: process.version, done: [] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chainbench-ps-'));
  let lastMs = 0;
  for (const it of items()) {
    if (fs.existsSync(path.join(ROWS, `${it.id}.json`))) continue;
    if (Date.now() - t0 + 1.5 * lastMs > BUDGET_MS) break;
    const s0 = Date.now();
    const p = pre[it.d][it.b];
    const inputFile = path.join(tmp, `input_d${it.d}_i${it.leaf}.json`);
    generateInputForDepth(it.d, it.leaf, { outputFile: inputFile });
    const inputBytes = fs.readFileSync(inputFile);
    const input = JSON.parse(inputBytes);
    if (String(input.root) !== p.committed_root) throw new Error(`DEFECT: input root != committed root ${it.id}`);
    const wtns = path.join(tmp, `${it.id}.wtns`);
    await snarkjs.wtns.calculate(input, path.join(C.REPO, p.wasm), wtns);
    const { proof, publicSignals } = await snarkjs[it.b].prove(path.join(C.REPO, p.zkey), wtns);
    const vkeyObj = JSON.parse(fs.readFileSync(path.join(C.REPO, p.vkey), 'utf8'));
    const ok = await snarkjs[it.b].verify(vkeyObj, publicSignals, proof);
    const rootOk = publicSignals.length === 1 && String(publicSignals[0]) === p.committed_root;
    if (!ok || !rootOk) throw new Error(`DEFECT: ${it.id} leaf ${it.leaf} verify=${ok} root=${rootOk} (stop; protocol §3.3)`);
    const rel = `${it.b}/d${it.d}`;
    const proofRel = `${rel}/p${it.j}.proof.json`; const pubRel = `${rel}/p${it.j}.public.json`;
    writeAtomic(path.join(STAGING, proofRel), JSON.stringify(proof, null, 2) + '\n');
    writeAtomic(path.join(STAGING, pubRel), JSON.stringify(publicSignals, null, 2) + '\n');
    const row = {
      backend: it.b, depth: it.d, j: it.j, proof_id: it.id, leaf_index: it.leaf, root: p.committed_root,
      proof_file: proofRel, proof_sha256: C.sha256File(path.join(STAGING, proofRel)),
      public_file: pubRel, public_sha256: C.sha256File(path.join(STAGING, pubRel)),
      input_sha256: C.sha256Buf(inputBytes), zkey_sha256: p.zkey_sha256, vkey_sha256: p.vkey_sha256, wasm_sha256: p.wasm_sha256,
      verified_offchain: 1, root_matches_committed: 1, generated_at_utc: C.nowUtc(), prove_wall_ms_engineering: Date.now() - s0,
    };
    writeAtomic(path.join(ROWS, `${it.id}.json`), JSON.stringify(row) + '\n');
    fs.rmSync(wtns, { force: true }); fs.rmSync(inputFile, { force: true });
    lastMs = Date.now() - s0;
    inv.done.push(it.id);
    console.log(JSON.stringify({ proof_id: it.id, leaf: it.leaf, ok, rootOk, ms: lastMs }));
  }
  inv.finished_at_utc = C.nowUtc();
  fs.appendFileSync(path.join(STAGING, '_invocations.jsonl'), JSON.stringify(inv) + '\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  const all = items();
  const remaining = all.filter((it) => !fs.existsSync(path.join(ROWS, `${it.id}.json`))).length;
  if (remaining > 0) { console.log('PROOFSET_PENDING', remaining); if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate(); process.exit(0); }
  // Assemble and freeze.
  const rows = all.map((it) => JSON.parse(fs.readFileSync(path.join(ROWS, `${it.id}.json`), 'utf8')));
  for (const r of rows) {
    if (C.sha256File(path.join(STAGING, r.proof_file)) !== r.proof_sha256 || C.sha256File(path.join(STAGING, r.public_file)) !== r.public_sha256) throw new Error(`file changed: ${r.proof_id}`);
  }
  const cols = Object.keys(rows[0]);
  fs.writeFileSync(path.join(STAGING, 'PROOFSET.csv'), [cols.join(','), ...rows.map((r) => cols.map((c) => String(r[c])).join(','))].join('\n') + '\n');
  fs.writeFileSync(path.join(STAGING, 'PROOFSET.sha256'), rows.flatMap((r) => [`${r.proof_sha256}  ${r.proof_file}`, `${r.public_sha256}  ${r.public_file}`]).join('\n') + '\n');
  const invocations = fs.readFileSync(path.join(STAGING, '_invocations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  C.writeJson(path.join(STAGING, 'PROOFSET.json'), {
    proofset: 'PS-01', campaign: C.CAMPAIGN_ID, protocol: C.PROTOCOL_REL, protocol_sha256: attempt.protocol_sha256,
    rule: 'i_j = (2j+1) * 2^(d-4), j = 0..7; same indices for both backends', depths: K.DEPTHS, k: K.K, backends: BACKENDS,
    count: rows.length, started_at_utc: attempt.started_at_utc, finished_at_utc: C.nowUtc(), commit_at_start: attempt.commit,
    environment: { node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpus: os.cpus().length,
      snarkjs: C.pkgVersion('snarkjs'), ffjavascript: C.pkgVersion('ffjavascript'), generator: 'chainbench/scripts/gen_proofset.js' },
    invocations, artifacts: pre,
    note: 'prove_wall_ms_engineering is an engineering log value, not a measurement. Circuit inputs are not stored (input_sha256 only).',
    csv_sha256: C.sha256File(path.join(STAGING, 'PROOFSET.csv')), sha256_file_sha256: C.sha256File(path.join(STAGING, 'PROOFSET.sha256')),
  });
  fs.rmSync(ROWS, { recursive: true }); fs.rmSync(path.join(STAGING, '_invocations.jsonl')); fs.rmSync(path.join(STAGING, '_attempt.json'));
  fs.renameSync(STAGING, C.PROOFSET_DIR);
  console.log('PROOFSET_FROZEN', rows.length);
  if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
