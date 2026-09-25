'use strict';
// CSI-CHAIN-PUBLIC-01 public-network runner (CHAIN-PUBLIC-PROTOCOL-v1). Venue-neutral adapter; the campaign binding and
// the workload procedure say what to deploy and call.
//   node run_public.js --mode live|dry --phase setup --network sepolia|era-sepolia [--confirm setup-<network>]
//   node run_public.js --mode live|dry --phase session --session S1|S2|S3 [--confirm <session>]
// Live mode sends real transactions to the configured public endpoints and needs --confirm; dry mode accepts only
// http://127.0.0.1 endpoints (the mock of dry_run_public.js). Endpoints: CHAINBENCH_PUBLIC_RPC_SEPOLIA,
// CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA (+ _LABEL_). Key: CHAINBENCH_PUBLIC_KEY_FILE or CHAINBENCH_PUBLIC_PRIVATE_KEY.
// Live mode also requires the frozen public image, verified by ./chainbench/run.sh against chainbench/adapters/public/
// ARCHIVE.json before the container starts (CHAINBENCH_PUBLIC_IMAGE_*; lib/imageid.js), and the frozen endpoints of the
// binding (lib/endpoints.js); both are checked before the key is loaded and recorded in run.json.
// Exit codes: 0 run completed (whatever the transaction states), 2 usage, 3 refusal (nothing sent).
process.env.CHAINBENCH_CAMPAIGN = process.env.CHAINBENCH_CAMPAIGN || 'CSI-CHAIN-PUBLIC-01';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const AD = path.resolve(__dirname, '..');
const CB = path.resolve(AD, '..', '..');
const REPO = path.resolve(CB, '..');
const W = require(path.join(CB, 'core', 'workload.js'));
const { Refusal, profile, checkChainId } = require('../lib/networks');
const { Rpc } = require('../lib/rpc');
const { loadSigner } = require('../lib/keysafety');
const { observe } = require('../lib/observe');
const { Recorder } = require('../lib/recorder');
const INP = require('../lib/inputs');
const PLAN = require('../lib/plan');
const TX = require('../lib/txengine');
const { now, ORIGIN_UTC } = require('../lib/clock');
const IMG = require('../lib/imageid');
const EP = require('../lib/endpoints');

