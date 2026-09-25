'use strict';
// Engineering dry run of the public adapter (CHAIN-PUBLIC-PROTOCOL-v1 section 15). Mock endpoints on 127.0.0.1 only; an
// ephemeral random key that exists only for the duration of the run; no public network, no test ETH. NOT scientific data.
//   node dry_run_public.js [--step all|units|refusals|normal|faults] [--id <dry id>]
// Exercises: both backend calldata paths, setup and the 40-transaction schedule, fee recording, timing and receipt polling,
// the state taxonomy (RPC error, insufficient balance, revert, no receipt, halting, missing dependency), key-safety and
// chain-id refusals, Era batch-lifecycle collection, validation and derivation.
process.env.CHAINBENCH_CAMPAIGN = 'CSI-CHAIN-PUBLIC-01';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const AD = path.resolve(__dirname, '..');
const CB = path.resolve(AD, '..', '..');
const REPO = path.resolve(CB, '..');
const { ethers } = require('ethers');
const W = require(path.join(CB, 'core', 'workload.js'));
const { Mock } = require('./mock_rpc');
const INP = require('../lib/inputs');
const KS = require('../lib/keysafety');
const PLAN = require('../lib/plan');
const { checkEndpoint } = require('../lib/rpc');
const { Refusal, checkChainId, profile } = require('../lib/networks');
const { Recorder, SecretLeak } = require('../lib/recorder');

