'use strict';
// CHAIN-PROTOCOL-v1 §12: one run of the L1 matrix in one environment.
//   node scripts/run_l1.js --plan dry|full --env edr|geth --run-id <id> [--geth-bin <path>] [--reference <run dir>]
//        [--step build|envcheck|exec|finish|all]   (default: all)
// A run lives in build/campaigns/chain/<run-id>/ (raw data) and chainbench/.work/<run-id>/ (fresh staging, artifacts,
// cache). Steps are resumable because one shell call of the execution environment is limited to ~3 minutes:
// `exec` processes cells in plan order, each on a fresh chain, and skips cells already written.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const C = require('../lib/common');
const W = require('../core/workload');
const K = W.module('constants');
const { PLANS, expectedRows } = W.module('plan');
const { build } = require('../lib/build');
const { toCsv } = require('../lib/schema');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };

const plan = arg('--plan'); const env = arg('--env'); const runId = arg('--run-id'); const step = arg('--step', 'all');
if (!PLANS[plan] || !['edr', 'geth'].includes(env) || !runId || !/^[A-Za-z0-9._-]+$/.test(runId)) { console.error('usage: --plan dry|full --env edr|geth --run-id <id>'); process.exit(2); }
// Output root: the scientific plan writes to build/campaigns/chain (protocol section 8); non-scientific plans may be
// redirected (CHAINBENCH_OUT_ROOT) so that smoke and dry-run data never mix with scientific runs.
const OUT_ROOT_DEFAULT = path.join(C.REPO, 'build', 'campaigns', 'chain');
const OUT_ROOT = process.env.CHAINBENCH_OUT_ROOT ? path.resolve(process.env.CHAINBENCH_OUT_ROOT) : OUT_ROOT_DEFAULT;
if (plan === 'full' && OUT_ROOT !== OUT_ROOT_DEFAULT) { console.error('the full (scientific) plan writes only to build/campaigns/chain'); process.exit(2); }
const OUT = path.join(OUT_ROOT, runId);
const WORK = path.join(C.CHAINBENCH, '.work', runId);
const RUNJSON = path.join(OUT, 'run.json');
const gethArg = arg('--geth-bin') || (env === 'geth' ? process.env.CHAINBENCH_GETH_BIN : null);
const gethBin = gethArg ? path.resolve(gethArg) : null;
const reference = arg('--reference') ? path.resolve(arg('--reference')) : null;
const TRACKED = W.campaign.tracked_paths;

function readRun() { return JSON.parse(fs.readFileSync(RUNJSON, 'utf8')); }
function saveRun(r) { C.writeJson(RUNJSON, r); }
function edrNativeBinary() {
  const dir = path.join(C.CHAINBENCH, 'node_modules', '@nomicfoundation');
  const plat = fs.readdirSync(dir).filter((d) => d.startsWith(`edr-${os.platform()}-${os.arch() === 'x64' ? 'x64' : os.arch()}`));
  for (const p of plat) for (const f of fs.readdirSync(path.join(dir, p))) if (f.endsWith('.node')) return { package: `@nomicfoundation/${p}`, file: f, sha256: C.sha256File(path.join(dir, p, f)) };
  return null;
}

