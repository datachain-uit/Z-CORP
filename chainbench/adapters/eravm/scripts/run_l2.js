'use strict';
// CHAIN-PROTOCOL-v1 §16 (A6): one run of the local-EraVM matrix.
//   node adapters/eravm/scripts/run_l2.js --plan smoke|dry|full --run-id <id> [--step init|build|envcheck|exec|finish|all]
// Raw data: <out root>/<run-id>/ (default build/campaigns/chain-l2; smoke and dry runs are redirected with
// CHAINBENCH_OUT_ROOT). Staging and compiler output: chainbench/.work/<run-id>/ (fresh; a tmpfs in the container).
// Each cell runs on a fresh anvil-zksync process; `exec` resumes at cell boundaries.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('../../../lib/common');
const W = require('../../../core/workload');
const E = require('../lib/constants');
const A = require('../lib/anvil');
const { compile, artifact } = require('../lib/compile');
const { PLANS, COMPILE_FILES, expectedRows, expectedTx } = require('../lib/plan');
const { runCell, attachAccounting } = require('../lib/ops');
const { toCsv } = require('../lib/schema');
const { rawCall, waitReceipt } = require('../../../lib/rpc');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };

const ADAPTER = path.resolve(__dirname, '..');
const plan = arg('--plan'); const runId = arg('--run-id'); const step = arg('--step', 'all');
if (!PLANS[plan] || !runId || !/^[A-Za-z0-9._-]+$/.test(runId)) { console.error('usage: --plan smoke|dry|full --run-id <id> [--step ...]'); process.exit(2); }
const OUT_ROOT_DEFAULT = path.join(C.REPO, 'build', 'campaigns', 'chain-l2');
const OUT_ROOT = process.env.CHAINBENCH_OUT_ROOT ? path.resolve(process.env.CHAINBENCH_OUT_ROOT) : OUT_ROOT_DEFAULT;
if (PLANS[plan].scientific && OUT_ROOT !== OUT_ROOT_DEFAULT) { console.error('the full (scientific) plan writes only to build/campaigns/chain-l2'); process.exit(2); }
if (!PLANS[plan].scientific && OUT_ROOT === OUT_ROOT_DEFAULT) { console.error('non-scientific plans must set CHAINBENCH_OUT_ROOT (outside build/campaigns/chain-l2)'); process.exit(2); }
const OUT = path.join(OUT_ROOT, runId);
const WORK = path.join(C.CHAINBENCH, '.work', runId);
const RUNJSON = path.join(OUT, 'run.json');
const readRun = () => JSON.parse(fs.readFileSync(RUNJSON, 'utf8'));
const saveRun = (r) => C.writeJson(RUNJSON, r);
const ver = (n) => C.pkgVersion(n);
const tryRun = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { return null; } };