const B = W.campaign;
const PROC = JSON.parse(fs.readFileSync(path.join(CB, B.procedure), 'utf8'));
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const step = arg('--step', 'all');
const commit = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(); } catch (e) { return 'nogit00'; } })();
const dryId = arg('--id') || `dry-public-${commit.slice(0, 7)}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
const ROOT = path.join(REPO, B.out_roots.dry, dryId);
fs.mkdirSync(ROOT, { recursive: true });
const results = [];
function expect(stepName, name, ok, detail) { results.push({ step: stepName, expectation: name, pass: !!ok, detail: detail === undefined ? null : detail }); console.log(`${ok ? 'PASS' : 'FAIL'} [${stepName}] ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 160) : ''}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- ephemeral key material (outside the repository; removed at the end)
const KDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chainbench-public-dry-'));
const good = ethers.Wallet.createRandom();
const kfile = (name, content, mode) => { const p = path.join(KDIR, name); fs.writeFileSync(p, content, { mode }); fs.chmodSync(p, mode); return p; };
const KEY = kfile('dedicated.key', good.privateKey + '\n', 0o600);
const devMnemonic = /const MNEMONIC = '([^']+)'/.exec(fs.readFileSync(path.join(CB, 'lib', 'constants.js'), 'utf8'))[1];
const DEVKEY = kfile('dev.key', ethers.HDNodeWallet.fromPhrase(devMnemonic, undefined, "m/44'/60'/0'/0/0").privateKey + '\n', 0o600);
const OPENKEY = kfile('open.key', good.privateKey + '\n', 0o644);
const MNEMKEY = kfile('mnemonic.key', devMnemonic + '\n', 0o600);
const BADKEY = kfile('bad.key', 'not-a-key\n', 0o600);
const cleanEnv = () => { const e = { ...process.env }; for (const k of Object.keys(e)) if (k.startsWith('CHAINBENCH_PUBLIC_')) delete e[k]; return e; };
function env(urls, extra = {}) {
  return { ...cleanEnv(), CHAINBENCH_CAMPAIGN: 'CSI-CHAIN-PUBLIC-01', CHAINBENCH_PUBLIC_KEY_FILE: KEY, CHAINBENCH_PUBLIC_RPC_SEPOLIA: urls.sepolia, CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA: urls['era-sepolia'],
    CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA: 'dry-run mock (Ethereum-like)', CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA: 'dry-run mock (Era-like)',
    CHAINBENCH_PUBLIC_DRY_POLL_MS: '500', CHAINBENCH_PUBLIC_DRY_TIMEOUT_S: '20', ...extra };
}
function child(args, e) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd: CB, env: e });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
}
const RUN = path.join(AD, 'scripts', 'run_public.js');
const FIN = path.join(AD, 'scripts', 'collect_era_finality.js');
async function mocks(scen = {}, chain = {}) {
  const inputs = INP.load(REPO, B);
  const sep = new Mock({ kind: 'evm', chainId: 11155111, blockTimeMs: 1000, inputs, account: good.address, balanceWei: 10n ** 19n, scenario: scen.sepolia || {} });
  const era = new Mock({ kind: 'eravm', chainId: 300, blockTimeMs: 300, inputs, account: good.address, balanceWei: 10n ** 19n, scenario: scen.era || {} });
  if (chain.sepolia) sep.scenario.chainIdOverride = chain.sepolia;
  if (chain.era) era.scenario.chainIdOverride = chain.era;
  const urls = { sepolia: await sep.start(), 'era-sepolia': await era.start() };
  return { sep, era, urls, stop: async () => { await sep.stop(); await era.stop(); } };
}
function readRows(dir) { return fs.readFileSync(path.join(dir, 'tx.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
function runDir(out) { const m = /^RUN \S+: .* -> (\S+)$/m.exec(out); return m ? path.join(REPO, m[1]) : null; }

// ---- step 1: in-process unit checks (no endpoint)
async function units() {
  const S = 'units';
  const dev = KS.devAccounts(REPO);
  const h0 = ethers.HDNodeWallet.fromPhrase(devMnemonic, undefined, "m/44'/60'/0'/0/0").address.toLowerCase();
  expect(S, 'development accounts: first 20 of the reproducibility mnemonic + 10 legacy rich wallets are refused', dev.has(h0) && KS.LEGACY_RICH_WALLETS.every((a) => dev.has(a.toLowerCase())) && dev.size === 30, { size: dev.size });
  const ep = (url, mode) => { try { checkEndpoint(url, mode); return 'ok'; } catch (e) { return e.code; } };
  const epCases = [['http://127.0.0.1:8545', 'live', 'endpoint_not_https'], ['ws://rpc.example.org', 'live', 'endpoint_not_https'], ['wss://rpc.example.org', 'live', 'endpoint_not_https'],
    ['https://127.0.0.1:8545', 'live', 'endpoint_loopback_live'], ['https://localhost', 'live', 'endpoint_loopback_live'], ['https://rpc.example.org', 'live', 'ok'],
    ['https://rpc.example.org', 'dry', 'endpoint_not_loopback_dry'], ['http://localhost:8545', 'dry', 'endpoint_not_loopback_dry'], ['http://127.0.0.1:18545', 'dry', 'ok']];
  for (const [u, m, want] of epCases) expect(S, `endpoint rule ${m} ${u} -> ${want}`, ep(u, m) === want, ep(u, m));
  const cc = (net, id) => { try { checkChainId(B, profile(B, net), '0x' + id.toString(16)); return 'ok'; } catch (e) { return e.code; } };
  const ccCases = [['sepolia', 11155111, 'ok'], ['era-sepolia', 300, 'ok'], ['sepolia', 300, 'cross_network'], ['era-sepolia', 11155111, 'cross_network'], ['sepolia', 1, 'refused_chain_id'],
    ['era-sepolia', 324, 'refused_chain_id'], ['sepolia', 31337, 'refused_chain_id'], ['sepolia', 1337, 'refused_chain_id'], ['era-sepolia', 260, 'refused_chain_id'], ['era-sepolia', 270, 'refused_chain_id'], ['sepolia', 5, 'chain_id_mismatch']];
  for (const [n, id, want] of ccCases) expect(S, `chain id ${id} on the ${n} profile -> ${want}`, cc(n, id) === want, cc(n, id));
  const sch = PLAN.schedule(B, PROC);
  const blocks = sch.sessions.flatMap((s) => s.blocks);
  expect(S, 'schedule: 40 transactions (16 setup + 24 verification)', sch.total_transactions === 40 && Object.values(sch.setup).every((v) => v.length === 8) && blocks.length === 6, sch.total_transactions);
  expect(S, 'schedule: every session block alternates the backends and uses both frozen proofs of each backend', blocks.every((b) => b.ops.length === 4 && b.ops[0].backend !== b.ops[1].backend && b.ops[0].backend === b.ops[2].backend
    && ['groth16', 'plonk'].every((k) => new Set(b.ops.filter((o) => o.backend === k).map((o) => o.proof_id)).size === 2)));
  expect(S, 'schedule: network order alternates across sessions', sch.sessions.map((s) => s.network_order[0]).join(',') === 'sepolia,era-sepolia,sepolia');
  const inputs = INP.load(REPO, B);
  expect(S, 'frozen inputs load and verify (INPUTS.sha256, IDENTITY.json)', inputs.identity_checks === 43 && Object.keys(inputs.proofById).length === 4, { identity_checks: inputs.identity_checks });
  const fake = { containsSecret: (t) => String(t).toLowerCase().includes(good.privateKey.slice(2)) };
  const rec = new Recorder(path.join(ROOT, 'units', 'guard'), fake);
  let leak = false; try { rec.write('x.json', JSON.stringify({ k: good.privateKey.toUpperCase().replace('0X', '0x') })); } catch (e) { leak = e instanceof SecretLeak; }
  expect(S, 'recorder refuses to write content that contains the signing key', leak && !fs.existsSync(path.join(ROOT, 'units', 'guard', 'x.json')));
}

// ---- step 2: refusals through the runner itself (exit 3, nothing sent)
async function refusals() {
  const S = 'refusals';
  const m = await mocks();
  const base = env(m.urls);
  const setupArgs = [RUN, '--mode', 'dry', '--phase', 'setup', '--network', 'sepolia', '--out-root', path.relative(REPO, path.join(ROOT, 'refusals'))];
  const cases = [
    ['no key configured', { CHAINBENCH_PUBLIC_KEY_FILE: undefined }, 'no_key'],
    ['file and environment key together', { CHAINBENCH_PUBLIC_PRIVATE_KEY: good.privateKey }, 'two_key_sources'],
    ['relative key path', { CHAINBENCH_PUBLIC_KEY_FILE: 'dedicated.key' }, 'key_file_not_absolute'],
    ['key file inside the repository', { CHAINBENCH_PUBLIC_KEY_FILE: path.join(CB, 'package.json') }, 'key_file_in_repository'],
    ['group/world-readable key file', { CHAINBENCH_PUBLIC_KEY_FILE: OPENKEY }, 'key_file_permissions'],
    ['mnemonic instead of a key', { CHAINBENCH_PUBLIC_KEY_FILE: MNEMKEY }, 'mnemonic_refused'],
    ['malformed key', { CHAINBENCH_PUBLIC_KEY_FILE: BADKEY }, 'key_format'],
    ['Hardhat/Anvil development account 0', { CHAINBENCH_PUBLIC_KEY_FILE: DEVKEY }, 'dev_account'],
    ['development key through the environment', { CHAINBENCH_PUBLIC_KEY_FILE: undefined, CHAINBENCH_PUBLIC_PRIVATE_KEY: ethers.HDNodeWallet.fromPhrase(devMnemonic, undefined, "m/44'/60'/0'/0/1").privateKey }, 'dev_account'],
    ['dry run pointed at a non-loopback endpoint', { CHAINBENCH_PUBLIC_RPC_SEPOLIA: 'https://rpc.example.org' }, 'endpoint_not_loopback_dry'],
  ];
  for (const [name, over, code] of cases) {
    const e = { ...base, ...over }; for (const k of Object.keys(over)) if (over[k] === undefined) delete e[k];
    const r = await child(setupArgs, e);
    expect(S, `${name} -> refused (${code})`, r.code === 3 && r.err.includes(`[REFUSED] ${code}`) && !r.err.toLowerCase().includes(good.privateKey.slice(2)), { exit: r.code, msg: r.err.trim().split('\n')[0] });
  }
  const live = await child([RUN, '--mode', 'live', '--phase', 'setup', '--network', 'sepolia'], base);
  expect(S, 'live mode without --confirm -> refused (not_confirmed)', live.code === 3 && live.err.includes('[REFUSED] not_confirmed'), live.err.trim().split('\n')[0]);
  const sends = m.sep.sends + m.era.sends;
  expect(S, 'no transaction reached any endpoint during the refusal cases', sends === 0, { sends });
  await m.stop();
  // chain-id refusals: the endpoint answers a wrong chain id; the block is recorded, nothing is signed or sent
  const chainCases = [['sepolia', 31337, 'refused_chain_id'], ['sepolia', 300, 'cross_network'], ['sepolia', 1, 'refused_chain_id'], ['sepolia', 5, 'chain_id_mismatch'], ['era-sepolia', 260, 'refused_chain_id'], ['era-sepolia', 11155111, 'cross_network'], ['era-sepolia', 324, 'refused_chain_id']];
  for (const [net, id, code] of chainCases) {
    const mm = await mocks({}, net === 'sepolia' ? { sepolia: id } : { era: id });
    const r = await child([RUN, '--mode', 'dry', '--phase', 'setup', '--network', net, '--out-root', path.relative(REPO, path.join(ROOT, 'refusals'))], env(mm.urls));
    const dir = runDir(r.out); const rows = dir ? readRows(dir) : [];
    const rpcLog = dir ? fs.readFileSync(path.join(dir, 'rpc-log.jsonl'), 'utf8') : '';
    expect(S, `${net} endpoint reporting chain id ${id} -> ${code}; 8 rows unsent_preflight_failure; no eth_sendRawTransaction`,
      r.code === 0 && rows.length === 8 && rows.every((x) => x.state === 'unsent_preflight_failure' && x.error_class === `chain_check_${code}`) && !rpcLog.includes('eth_sendRawTransaction') && mm.sep.sends + mm.era.sends === 0,
      { exit: r.code, rows: rows.length, classes: [...new Set(rows.map((x) => x.error_class))] });
    await mm.stop();
  }
}

function derive(root, S, label) {
  const out = path.join(root, 'derived');
  const py = spawnSyncPy([path.join(REPO, 'scripts', 'analysis', 'derive_chain_public.py'), '--root', root, '--out', out, '--mode', 'dry']);
  let v = null; try { v = JSON.parse(fs.readFileSync(path.join(out, 'validation.json'), 'utf8')); } catch (e) { v = null; }
  expect(S, `${label}: derive_chain_public.py validation passes`, py.status === 0 && v && v.passed, { exit: py.status, checks: v ? `${v.checks_passed}/${v.checks_total}` : null, err: (py.stderr || '').slice(-200) });
  return v;
}
function spawnSyncPy(args) { return require('child_process').spawnSync('python3', args, { cwd: REPO, encoding: 'utf8' }); }

// ---- step 3: the full 40-transaction schedule on well-behaved mocks
async function normal() {
  const S = 'normal';
  const root = path.join(ROOT, 'normal');
  const m = await mocks();
  const e = env(m.urls);
  const runs = [];
  for (const a of [['setup', '--network', 'sepolia'], ['setup', '--network', 'era-sepolia'], ['session', '--session', 'S1'], ['session', '--session', 'S2'], ['session', '--session', 'S3']]) {
    const r = await child([RUN, '--mode', 'dry', '--phase', a[0], a[1], a[2], '--out-root', path.relative(REPO, root)], e);
    const dir = runDir(r.out); runs.push(dir);
    const rows = dir ? readRows(dir) : [];
    const n = a[0] === 'setup' ? 8 : 8;
    expect(S, `${a.join(' ')}: exit 0, ${n} rows, all confirmed_success`, r.code === 0 && rows.length === n && rows.every((x) => x.state === 'confirmed_success'), { exit: r.code, states: rows.map((x) => x.state).filter((s) => s !== 'confirmed_success'), err: r.err.slice(-300) });
    if (!rows.length) continue;
    if (a[0] === 'setup') {
      const dep = JSON.parse(fs.readFileSync(path.join(dir, `deployments-${a[2]}.json`), 'utf8'));
      expect(S, `${a[2]} setup: deployed code equals the frozen artifact, post-setup checks pass (verifier, owner, issuer, root)`, dep.all_ok && rows.filter((x) => x.op.startsWith('deploy')).every((x) => x.runtime_matches_artifact === 1) && dep.post_setup_checks.length === 8, dep.post_setup_checks.filter((c) => !c.pass));
    }
    expect(S, `${a.join(' ')}: RPC hash = locally computed hash; t0 <= t_hash <= t_receipt; latencies consistent`, rows.every((x) => x.tx_hash_matches === 1 && x.t0_mono_ms <= x.t_hash_mono_ms && x.t_hash_mono_ms <= x.t_receipt_mono_ms
      && Math.abs(x.request_to_receipt_ms - (x.send_to_hash_ms + x.hash_to_receipt_ms)) < 0.01 && x.polls >= 1));
    expect(S, `${a.join(' ')}: receipt fee = gasUsed x effectiveGasPrice = balance change at the inclusion block`, rows.every((x) => x.fee_consistency_ok === 1 && BigInt(x.receipt_fee_wei) === BigInt(x.gas_used) * BigInt(x.effective_gas_price)));
    const sep = rows.filter((x) => x.network === 'sepolia'); const era = rows.filter((x) => x.network === 'era-sepolia');
    if (sep.length) expect(S, `${a.join(' ')}: Sepolia send policy (type 2, maxFee = 2*base + P, frozen gas limits) and EIP-1559 effective price`, sep.every((x) => x.tx_type === 2 && BigInt(x.max_fee_per_gas) === 2n * BigInt(x.prep_base_fee_per_gas) + BigInt(B.fee_policy.sepolia.max_priority_fee_per_gas_wei)
      && Number(x.gas_limit) === B.fee_policy.sepolia.gas_limit[x.op] && x.effective_price_ok === 1));
    if (era.length) expect(S, `${a.join(' ')}: Era send policy (type 113, zks_estimateFee values unchanged), batch number and details fee recorded`, era.every((x) => x.tx_type === 113 && x.gas_limit === x.est_gas_limit && x.max_fee_per_gas === x.est_max_fee_per_gas
      && x.gas_per_pubdata_limit === x.est_gas_per_pubdata_limit && x.l1_batch_number !== '' && x.era_details_fee_ok === 1));
    if (a[0] === 'session') {
      const inputs = INP.load(REPO, B);
      expect(S, `${a.join(' ')}: verification calldata = the frozen controlled-study calldata (both backends)`, rows.every((x) => x.calldata_sha256 === inputs.proofById[x.proof_id].verify_credential_calldata_sha256)
        && new Set(rows.map((x) => x.backend)).size === 2);
      const pc = fs.readdirSync(path.join(dir, 'checks')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, 'checks', f), 'utf8'))).flat();
      expect(S, `${a.join(' ')}: read-only prechecks (verifyCredential eth_call) pass before sending`, pc.length === 8 && pc.every((c) => c.pass));
      expect(S, `${a.join(' ')}: pre- and post-block network observations recorded`, fs.readdirSync(path.join(dir, 'observations')).length === 4);
    }
  }
  await sleep(8000); // mock batches are committed, proven and executed 2, 4 and 6 s after sealing
  const f = await child([FIN, '--mode', 'dry', '--root', path.relative(REPO, root)], env(m.urls));
  const fdir = /-> (\S+)\s*$/m.exec(f.out); const fin = fdir ? JSON.parse(fs.readFileSync(path.join(REPO, fdir[1], 'finality.json'), 'utf8')) : null;
  expect(S, 'collect-era-finality: every Era transaction has an L1 batch with commit, prove and execute times (post hoc, separate from receipt latency)', f.code === 0 && fin && fin.transactions.length === 20
    && fin.transactions.every((t) => t.l1_batch_number !== '' && t.committed_at && t.proven_at && t.executed_at), { exit: f.code, n: fin ? fin.transactions.length : 0, err: f.err.slice(-200) });
  await m.stop();
  derive(root, S, 'normal');
  return runs;
}