function stepInit() {
  if (fs.existsSync(OUT)) throw new Error(`run directory exists: ${OUT}`);
  if (fs.existsSync(WORK)) throw new Error(`work directory exists: ${WORK}`);
  if (env === 'geth' && (!gethBin || !reference)) throw new Error('geth replay needs --geth-bin and --reference <EDR run dir>');
  const dirty = C.gitDirty(TRACKED);
  if (plan === 'full' && dirty.length) throw new Error(`full plan requires committed harness/contracts/inputs; dirty: ${dirty.join('; ')}`);
  fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(WORK, { recursive: true });
  const ver = (n) => C.pkgVersion(n);
  saveRun({
    campaign_id: C.CAMPAIGN_ID, run_id: runId, plan, env, started_at_utc: C.nowUtc(), commit: C.gitHead(), dirty_tracked_paths: dirty,
    protocol: C.PROTOCOL_REL, protocol_sha256: C.sha256File(path.join(C.REPO, C.PROTOCOL_REL)),
    plonk_verifier_provenance_sha256: C.sha256File(path.join(C.CAMPAIGN_DIR, 'inputs', 'plonk-verifiers.provenance.json')),
    reference_run: reference ? path.relative(C.REPO, reference) : null, cells: PLANS[plan].cells.map((c) => c.cell_id), proofs: PLANS[plan].proofs,
    workload: W.NAME, campaign_binding: path.relative(C.CHAINBENCH, W.bindingFile), out_root: path.relative(C.REPO, OUT_ROOT),
    expected_rows: expectedRows(plan), steps: {},
  });
  C.writeJson(path.join(OUT, 'environment.json'), {
    host: { platform: os.platform(), release: os.release(), arch: os.arch(), cpus: os.cpus().length, os_release: (() => { try { return fs.readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="([^"]+)"/)[1]; } catch (e) { return ''; } })() },
    node: process.version, npm: execFileSync('npm', ['-v'], { encoding: 'utf8' }).trim(),
    packages: { hardhat: ver('hardhat'), '@nomicfoundation/edr': ver('@nomicfoundation/edr'), '@nomicfoundation/hardhat-ethers': ver('@nomicfoundation/hardhat-ethers'),
      ethers: ver('ethers'), snarkjs: ver('snarkjs'), ffjavascript: ver('ffjavascript'), solc: ver('solc'), '@openzeppelin/contracts': ver('@openzeppelin/contracts'), ejs: ver('ejs') },
    lockfile_sha256: C.sha256File(path.join(C.CHAINBENCH, 'package-lock.json')), package_json_sha256: C.sha256File(path.join(C.CHAINBENCH, 'package.json')),
    edr_native_binary: edrNativeBinary(), soljson_sha256: C.sha256File(require.resolve('solc/soljson.js')),
    hardhat_console_sol_sha256: C.sha256File(path.join(C.CHAINBENCH, 'node_modules', 'hardhat', 'console.sol')),
    edr_network_config: { ...K.EDR_NETWORK, hardfork: K.HARDFORK },
    geth: gethBin ? { binary: gethBin, sha256: C.sha256File(gethBin), version: require('../lib/geth').gethVersion(gethBin) } : null,
    edr_identity: {
      npm_package: '@nomicfoundation/edr', npm_version: ver('@nomicfoundation/edr'),
      native_package: edrNativeBinary() ? edrNativeBinary().package : null,
      native_package_version: edrNativeBinary() ? C.pkgVersion(edrNativeBinary().package) : null,
      native_sha256: edrNativeBinary() ? edrNativeBinary().sha256 : null,
      client_version_note: 'web3_clientVersion carries the EDR Rust workspace version (crate edr_provider, CARGO_PKG_VERSION = 0.3.8 at npm release 0.12.0-next.23); the npm package version is authoritative',
    },
    container: process.env.CHAINBENCH_IMAGE_ID ? {
      image_id: process.env.CHAINBENCH_IMAGE_ID, image_ref: process.env.CHAINBENCH_IMAGE_REF || null,
      base_image: process.env.CHAINBENCH_BASE_IMAGE || null, geth_source: process.env.CHAINBENCH_GETH_SOURCE || null,
      network: process.env.CHAINBENCH_NETWORK || null,
      network_interfaces: (() => { try { return fs.readdirSync('/sys/class/net').sort(); } catch (e) { return null; } })(),
      network_isolation: require('../core/netcheck').networkIsolation(),
    } : null,
  });
}
function stepBuild() {
  const r = readRun();
  for (const name of ['primary', 'bridge']) {
    const m = build(name, WORK);
    C.writeJson(path.join(OUT, `build_manifest.${name}.json`), m);
    if (!Object.values(m.contracts).every((c) => c.eip170_runtime_ok && c.eip3860_initcode_ok)) throw new Error(`size limit exceeded in ${name}`);
    if (!m.staged_files.every((f) => f.equals_head) && plan === 'full') throw new Error('staged file differs from HEAD');
  }
  if (reference) {
    for (const name of ['primary', 'bridge']) {
      const a = JSON.parse(fs.readFileSync(path.join(OUT, `build_manifest.${name}.json`), 'utf8'));
      const b = JSON.parse(fs.readFileSync(path.join(reference, `build_manifest.${name}.json`), 'utf8'));
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`build manifest ${name} differs from reference run`);
    }
    r.build_identical_to_reference = true;
  }
  r.steps.build = C.nowUtc(); saveRun(r);
}
function stepEnvcheck() {
  const r = readRun();
  const args = [path.join(C.CHAINBENCH, 'scripts', 'env_check.js'), '--out', path.join(OUT, 'env_check.json')];
  if (env === 'geth') args.push('--geth-bin', gethBin);
  const s = spawnSync(process.execPath, args, { cwd: C.CHAINBENCH, env: { ...process.env, CHAINBENCH_WORKDIR: WORK }, encoding: 'utf8' });
  const res = JSON.parse(fs.readFileSync(path.join(OUT, 'env_check.json'), 'utf8'));
  if (s.status !== 0 || !res.pass) throw new Error('env_check failed');
  r.steps.envcheck = C.nowUtc(); r.env_check_pass = true; saveRun(r);
}
async function stepExec(budgetMs) {
  const r = readRun();
  if (!r.steps.build || !r.steps.envcheck) throw new Error('build and envcheck must precede exec');
  const t0 = Date.now();
  const cellDir = path.join(OUT, 'cells'); fs.mkdirSync(cellDir, { recursive: true });
  const ps = await W.module('proofset').load();
  r.proofset_manifest = ps.manifest;
  const { runCell } = W.module('ops');
  const artCache = {};
  const artifact = (profile, source, name) => {
    const k = `${profile}:${source}:${name}`;
    if (!artCache[k]) artCache[k] = require('../lib/build').loadArtifact(profile, WORK, source, name);
    return artCache[k];
  };
  let edr = null;
  if (env === 'edr') {
    process.env.CHAINBENCH_WORKDIR = WORK; process.env.CHAINBENCH_PROFILE = 'primary'; process.env.HARDHAT_NETWORK = 'hardhat';
    delete process.env.CHAINBENCH_HARDFORK;
    const hre = require('hardhat');
    if (hre.network.config.hardfork !== K.HARDFORK) throw new Error(`hardfork ${hre.network.config.hardfork}`);
    const { EdrRpc } = require('../lib/rpc');
    edr = new EdrRpc(hre.network.provider);
  }
  const G = require('../lib/geth');
  let port = 18600;
  for (const cell of PLANS[plan].cells) {
    const f = path.join(cellDir, `${cell.cell_id}.json`);
    if (fs.existsSync(f)) continue;
    if (Date.now() - t0 > budgetMs) break;
    let ctx; let g = null;
    if (env === 'edr') {
      await edr.call('hardhat_reset', []);
      ctx = { rpc: edr, env: 'L1-EDR', chainId: K.EDR_CHAIN_ID, fees: K.FEES.edr, hardfork: K.HARDFORK, clientVersion: await edr.call('web3_clientVersion') };
    } else {
      g = await G.startGeth(gethBin, port); port += 10;
      const A = W.module('ops').wallets();
      await G.fundAccounts(g.rpc, [A.A0.address, A.A1.address]);
      ctx = { rpc: g.rpc, env: 'L1-geth', chainId: Number(await g.rpc.call('eth_chainId')), fees: K.FEES.geth, hardfork: K.HARDFORK, clientVersion: await g.rpc.call('web3_clientVersion') };
    }
    Object.assign(ctx, { runId, plan, artifact });
    try {
      const rows = await runCell(ctx, cell, PLANS[plan].proofs, ps);
      fs.writeFileSync(f + '.tmp', JSON.stringify(rows)); fs.renameSync(f + '.tmp', f);
      console.log(JSON.stringify({ cell: cell.cell_id, rows: rows.length, fail: rows.filter((x) => x.check_pass !== 1).length }));
    } finally { if (g) await G.stopGeth(g); }
  }
  saveRun({ ...readRun(), proofset_manifest: ps.manifest });
  const done = PLANS[plan].cells.filter((c) => fs.existsSync(path.join(cellDir, `${c.cell_id}.json`))).length;
  if (done === PLANS[plan].cells.length) { const rr = readRun(); rr.steps.exec = C.nowUtc(); saveRun(rr); }
  return done;
}
function stepFinish() {
  const r = readRun();
  if (!r.steps.exec) throw new Error('exec not complete');
  const rows = PLANS[plan].cells.flatMap((c) => JSON.parse(fs.readFileSync(path.join(OUT, 'cells', `${c.cell_id}.json`), 'utf8')));
  fs.writeFileSync(path.join(OUT, 'local_l1_ops.csv'), toCsv(rows));
  r.rows = rows.length; r.rows_expected = expectedRows(plan); r.rows_failing_check = rows.filter((x) => x.check_pass !== 1).length;
  r.deployments_runtime_match = rows.filter((x) => x.op.startsWith('deploy_')).every((x) => x.runtime_matches_artifact === 1);
  r.accepted_checks = r.rows === r.rows_expected && r.rows_failing_check === 0 && r.deployments_runtime_match && r.env_check_pass === true;
  r.ops_csv_sha256 = C.sha256File(path.join(OUT, 'local_l1_ops.csv'));
  r.finished_at_utc = C.nowUtc(); r.steps.finish = r.finished_at_utc;
  saveRun(r);
  console.log(JSON.stringify({ run: runId, rows: r.rows, expected: r.rows_expected, failing: r.rows_failing_check, runtime_match: r.deployments_runtime_match, accepted_checks: r.accepted_checks }));
  return r.accepted_checks;
}

(async () => {
  const budget = Number(arg('--budget-seconds', '140')) * 1000;
  if (step === 'all' || step === 'init') stepInit();
  if (step === 'all' || step === 'build') stepBuild();
  if (step === 'all' || step === 'envcheck') stepEnvcheck();
  if (step === 'all' || step === 'exec') {
    const done = await stepExec(budget);
    console.log(`EXEC cells done ${done}/${PLANS[plan].cells.length}`);
    if (done < PLANS[plan].cells.length) process.exit(0);
  }
  if (step === 'all' || step === 'finish') process.exit(stepFinish() ? 0 : 1);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