function toolchain() {
  const B = E.binaries(); const P = E.archPins();
  const bin = (p) => (p && fs.existsSync(p) ? { sha256: A.sha256File(p) } : { missing: true });
  return {
    anvil_zksync: { ...bin(B.anvil_zksync), version: B.anvil_zksync && fs.existsSync(B.anvil_zksync) ? A.version(B.anvil_zksync) : null, pinned_sha256: P.anvil_zksync.sha256, release_tgz_sha256: P.anvil_zksync.tgz_sha256 },
    zksolc: { ...bin(B.zksolc), version: B.zksolc && fs.existsSync(B.zksolc) ? tryRun(B.zksolc, ['--version']) : null, pinned_sha256: P.zksolc.sha256 },
    era_solc: { ...bin(B.era_solc), version: B.era_solc && fs.existsSync(B.era_solc) ? tryRun(B.era_solc, ['--version']) : null, pinned_sha256: P.era_solc.sha256 },
  };
}
function stepInit() {
  if (fs.existsSync(OUT)) throw new Error(`run directory exists: ${OUT}`);
  if (fs.existsSync(WORK)) throw new Error(`work directory exists: ${WORK}`);
  const dirty = C.gitDirty(W.campaign.tracked_paths);
  if (PLANS[plan].scientific && dirty.length) throw new Error(`the full plan requires committed sources; dirty: ${dirty.join('; ')}`);
  fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(WORK, { recursive: true });
  saveRun({
    campaign_id: C.CAMPAIGN_ID, arm: 'L2-EraVM', run_id: runId, plan, scientific: PLANS[plan].scientific, env: 'L2-EraVM-anvil-zksync',
    started_at_utc: C.nowUtc(), commit: C.gitHead(), dirty_tracked_paths: dirty,
    protocol: C.PROTOCOL_REL, protocol_sha256: C.sha256File(path.join(C.REPO, C.PROTOCOL_REL)),
    workload: W.NAME, campaign_binding: path.relative(C.CHAINBENCH, W.bindingFile), out_root: path.relative(C.REPO, OUT_ROOT),
    cells: PLANS[plan].cells.map((c) => c.cell_id), proofs: PLANS[plan].proofs, expected_rows: expectedRows(plan), expected_tx: expectedTx(plan), steps: {},
  });
  C.writeJson(path.join(OUT, 'environment.json'), {
    host: { platform: os.platform(), release: os.release(), arch: os.arch(), cpus: os.cpus().length,
      os_release: (() => { try { return fs.readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="([^"]+)"/)[1]; } catch (e) { return ''; } })() },
    node: process.version, npm: tryRun('npm', ['-v']),
    packages: Object.fromEntries(['ethers', 'zksync-ethers', 'snarkjs', 'ffjavascript', '@openzeppelin/contracts'].map((n) => [n, ver(n)])),
    lockfile: 'chainbench/adapters/eravm/package-lock.json', lockfile_sha256: C.sha256File(path.join(ADAPTER, 'package-lock.json')),
    pins_sha256: C.sha256File(path.join(ADAPTER, 'pins.env')), toolchain: toolchain(),
    node_options: { args: E.anvilArgs(E.RPC_PORT, '<cell>/anvil.log'), rust_log: E.RUST_LOG, fresh_node_per_cell: true },
    tx_fields: { type: E.TX_TYPE, max_fee_per_gas: E.MAX_FEE_PER_GAS.toString(), max_priority_fee_per_gas: E.MAX_PRIORITY_FEE_PER_GAS.toString(), gas_per_pubdata_limit: E.GAS_PER_PUBDATA_LIMIT.toString(), gas_limits: E.GAS_LIMIT },
    fee_input: Object.fromEntries(Object.entries(E.FEE_INPUT).map(([k, v]) => [k, v.toString()])),
    expected_system_contracts: E.SYSTEM_CONTRACTS,
    compiler_settings: E.ZKSOLC_SETTINGS,
    container: process.env.CHAINBENCH_IMAGE_ID ? {
      image_id: process.env.CHAINBENCH_IMAGE_ID, image_ref: process.env.CHAINBENCH_IMAGE_REF || null, base_image: process.env.CHAINBENCH_BASE_IMAGE || null,
      network: process.env.CHAINBENCH_NETWORK || null, network_isolation: require('../../../core/netcheck').networkIsolation(),
    } : null,
  });
}
function stepBuild() {
  const r = readRun();
  const { manifest } = compile(COMPILE_FILES, path.join(WORK, 'eravm'));
  C.writeJson(path.join(OUT, 'build_manifest.eravm.json'), manifest);
  if (!Object.values(manifest.contracts).every((c) => c.eravm_size_ok)) throw new Error('EraVM bytecode size limit exceeded');
  if (PLANS[plan].scientific && !manifest.sources.filter((s) => s.equals_head !== null).every((s) => s.equals_head)) throw new Error('a compiled source differs from HEAD');
  r.steps.build = C.nowUtc(); r.build_output_sha256 = manifest.output_sha256; saveRun(r);
}
async function envcheck() {
  const dir = path.join(OUT, 'envcheck');
  const checks = [];
  const ck = (name, ok, got, want) => checks.push({ check: name, pass: !!ok, got, want });
  const tc = toolchain();
  for (const k of ['anvil_zksync', 'zksolc', 'era_solc']) ck(`${k} binary sha256 = pin`, tc[k].sha256 && tc[k].sha256 === tc[k].pinned_sha256, tc[k].sha256, tc[k].pinned_sha256);
  ck('anvil-zksync version', tc.anvil_zksync.version === `anvil-zksync ${E.archPins().anvil_zksync.version}`, tc.anvil_zksync.version, `anvil-zksync ${E.archPins().anvil_zksync.version}`);
  if (process.env.CHAINBENCH_NETWORK === 'none') { const ni = require('../../../core/netcheck').networkIsolation(); ck('network isolation (container --network none)', ni.isolated === true, ni, 'isolated'); }
  const node = await A.start(dir);
  let probe = null;
  try {
    const { rpc } = node;
    ck('eth_chainId', Number(await rpc.call('eth_chainId')) === E.CHAIN_ID, await rpc.call('eth_chainId'), E.CHAIN_ID);
    const cv = await rpc.call('web3_clientVersion'); ck('web3_clientVersion', cv === E.API_EXPECTED.client_version, cv, E.API_EXPECTED.client_version);
    const bd = await rpc.call('zks_getBlockDetails', [0]);
    ck('protocol version (block 0)', bd.protocolVersion === E.SYSTEM_CONTRACTS.protocol_version, bd.protocolVersion, E.SYSTEM_CONTRACTS.protocol_version);
    const h = bd.baseSystemContractsHashes || {};
    ck('bootloader hash', h.bootloader === E.SYSTEM_CONTRACTS.bootloader, h.bootloader, E.SYSTEM_CONTRACTS.bootloader);
    ck('default AA hash', h.default_aa === E.SYSTEM_CONTRACTS.default_aa, h.default_aa, E.SYSTEM_CONTRACTS.default_aa);
    ck('EVM emulator disabled', (h.evm_emulator === undefined ? null : h.evm_emulator) === E.SYSTEM_CONTRACTS.evm_emulator, h.evm_emulator, E.SYSTEM_CONTRACTS.evm_emulator);
    ck('genesis timestamp', bd.timestamp === E.GENESIS_TIMESTAMP, bd.timestamp, E.GENESIS_TIMESTAMP);
    const gp = BigInt(await rpc.call('eth_gasPrice')); ck('eth_gasPrice (API)', gp === E.API_EXPECTED.eth_gasPrice, gp.toString(), E.API_EXPECTED.eth_gasPrice.toString());
    const gpp = BigInt(await rpc.call('zks_gasPerPubdata')); ck('zks_gasPerPubdata (API, estimation-scaled)', gpp === E.API_EXPECTED.zks_gasPerPubdata, gpp.toString(), E.API_EXPECTED.zks_gasPerPubdata.toString());
    const Wl = W.module('ops').wallets();
    for (const k of ['A0', 'A1']) { const b = BigInt(await rpc.call('eth_getBalance', [Wl[k].address, 'latest'])); ck(`balance ${k}`, b === BigInt(E.BALANCE_ETH) * 10n ** 18n, b.toString(), `${E.BALANCE_ETH} ETH`); }
    // Fee-accounting probe: one 0-value self-transfer; the node's fee record must reproduce its receipt gasUsed exactly.
    const { utils, EIP712Signer } = require('zksync-ethers');
    const req = { type: E.TX_TYPE, from: Wl.A0.address, to: Wl.A0.address, data: '0x', value: 0n, nonce: 0, chainId: E.CHAIN_ID, gasLimit: 2000000n,
      maxFeePerGas: E.MAX_FEE_PER_GAS, maxPriorityFeePerGas: E.MAX_PRIORITY_FEE_PER_GAS, customData: { gasPerPubdata: E.GAS_PER_PUBDATA_LIMIT, factoryDeps: [] } };
    req.customData.customSignature = await new EIP712Signer(Wl.A0, E.CHAIN_ID).sign(req);
    const hash = await rpc.call('eth_sendRawTransaction', [utils.serializeEip712(req)]);
    const rc = await waitReceipt(rpc, hash, 120000);
    probe = { hash, status: Number(rc.status), gas_used: Number(rc.gasUsed), effective_gas_price: BigInt(rc.effectiveGasPrice).toString() };
    const c = await rawCall(rpc, { from: Wl.A0.address, to: Wl.A0.address, data: '0x' }, 'latest');
    ck('eth_call answers', c.ok, c.ok, true);
  } finally { await A.stop(node); }
  const recs = A.parseFeeTrace(fs.readFileSync(node.logFile, 'utf8')).get(probe.hash) || [];
  ck('probe transaction succeeded', probe.status === 1, probe.status, 1);
  ck('probe: one fee record', recs.length === 1, recs.length, 1);
  if (recs.length === 1) {
    const t = recs[0];
    Object.assign(probe, t, { gas_used_derived: E.derivedGasUsed(2000000, t.computational_gas, t.pubdata_bytes) });
    ck('probe: pubdata_gas = pubdata_bytes x 84', BigInt(t.pubdata_gas) === BigInt(t.pubdata_bytes) * E.FEE_INPUT.gas_per_pubdata, t.pubdata_gas, `${t.pubdata_bytes} x 84`);
    ck('probe: receipt gasUsed reproduced from the fixed fee input', probe.gas_used_derived === probe.gas_used, probe.gas_used_derived, probe.gas_used);
    ck('probe: effective gas price = base fee', probe.effective_gas_price === E.FEE_INPUT.base_fee.toString(), probe.effective_gas_price, E.FEE_INPUT.base_fee.toString());
  }
  const res = { pass: checks.every((c) => c.pass), checks, probe, node_startup_ms: node.startup_ms };
  C.writeJson(path.join(OUT, 'env_check.json'), res);
  return res;
}
async function stepExec(budgetMs) {
  const r = readRun();
  if (!r.steps.build || !r.steps.envcheck) throw new Error('build and envcheck must precede exec');
  const t0 = Date.now();
  const cellDir = path.join(OUT, 'cells'); fs.mkdirSync(cellDir, { recursive: true });
  const ps = await W.module('proofset').load();
  const out = JSON.parse(fs.readFileSync(path.join(WORK, 'eravm', 'zksolc-output.json'), 'utf8'));
  const nodeVersion = A.version();
  for (const cell of PLANS[plan].cells) {
    const f = path.join(cellDir, `${cell.cell_id}.json`);
    if (fs.existsSync(f)) continue;
    if (Date.now() - t0 > budgetMs) break;
    const ndir = path.join(OUT, 'nodes', cell.cell_id);
    if (fs.existsSync(ndir)) throw new Error(`node directory exists (interrupted cell?): ${ndir}`);
    const node = await A.start(ndir);
    let rows;
    try {
      const bd = await node.rpc.call('zks_getBlockDetails', [0]);
      const ctx = { rpc: node.rpc, runId, plan, env: 'L2-EraVM-anvil-zksync', nodeVersion, protocolVersion: bd.protocolVersion,
        artifact: (source, name) => artifact(out, source, name) };
      rows = await runCell(ctx, cell, PLANS[plan].proofs, ps);
    } finally { await A.stop(node); }
    attachAccounting(rows, A.parseFeeTrace(fs.readFileSync(node.logFile, 'utf8')));
    fs.writeFileSync(f + '.tmp', JSON.stringify(rows)); fs.renameSync(f + '.tmp', f);
    console.log(JSON.stringify({ cell: cell.cell_id, rows: rows.length, fail: rows.filter((x) => x.check_pass !== 1).length, accounting_fail: rows.filter((x) => x.kind === 'tx' && x.accounting_ok !== 1).length }));
  }
  r.proofset_manifest = ps.manifest; saveRun(r);
  const done = PLANS[plan].cells.filter((c) => fs.existsSync(path.join(cellDir, `${c.cell_id}.json`))).length;
  if (done === PLANS[plan].cells.length) { const rr = readRun(); rr.steps.exec = C.nowUtc(); saveRun(rr); }
  return done;
}
function stepFinish() {
  const r = readRun();
  if (!r.steps.exec) throw new Error('exec not complete');
  const rows = PLANS[plan].cells.flatMap((c) => JSON.parse(fs.readFileSync(path.join(OUT, 'cells', `${c.cell_id}.json`), 'utf8')));
  fs.writeFileSync(path.join(OUT, 'local_l2_ops.csv'), toCsv(rows));
  const tx = rows.filter((x) => x.kind === 'tx');
  r.rows = rows.length; r.rows_expected = expectedRows(plan); r.tx_rows = tx.length; r.tx_expected = expectedTx(plan);
  r.rows_failing_check = rows.filter((x) => x.check_pass !== 1).length;
  r.tx_failing_accounting = tx.filter((x) => x.accounting_ok !== 1).length;
  r.deployments_bytecode_match = rows.filter((x) => x.op.startsWith('deploy_')).every((x) => x.bytecode_matches_artifact === 1);
  r.accepted_checks = r.rows === r.rows_expected && r.tx_rows === r.tx_expected && r.rows_failing_check === 0 && r.tx_failing_accounting === 0
    && r.deployments_bytecode_match && r.env_check_pass === true;
  r.ops_csv_sha256 = C.sha256File(path.join(OUT, 'local_l2_ops.csv'));
  r.finished_at_utc = C.nowUtc(); r.steps.finish = r.finished_at_utc;
  saveRun(r);
  console.log(JSON.stringify({ run: runId, rows: r.rows, expected: r.rows_expected, failing: r.rows_failing_check, accounting_fail: r.tx_failing_accounting, bytecode_match: r.deployments_bytecode_match, accepted_checks: r.accepted_checks }));
  return r.accepted_checks;
}

(async () => {
  const budget = Number(arg('--budget-seconds', '140')) * 1000;
  if (step === 'all' || step === 'init') stepInit();
  if (step === 'all' || step === 'build') stepBuild();
  if (step === 'all' || step === 'envcheck') {
    const res = await envcheck();
    const r = readRun(); r.env_check_pass = res.pass; if (res.pass) r.steps.envcheck = C.nowUtc(); saveRun(r);
    if (!res.pass) { console.error(JSON.stringify(res.checks.filter((c) => !c.pass), null, 1)); throw new Error('envcheck failed'); }
  }
  if (step === 'all' || step === 'exec') {
    const done = await stepExec(budget);
    console.log(`EXEC cells done ${done}/${PLANS[plan].cells.length}`);
    if (done < PLANS[plan].cells.length) process.exit(0);
  }
  if (step === 'all' || step === 'finish') process.exit(stepFinish() ? 0 : 1);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