// ---- step 4: injected faults (the state taxonomy and the halting rules)
async function faults() {
  const S = 'faults';
  const root = path.join(ROOT, 'faults');
  const m = await mocks();
  const e = env(m.urls, { CHAINBENCH_PUBLIC_DRY_TIMEOUT_S: '4' });
  for (const n of ['sepolia', 'era-sepolia']) {
    const r = await child([RUN, '--mode', 'dry', '--phase', 'setup', '--network', n, '--out-root', path.relative(REPO, root)], e);
    expect(S, `fault root: ${n} setup confirmed`, r.code === 0 && runDir(r.out) && readRows(runDir(r.out)).every((x) => x.state === 'confirmed_success'));
  }
  m.sep.scenario = { sendJsonRpcError: 1, revertSend: 2, noReceipt: 3 }; m.sep.sends = 0; m.sep.estimates = 0;
  m.era.scenario = { insufficientOnSend: 1, estimateError: 2, sendHttpErrorKnown: 2, pollErrors: { send: 2, n: 2 }, lowBalanceAfterSends: 2 }; m.era.sends = 0; m.era.estimates = 0;
  const r = await child([RUN, '--mode', 'dry', '--phase', 'session', '--session', 'S1', '--out-root', path.relative(REPO, root)], e);
  const rows = runDir(r.out) ? readRows(runDir(r.out)) : [];
  const got = (net) => rows.filter((x) => x.network === net).map((x) => `${x.state}/${x.error_class}`);
  const wantSep = ['unsent_client_error/send_rpc_error', 'reverted/status_0', 'submitted_no_receipt/receipt_timeout', 'unsent_preflight_failure/halted_after_no_receipt'];
  const wantEra = ['unsent_insufficient_balance/node_insufficient_funds', 'unsent_client_error/fee_rpc_jsonrpc', 'confirmed_success/send_error_tx_known', 'unsent_insufficient_balance/balance_below_required'];
  expect(S, 'Sepolia block: RPC error on send, revert, no receipt, halt after no receipt', r.code === 0 && JSON.stringify(got('sepolia')) === JSON.stringify(wantSep), got('sepolia'));
  expect(S, 'Era block: node insufficient funds, fee-estimate RPC error, send error with the transaction known to the node, balance below requirement', JSON.stringify(got('era-sepolia')) === JSON.stringify(wantEra), got('era-sepolia'));
  const rv = rows.find((x) => x.state === 'reverted');
  expect(S, 'revert reason recovered by eth_call replay at the parent block', rv && rv.revert_reason === 'Invalid proof' && rv.gas_used !== '' && rv.fee_consistency_ok === 1, rv && rv.revert_reason);
  const kn = rows.find((x) => x.error_class === 'send_error_tx_known');
  expect(S, 'receipt polling survives injected poll errors (counted, not hidden)', kn && kn.poll_errors === 2 && kn.polls >= 3, kn && { polls: kn.polls, poll_errors: kn.poll_errors });
  const nr = rows.find((x) => x.state === 'submitted_no_receipt');
  expect(S, 'no-receipt transaction keeps its hash and t_hash; no t_receipt; never re-sent', nr && nr.tx_hash && nr.t_hash_utc && !nr.t_receipt_utc && m.sep.sends === 3, { sends: m.sep.sends });
  expect(S, 'unsent operations have no hash and consumed no nonce', rows.filter((x) => x.state.startsWith('unsent')).every((x) => !x.tx_hash));
  await m.stop();
  derive(root, S, 'faults');
  // setup failure: the deployed code does not match the artifact -> dependants not sent; a session then refuses to send
  const root2 = path.join(ROOT, 'faults-setup');
  const m2 = await mocks({ sepolia: { wrongCode: 1 } });
  const e2 = env(m2.urls);
  const r2 = await child([RUN, '--mode', 'dry', '--phase', 'setup', '--network', 'sepolia', '--out-root', path.relative(REPO, root2)], e2);
  const rows2 = runDir(r2.out) ? readRows(runDir(r2.out)) : [];
  const g = rows2.filter((x) => x.backend === 'groth16').map((x) => `${x.state}/${x.error_class}/${x.runtime_matches_artifact}`);
  expect(S, 'setup: code mismatch is detected; dependent Groth16 operations are not sent (dependency_missing); PLONK proceeds', r2.code === 0
    && JSON.stringify(g) === JSON.stringify(['confirmed_success//0', 'unsent_preflight_failure/dependency_missing/', 'unsent_preflight_failure/dependency_missing/', 'unsent_preflight_failure/dependency_missing/'])
    && rows2.filter((x) => x.backend === 'plonk').every((x) => x.state === 'confirmed_success') && !fs.existsSync(path.join(root2, 'DEPLOYMENTS', 'sepolia.json')), g);
  const sendsBefore = m2.sep.sends + m2.era.sends;
  const r3 = await child([RUN, '--mode', 'dry', '--phase', 'session', '--session', 'S2', '--out-root', path.relative(REPO, root2)], e2);
  const rows3 = runDir(r3.out) ? readRows(runDir(r3.out)) : [];
  expect(S, 'session without a verified setup: all 8 operations unsent_preflight_failure (setup_incomplete); nothing sent', r3.code === 0 && rows3.length === 8 && rows3.every((x) => x.state === 'unsent_preflight_failure' && x.error_class === 'setup_incomplete') && m2.sep.sends + m2.era.sends === sendsBefore,
    { sends_during_session: m2.sep.sends + m2.era.sends - sendsBefore });
  await m2.stop();
}

