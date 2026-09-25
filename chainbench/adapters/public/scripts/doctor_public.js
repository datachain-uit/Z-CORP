'use strict';
// doctor-public (CHAIN-PUBLIC-PROTOCOL-v1 section 13). Checks the public adapter, its frozen inputs, the key-safety rules
// and, unless --offline, performs read-only observations of the configured endpoints. It NEVER signs or sends anything.
//   node doctor_public.js [--offline] [--out <file>]
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
const { Rpc, checkEndpoint } = require('../lib/rpc');
const { loadSigner } = require('../lib/keysafety');
const { observe } = require('../lib/observe');
const { stable } = require('../lib/recorder');
const INP = require('../lib/inputs');
const PLAN = require('../lib/plan');
const B = W.campaign;
const PROC = JSON.parse(fs.readFileSync(path.join(CB, B.procedure), 'utf8'));
const argv = process.argv.slice(2);
const offline = argv.includes('--offline');
const res = [];
const rec = (status, check, detail, fix) => { res.push({ status, check, detail: detail === undefined ? '' : detail, fix: fix || '' }); console.log(`[${status}] ${check}${detail !== undefined && detail !== '' ? ' — ' + detail : ''}${fix && status !== 'PASS' ? `\n       Fix: ${fix}` : ''}`); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const ENV_URL = { sepolia: 'CHAINBENCH_PUBLIC_RPC_SEPOLIA', 'era-sepolia': 'CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA' };
const ENV_LABEL = { sepolia: 'CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA', 'era-sepolia': 'CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA' };

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  rec(major >= 22 ? 'PASS' : 'FAIL', 'Node.js >= 22', process.version, 'use the chainbench-public image or Node 22');
  const lock = JSON.parse(fs.readFileSync(path.join(AD, 'package-lock.json'), 'utf8'));
  const want = { ethers: lock.packages['node_modules/ethers'].version, 'zksync-ethers': lock.packages['node_modules/zksync-ethers'].version };
  let got = {};
  try { for (const p of Object.keys(want)) got[p] = JSON.parse(fs.readFileSync(path.join(AD, 'node_modules', p, 'package.json'), 'utf8')).version; } catch (e) { got = null; }
  rec(got && Object.keys(want).every((p) => got[p] === want[p]) ? 'PASS' : 'FAIL', 'npm dependencies = package-lock.json (the only runtime dependencies)', got ? JSON.stringify(got) : 'node_modules missing', 'npm ci --ignore-scripts in chainbench/adapters/public (or use the image)');
  rec(Object.keys(lock.packages).filter((k) => k).length === 10 ? 'PASS' : 'WARN', 'dependency graph: 10 packages (ethers, zksync-ethers and their dependencies)', `${Object.keys(lock.packages).filter((k) => k).length} packages`);
  const src = ['lib', 'scripts'].flatMap((d) => fs.readdirSync(path.join(AD, d)).filter((f) => f.endsWith('.js') && f !== 'doctor_public.js').map((f) => fs.readFileSync(path.join(AD, d, f), 'utf8'))).join('\n');
  rec(!/new\s+(WebSocket|ethers\.WebSocketProvider|WebSocketProvider)\b|JsonRpcProvider|require\(['"]ws['"]\)|\bfetch\(/.test(src) ? 'PASS' : 'FAIL', 'RPC path: node:https/http only (no WebSocket, no ethers provider, no fetch/undici)');
  const proto = path.join(REPO, B.protocol);
  rec(fs.existsSync(proto) ? 'PASS' : 'FAIL', 'protocol present', fs.existsSync(proto) ? `${B.protocol} (sha256 ${sha(fs.readFileSync(proto)).slice(0, 16)}…)` : B.protocol);
  let inputs = null;
  try { inputs = INP.load(REPO, B); rec('PASS', 'frozen inputs (INPUTS.sha256, IDENTITY.json)', `${inputs.identity_checks} identity checks; manifest ${inputs.manifest_sha256.slice(0, 16)}…`); } catch (e) { rec('FAIL', 'frozen inputs', e.message, 'restore csi/campaigns/chain/CSI-CHAIN-PUBLIC-01/inputs from git'); }
  const sch = PLAN.schedule(B, PROC);
  rec(sch.total_transactions === 40 ? 'PASS' : 'FAIL', 'schedule', `${sch.total_transactions} transactions (16 setup, 24 verification in 3 sessions)`);
  const unscheduled = B.sessions.filter((s) => !s.scheduled_start_utc).map((s) => s.id);
  rec(unscheduled.length ? 'WARN' : 'PASS', 'session start times frozen in the binding', unscheduled.length ? `not yet set: ${unscheduled.join(', ')}` : B.sessions.map((s) => `${s.id} ${s.scheduled_start_utc}`).join('; '),
    'author input: set scheduled_start_utc for S1-S3 (at least two calendar days) and commit before session 1');
  let dirty = '';
  try { dirty = execFileSync('git', ['status', '--porcelain', '--', ...B.tracked_paths], { cwd: REPO, encoding: 'utf8' }).trim(); } catch (e) { dirty = 'git unavailable'; }
  rec(dirty ? 'WARN' : 'PASS', 'tracked paths clean', dirty ? dirty.split('\n').slice(0, 4).join(', ') : 'yes', 'live runs refuse a dirty tree');
  let signer = null;
  if (!process.env.CHAINBENCH_PUBLIC_KEY_FILE && !process.env.CHAINBENCH_PUBLIC_PRIVATE_KEY) rec('WARN', 'signing key', 'none configured (reviewer mode: validation and derivation need no key)', 'for live runs set CHAINBENCH_PUBLIC_KEY_FILE');
  else {
    try { signer = loadSigner(REPO); rec('PASS', 'signing key accepted by the key-safety rules', `signer ${signer.address} (source ${signer.key_source}); the key itself is never printed or recorded`); }
    catch (e) { rec('FAIL', 'signing key', e instanceof Refusal ? `${e.code}: ${e.message}` : e.message, 'use a dedicated funded key file outside the repository, chmod 600'); }
  }
  const obs = {};
  for (const net of Object.keys(B.networks)) {
    const prof = profile(B, net);
    const url = process.env[ENV_URL[net]] || (B.endpoints.public_defaults || {})[net];
    if (!url) { rec('WARN', `${prof.label} endpoint`, `not configured (${ENV_URL[net]})`, `author input: set ${ENV_URL[net]} and ${ENV_LABEL[net]}`); continue; }
    try { checkEndpoint(url, 'live'); } catch (e) { rec('FAIL', `${prof.label} endpoint`, `${e.code}: ${e.message}`); continue; }
    const rpc = new Rpc(url, { label: process.env[ENV_LABEL[net]] || '', mode: 'live', timeoutMs: B.timing.rpc_timeout_ms, publicUrls: Object.values(B.endpoints.public_defaults || {}) });
    rec('PASS', `${prof.label} endpoint (https)`, `${rpc.identity.label} host ${rpc.identity.host}${rpc.identity.url ? '' : ' (URL recorded as sha256 only)'}`);
    if (offline) continue;
    const o = await observe(rpc, prof, { signer: signer ? signer.address : null, label: 'doctor-public (read-only)' });
    obs[net] = o;
    const cc = o.calls.find((c) => c.name === 'chainId');
    try { checkChainId(B, prof, JSON.parse(cc.response_raw).result); rec('PASS', `${prof.label}: chain id`, String(prof.chain_id)); }
    catch (e) { rec('FAIL', `${prof.label}: chain id`, e.code ? `${e.code}: ${e.message}` : 'eth_chainId failed'); }
    rec(o.summary.calls_failed ? 'WARN' : 'PASS', `${prof.label}: read-only observation`, `client ${o.summary.client_version}; block ${o.summary.latest_block}; base fee ${o.summary.latest_base_fee_per_gas}; ${o.summary.calls_ok} calls ok, ${o.summary.calls_failed} failed`);
    if (signer) {
      const bal = o.calls.find((c) => c.name === 'balance');
      const wei = bal && bal.ok ? BigInt(JSON.parse(bal.response_raw).result) : null;
      rec(wei && wei > 0n ? 'PASS' : 'WARN', `${prof.label}: signer balance (test ether)`, wei === null ? 'unavailable' : `${wei} wei`, 'fund the dedicated signer before setup');
    }
  }
  const fails = res.filter((r) => r.status === 'FAIL').length;
  const outDir = path.join(REPO, 'build', 'chainbench', 'public', 'doctor');
  fs.mkdirSync(outDir, { recursive: true });
  const file = argv.includes('--out') ? path.resolve(argv[argv.indexOf('--out') + 1]) : path.join(outDir, `doctor-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.json`);
  const body = JSON.stringify(stable({ kind: 'doctor-public (engineering; not session evidence)', offline, results: res, observations: obs, signer_address: signer ? signer.address : null }), null, 2) + '\n';
  if (signer && signer.containsSecret(body)) { console.error('[FATAL] refusing to write a report containing the key'); process.exit(4); }
  fs.writeFileSync(file, body);
  console.log(`DOCTOR-PUBLIC: ${fails ? `${fails} FAIL` : 'no FAIL'} (${res.filter((r) => r.status === 'WARN').length} WARN); nothing was signed or sent; report ${path.relative(REPO, file)}`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