const B = W.campaign;
const PROC = JSON.parse(fs.readFileSync(path.join(CB, B.procedure), 'utf8'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const git = (a) => { try { return execFileSync('git', a, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return ''; } };
function die(code, msg) { console.error(`[REFUSED] ${code}: ${msg}`); process.exit(3); }
const ENV_URL = { sepolia: 'CHAINBENCH_PUBLIC_RPC_SEPOLIA', 'era-sepolia': 'CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA' };
const ENV_LABEL = { sepolia: 'CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA', 'era-sepolia': 'CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA' };

function endpoint(network, mode) {
  const url = process.env[ENV_URL[network]] || (mode === 'live' ? (B.endpoints.public_defaults || {})[network] : null);
  if (!url) die('no_endpoint', `set ${ENV_URL[network]}`);
  try {
    const rpc = new Rpc(url, { label: process.env[ENV_LABEL[network]] || '', mode, timeoutMs: B.timing.rpc_timeout_ms, publicUrls: Object.values(B.endpoints.public_defaults || {}) });
    if (mode === 'live') EP.apply(B, network, rpc, process.env[ENV_LABEL[network]], { deviation: process.env.CHAINBENCH_PUBLIC_DEVIATION });
    return rpc;
  } catch (e) { if (e instanceof Refusal) die(e.code, e.message); throw e; }
}
function timing(network, mode) {
  const t = { poll_interval_ms: B.timing.poll_interval_ms, receipt_timeout_s: B.timing.receipt_timeout_s[network] };
  if (mode === 'dry') {
    if (process.env.CHAINBENCH_PUBLIC_DRY_POLL_MS) t.poll_interval_ms = Number(process.env.CHAINBENCH_PUBLIC_DRY_POLL_MS);
    if (process.env.CHAINBENCH_PUBLIC_DRY_TIMEOUT_S) t.receipt_timeout_s = Number(process.env.CHAINBENCH_PUBLIC_DRY_TIMEOUT_S);
  }
  return t;
}
function deploymentsPath(outRoot, network) { return path.join(outRoot, 'DEPLOYMENTS', `${network}.json`); }

async function runBlock(ctx, rec, blockId, ops, { phase, postChecks }) {
  // read-only observation and chain check before anything is signed
  const pre = await observe(ctx.rpc, ctx.prof, { signer: ctx.signer.address, label: `${blockId} pre` });
  rec.json(`observations/${blockId}-pre.json`, pre);
  ctx.observation_id = pre.observation_id;
  const chainCall = pre.calls.find((c) => c.name === 'chainId');
  let refusal = null;
  try {
    if (!chainCall || !chainCall.ok) throw new Refusal('chain_id_unavailable', 'eth_chainId failed');
    checkChainId(B, ctx.prof, JSON.parse(chainCall.response_raw).result);
  } catch (e) { refusal = e; }
  if (refusal) { ctx.halted = `chain_check_${refusal.code}`; console.error(`[REFUSED] ${refusal.code}: ${refusal.message} (block ${blockId}: nothing is sent)`); }
  else {
    const pend = pre.calls.find((c) => c.name === 'noncePending'); const lat = pre.calls.find((c) => c.name === 'nonceLatest');
    if (!pend || !pend.ok || !lat || !lat.ok) ctx.halted = 'nonce_unavailable';
    else {
      const p = Number(BigInt(JSON.parse(pend.response_raw).result)); const l = Number(BigInt(JSON.parse(lat.response_raw).result));
      ctx.nonce = l;
      if (p !== l) ctx.halted = 'pending_transactions_at_start';
    }
  }
  if (!ctx.halted && phase === 'verification') {
    const pc = [];
    for (const o of ops) pc.push(await TX.viewCheck(ctx, o.backend, { ...PROC.precheck, check: 'precheck_verify_credential', proof_id: o.proof_id }));
    rec.json(`checks/${blockId}-precheck.json`, pc);
  }
  for (const o of ops) {
    const r = await TX.execute(ctx, o);
    rec.row(r);
    console.log(`${r.schedule_id} ${r.network} ${r.op} ${r.backend} ${r.proof_id || '-'} -> ${r.state}${r.error_class ? ' (' + r.error_class + ')' : ''}${r.gas_used ? ' gasUsed ' + r.gas_used : ''}${r.request_to_receipt_ms !== '' ? ' ' + r.request_to_receipt_ms + ' ms' : ''}`);
  }
  let checks = null;
  if (postChecks && !refusal) {
    checks = [];
    for (const backend of PROC.backends) for (const c of PROC.post_setup_checks) checks.push(await TX.viewCheck(ctx, backend, c));
    rec.json(`checks/${blockId}-postcheck.json`, checks);
  }
  const post = await observe(ctx.rpc, ctx.prof, { signer: ctx.signer.address, label: `${blockId} post` });
  rec.json(`observations/${blockId}-post.json`, post);
  return { refusal, checks, pre: pre.observation_id, post: post.observation_id };
}

async function main() {
  const mode = arg('--mode'); const phase = arg('--phase');
  if (!['live', 'dry'].includes(mode) || !['setup', 'session'].includes(phase)) { console.error('usage: run_public.js --mode live|dry --phase setup --network N | --phase session --session S'); process.exit(2); }
  const network = arg('--network'); const sessionId = arg('--session');
  const target = phase === 'setup' ? network : sessionId;
  if (phase === 'setup') profile(B, network);
  let plan;
  try { plan = phase === 'setup' ? [{ network, ops: PLAN.setup(B, PROC, network) }] : PLAN.session(B, PROC, sessionId); } catch (e) { die('bad_target', e.message); }
  const sessionRec = phase === 'session' ? B.sessions.find((s) => s.id === sessionId) : null;
  // identity and live-mode guards (nothing is sent before all of them pass)
  const commit = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain', '--', ...B.tracked_paths]);
  const protoSha = sha(fs.readFileSync(path.join(REPO, B.protocol)));
  let inputs;
  try { inputs = INP.load(REPO, B); } catch (e) { die('inputs', e.message); }
  let image = IMG.fromEnv();
  if (mode === 'live') {
    if (arg('--confirm') !== (phase === 'setup' ? `setup-${network}` : sessionId)) die('not_confirmed', `live mode sends real transactions; repeat the target with --confirm ${phase === 'setup' ? `setup-${network}` : sessionId}`);
    try { image = IMG.verifyLive(); } catch (e) { if (e instanceof Refusal) die(e.code, e.message); throw e; }
    if (dirty) die('dirty_tree', `tracked paths have uncommitted changes:\n${dirty}`);
    if (phase === 'session' && !sessionRec.scheduled_start_utc) die('session_not_scheduled', `session ${sessionId} has no frozen scheduled_start_utc in the campaign binding`);
    if (phase === 'session') {
      const off = (Date.now() - Date.parse(sessionRec.scheduled_start_utc)) / 60000;
      if (Math.abs(off) > 60 && !process.env.CHAINBENCH_PUBLIC_DEVIATION) die('session_off_schedule', `session ${sessionId} is ${off.toFixed(1)} min from its frozen start (limit 60); record a deviation (protocol section 18) and set CHAINBENCH_PUBLIC_DEVIATION to its id`);
    }
  }
  let signer;
  try { signer = loadSigner(REPO); } catch (e) { if (e instanceof Refusal) die(e.code, e.message); throw e; }
  const rpcs = Object.fromEntries(plan.map((b) => [b.network, endpoint(b.network, mode)]));
  const t = now();
  const outRoot = path.resolve(REPO, arg('--out-root') || B.out_roots[mode]);
  const runId = `${mode}-${phase === 'setup' ? `setup-${network}` : sessionId}-${commit.slice(0, 7)}-${t.utc.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
  const rec = new Recorder(path.join(outRoot, runId), signer);
  const lock = path.join(AD, 'package-lock.json');
  const run = {
    campaign_id: B.campaign_id, run_id: runId, mode, phase, target, harness_commit: commit, tracked_paths_dirty: dirty ? dirty.split('\n') : [],
    protocol: B.protocol, protocol_sha256: protoSha, inputs_dir: B.inputs_dir, inputs_manifest_sha256: inputs.manifest_sha256,
    binding: path.relative(REPO, W.bindingFile), binding_sha256: sha(fs.readFileSync(W.bindingFile)),
    signer_address: signer.address, key_source: signer.key_source, node: process.version, lockfile_sha256: sha(fs.readFileSync(lock)),
    packages: Object.fromEntries(['ethers', 'zksync-ethers'].map((p) => [p, JSON.parse(fs.readFileSync(path.join(AD, 'node_modules', p, 'package.json'), 'utf8')).version])),
    process_origin_utc: ORIGIN_UTC, started_utc: t.utc, schedule: plan.map((b) => ({ network: b.network, ops: b.ops.map(({ step, ...o }) => o) })),
    scheduled_start_utc: sessionRec ? sessionRec.scheduled_start_utc : null,
    start_offset_minutes: sessionRec && sessionRec.scheduled_start_utc ? +((Date.parse(t.utc) - Date.parse(sessionRec.scheduled_start_utc)) / 60000).toFixed(2) : null,
    deviation: process.env.CHAINBENCH_PUBLIC_DEVIATION || null, image, fee_policy: B.fee_policy, endpoints: {}, timing: {}, blocks: [],
  };
  rec.json('run.json', run);
  const rpcLogs = [];
  for (const blk of plan) {
    const prof = profile(B, blk.network);
    const rpc = rpcs[blk.network];
    run.endpoints[blk.network] = rpc.identity; run.timing[blk.network] = timing(blk.network, mode);
    const ctx = { binding: B, proc: PROC, inputs, prof, rpc, signer, run: { run_id: runId, protocol_sha256: protoSha, harness_commit: commit, inputs_manifest_sha256: inputs.manifest_sha256 },
      mode, timing: run.timing[blk.network], nonce: null, halted: null, deployments: {} };
    const blockId = blk.ops[0].block_id;
    if (phase === 'session') {
      const dp = deploymentsPath(outRoot, blk.network);
      const dep = fs.existsSync(dp) ? JSON.parse(fs.readFileSync(dp, 'utf8')) : null;
      if (!dep || !dep.all_ok || dep.signer_address !== signer.address || dep.chain_id !== prof.chain_id) ctx.halted = 'setup_incomplete';
      else ctx.deployments = dep.contracts;
      run.blocks.push({ block_id: blockId, deployments_file: path.relative(outRoot, dp), deployments_sha256: dep ? sha(fs.readFileSync(dp)) : null });
    }
    const res = await runBlock(ctx, rec, blockId, blk.ops, { phase: phase === 'setup' ? 'setup' : 'verification', postChecks: phase === 'setup' });
    rpcLogs.push(...rpc.log.map((e) => ({ network: blk.network, ...e })));
    const b = run.blocks.find((x) => x.block_id === blockId) || (run.blocks.push({ block_id: blockId }), run.blocks[run.blocks.length - 1]);
    Object.assign(b, { network: blk.network, observation_pre: res.pre, observation_post: res.post, refusal: res.refusal ? res.refusal.code : null, halted: ctx.halted });
    if (phase === 'setup') {
      const rows = rec.rows.filter((r) => r.block_id === blockId);
      const dep = { campaign_id: B.campaign_id, network: blk.network, chain_id: prof.chain_id, setup_run_id: runId, signer_address: signer.address, contracts: ctx.deployments,
        transactions: rows.map((r) => ({ schedule_id: r.schedule_id, op: r.op, backend: r.backend, tx_hash: r.tx_hash, state: r.state, contract_address: r.contract_address, runtime_matches_artifact: r.runtime_matches_artifact })),
        post_setup_checks: res.checks, all_ok: rows.every((r) => r.state === 'confirmed_success') && !!res.checks && res.checks.every((c) => c.pass) };
      rec.json(`deployments-${blk.network}.json`, dep);
      if (dep.all_ok) { fs.mkdirSync(path.dirname(deploymentsPath(outRoot, blk.network)), { recursive: true }); fs.copyFileSync(path.join(rec.dir, `deployments-${blk.network}.json`), deploymentsPath(outRoot, blk.network)); }
      b.deployments_all_ok = dep.all_ok;
    }
  }
  rec.rpcLog(rpcLogs);
  run.finished_utc = now().utc;
  run.rows = rec.rows.length;
  run.states = rec.rows.reduce((a, r) => { a[r.state] = (a[r.state] || 0) + 1; return a; }, {});
  rec.json('run.json', run);
  const leak = rec.scan();
  if (leak.length) { console.error(`[FATAL] secret found in ${leak.join(', ')}`); process.exit(4); }
  console.log(`RUN ${runId}: ${run.rows} rows ${JSON.stringify(run.states)} -> ${path.relative(REPO, rec.dir)}`);
}
main().catch((e) => { console.error(e.code === 'secret_leak' ? `[FATAL] ${e.message}` : (e.stack || String(e))); process.exit(e.code === 'secret_leak' ? 4 : 1); });