async function main() {
  const steps = step === 'all' ? ['units', 'refusals', 'normal', 'faults'] : [step];
  const t0 = new Date().toISOString();
  for (const s of steps) await ({ units, refusals, normal, faults })[s]();
  const prevPath = path.join(ROOT, 'SUMMARY.json');
  const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : { results: [] };
  const merged = [...prev.results.filter((x) => !steps.includes(x.step)), ...results];
  const sum = { kind: 'engineering dry run (NOT scientific data)', dry_id: dryId, commit, node: process.version, mode: 'dry (mock endpoints on 127.0.0.1; ephemeral key; no public network; no test ETH)',
    signer_address_ephemeral: good.address, updated_utc: new Date().toISOString(), last_steps: steps, last_started_utc: t0,
    results: merged, passed: merged.filter((x) => x.pass).length, total: merged.length, all_pass: merged.every((x) => x.pass) };
  fs.writeFileSync(prevPath, JSON.stringify(sum, null, 2) + '\n');
  fs.rmSync(KDIR, { recursive: true, force: true });
  console.log(`DRY-RUN-PUBLIC ${dryId}: ${sum.passed}/${sum.total} expectations pass (steps ${steps.join(', ')}) -> ${path.relative(REPO, ROOT)}`);
  process.exit(results.every((x) => x.pass) ? 0 : 1);
}
main().catch((e) => { try { fs.rmSync(KDIR, { recursive: true, force: true }); } catch (x) { /* ignore */ } console.error(e.stack || String(e)); process.exit(1); });
