'use strict';
// chainbench local-EraVM (L2) pre-flight checks, run inside the chainbench-l2 container (no network). Runs no experiment.
//   node adapters/eravm/doctor/doctor_l2.js [--require-clean] [--require-baseline] [--require-archived-image] [--out file]
// Exit 1 if any check FAILs; every FAIL prints a remediation line.
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../../../lib/common');
const W = require('../../../core/workload');
const E = require('../lib/constants');
const A = require('../lib/anvil');
const { compile } = require('../lib/compile');
const { COMPILE_FILES } = require('../lib/plan');

const has = (f) => process.argv.includes(f);
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const ADAPTER = path.resolve(__dirname, '..');
const ADAPTER_REL = path.relative(C.REPO, ADAPTER);
const results = [];
function rec(level, what, detail = '', fix = '') {
  results.push({ level, check: what, detail, fix });
  console.log(`[${level}] ${what}${detail ? ` — ${detail}` : ''}${level === 'FAIL' && fix ? `\n       Fix: ${fix}` : ''}`);
}
(async () => {
  // 1. Binding and runtime
  if (W.campaign.arm !== 'L2-EraVM') rec('FAIL', 'campaign binding', `${path.relative(C.CHAINBENCH, W.bindingFile)} is not the L2 binding`, 'run through ./chainbench/run.sh doctor-l2');
  else rec('PASS', 'campaign binding', `${path.relative(C.CHAINBENCH, W.bindingFile)} (${W.campaign.campaign_id}, arm ${W.campaign.arm})`);
  rec('PASS', 'runtime', `Node ${process.version} on ${os.platform()}/${os.arch()}`);
  // 2. npm dependencies = the adapter lockfile
  const lock = JSON.parse(fs.readFileSync(path.join(ADAPTER, 'package-lock.json'), 'utf8'));
  const bad = ['ethers', 'zksync-ethers', 'snarkjs', '@openzeppelin/contracts', 'ffjavascript'].filter((n) => {
    try { return C.pkgVersion(n) !== lock.packages[`node_modules/${n}`].version; } catch (e) { return true; }
  });
  if (bad.length) rec('FAIL', 'npm dependencies match adapters/eravm/package-lock.json', `mismatch: ${bad.join(', ')}`, 'rebuild the image: ./chainbench/run.sh build-image-l2');
  else rec('PASS', 'npm dependencies match adapters/eravm/package-lock.json', `ethers ${C.pkgVersion('ethers')}, zksync-ethers ${C.pkgVersion('zksync-ethers')}, snarkjs ${C.pkgVersion('snarkjs')}`);
  // 3. Pinned binaries
  let P = null;
  try { P = E.archPins(); } catch (e) { rec('FAIL', 'supported architecture', e.message, 'use linux/arm64 or linux/amd64'); }
  const B = E.binaries();
  if (P) {
    for (const [k, want] of [['anvil_zksync', P.anvil_zksync.sha256], ['zksolc', P.zksolc.sha256], ['era_solc', P.era_solc.sha256]]) {
      const p = B[k];
      if (!p || !fs.existsSync(p)) { rec('FAIL', `${k} present`, p || 'unset', 'rebuild the image: ./chainbench/run.sh build-image-l2'); continue; }
      const got = A.sha256File(p);
      if (got === want) rec('PASS', `${k} sha256 = pin`, `${got.slice(0, 16)}…`); else rec('FAIL', `${k} sha256 = pin`, `${got} != ${want}`, 'rebuild the image from the committed pins');
    }
    try { const v = A.version(); if (v === `anvil-zksync ${P.anvil_zksync.version}`) rec('PASS', 'anvil-zksync version', v); else rec('FAIL', 'anvil-zksync version', v, 'rebuild the image'); } catch (e) { rec('FAIL', 'anvil-zksync runs', e.message, 'rebuild the image'); }
  }
  // 4. Network isolation
  const ni = require('../../../core/netcheck').networkIsolation();
  if (process.env.CHAINBENCH_NETWORK === 'none') {
    if (ni.isolated === true) rec('PASS', 'no network (container --network none)', `interfaces up besides lo: none; routes: 0`);
    else rec('FAIL', 'no network (container --network none)', JSON.stringify(ni), 'run through ./chainbench/run.sh (it starts the container with --network none)');
  } else rec('WARN', 'network isolation not checked', 'not started by run-l2.sh with --network none');
  // 5. Inputs
  const proto = path.join(C.REPO, C.PROTOCOL_REL);
  if (!fs.existsSync(proto)) rec('FAIL', 'protocol present', C.PROTOCOL_REL, 'check out the repository at an L2 baseline');
  else {
    const t = fs.readFileSync(proto, 'utf8');
    if (/^## 16\. /m.test(t) && /\| A6 \|/.test(t)) rec('PASS', 'protocol with the L2 amendment', `${C.PROTOCOL_REL} (A6, section 16)`);
    else rec(has('--require-baseline') ? 'FAIL' : 'WARN', 'protocol with the L2 amendment', 'A6 / section 16 not found', 'check out the repository at an L2 baseline');
  }
  try { const ps = await W.module('proofset').load(); rec('PASS', 'proof set PS-01 intact', `${ps.manifest.files_verified} files verified against PROOFSET.sha256`); }
  catch (e) { rec('FAIL', 'proof set PS-01 intact', e.message, 'restore csi/campaigns/chain/CSI-CHAIN-LOCAL-01/inputs from git'); }
  const missing = COMPILE_FILES.filter((f) => !fs.existsSync(path.join(C.REPO, f)));
  if (missing.length) rec('FAIL', 'contract sources present', missing.join(', '), 'check out the repository'); else rec('PASS', 'contract sources present', `${COMPILE_FILES.length} files`);
  // 6. Source state
  const IMAGE_RECORDS = (W.campaign.image_records || []);
  let head = null;
  try { head = C.gitHead(); } catch (e) { rec('FAIL', 'git repository readable', String(e.message).slice(0, 120), 'run from a git clone of the repository'); }
  if (head) {
    const dirty = [...C.gitDirty(W.campaign.tracked_paths), ...C.gitDirty(IMAGE_RECORDS)];
    if (!dirty.length) rec('PASS', 'sources clean', `HEAD ${head.slice(0, 7)}`);
    else rec(has('--require-clean') ? 'FAIL' : 'WARN', 'sources clean', `${dirty.length} changed: ${dirty.slice(0, 4).join('; ')}`, 'commit or restore the listed files');
    const prefix = W.campaign.baseline_tag_prefix;
    let tags = [];
    try { tags = C.git(['tag', '--list', `${prefix}*`, '--sort=-creatordate']).split('\n').filter(Boolean); } catch (e) { tags = []; }
    if (!tags.length) rec(has('--require-baseline') ? 'FAIL' : 'WARN', 'L2 baseline tag', `no tag ${prefix}*`, 'the author creates the L2 baseline tag after the packaged L2 dry run; check out a released L2 baseline');
    else {
      const t = tags[0]; const tc = C.git(['rev-parse', `${t}^{commit}`]);
      let changed = '';
      try { changed = [C.git(['diff', '--name-only', tc, 'HEAD', '--', ...W.campaign.measurement_paths]), C.git(['diff', '--name-only', tc, 'HEAD', '--', ...IMAGE_RECORDS])].filter(Boolean).join('\n'); } catch (e) { changed = `error: ${e.message}`; }
      if (!changed) rec('PASS', 'L2 baseline tag', `${t} -> ${tc.slice(0, 7)}; measurement sources and image records unchanged since the tag`);
      else rec(has('--require-baseline') ? 'FAIL' : 'WARN', 'L2 baseline tag', `${t}: changed since the tag: ${changed.split('\n').slice(0, 5).join(', ')}`, `git checkout ${t}`);
    }
  }
  // 7. Archived image
  const arch = path.join(ADAPTER, 'ARCHIVE.json');
  const dockerArch = { x64: 'amd64', arm64: 'arm64' }[os.arch()] || os.arch();
  if (fs.existsSync(arch)) {
    const ar = JSON.parse(fs.readFileSync(arch, 'utf8'));
    const here = process.env.CHAINBENCH_IMAGE_ID || null;
    if (here && here === ar.image_id) rec('PASS', 'archived L2 image in use', `${ar.image_id} = ${ar.archive} (sha256 ${String(ar.archive_sha256).slice(0, 16)}…)`);
    else if (ar.platform !== `linux/${dockerArch}`) rec('WARN', 'archived L2 image in use', `this platform is linux/${dockerArch}; the archived image is ${ar.platform} (a reproduction, not the archived environment)`);
    else rec(has('--require-archived-image') ? 'FAIL' : 'WARN', 'archived L2 image in use', `running ${here || 'unknown'}, archived ${ar.image_id}`, `./chainbench/run.sh load-image-l2 ${ar.archive_file || '<archive>'}`);
  } else rec(has('--require-archived-image') ? 'FAIL' : 'WARN', 'archived L2 image', `no ${ADAPTER_REL}/ARCHIVE.json yet`, 'the author archives the frozen L2 image (save-image-l2 --frozen) before the scientific run');
  // 8. EraVM node and compiler
  if (P && B.anvil_zksync && fs.existsSync(B.anvil_zksync)) {
    const dir = path.join(C.CHAINBENCH, '.work', `doctor-l2-${Date.now()}`);
    try {
      const node = await A.start(path.join(dir, 'node'));
      try {
        const bd = await node.rpc.call('zks_getBlockDetails', [0]);
        const h = bd.baseSystemContractsHashes || {};
        const ok = bd.protocolVersion === E.SYSTEM_CONTRACTS.protocol_version && h.bootloader === E.SYSTEM_CONTRACTS.bootloader && h.default_aa === E.SYSTEM_CONTRACTS.default_aa;
        if (ok) rec('PASS', 'local EraVM node', `anvil-zksync offline, chain ${E.CHAIN_ID}, ${bd.protocolVersion}, bootloader ${h.bootloader.slice(0, 14)}…, start-up ${node.startup_ms} ms`);
        else rec('FAIL', 'local EraVM node', `protocol ${bd.protocolVersion}, bootloader ${h.bootloader}, default AA ${h.default_aa}`, 'rebuild the image from the committed pins');
      } finally { await A.stop(node); }
    } catch (e) { rec('FAIL', 'local EraVM node starts', String(e.message).slice(0, 200), 'check the image (./chainbench/run.sh build-image-l2) and free memory'); }
    try {
      const { manifest } = compile(['contracts/Groth16LegacyVerifierDepth5.sol'], path.join(dir, 'compile'));
      const c = manifest.contracts['contracts/Groth16LegacyVerifierDepth5.sol:Groth16LegacyVerifierDepth5'];
      rec('PASS', 'EraVM compiler', `zksolc ${manifest.compiler.zksolc_version_output} + era-solc ${manifest.compiler.era_solc_long_version}: Groth16 d5 verifier ${c.bytecode_bytes} B`);
    } catch (e) { rec('FAIL', 'EraVM compiler', String(e.message).slice(0, 200), 'rebuild the image'); }
  }
  const out = arg('--out');
  const fails = results.filter((r) => r.level === 'FAIL').length;
  const res = { schema: 'chainbench-doctor-l2/1', at_utc: C.nowUtc(), pass: fails === 0, fails, warns: results.filter((r) => r.level === 'WARN').length, results,
    image_id: process.env.CHAINBENCH_IMAGE_ID || null, host: process.env.CHAINBENCH_HOST_JSON ? JSON.parse(process.env.CHAINBENCH_HOST_JSON) : null, network_isolation: ni };
  if (out) C.writeJson(out, res);
  console.log(fails ? `DOCTOR-L2 (in container): ${fails} check(s) failed.` : 'DOCTOR-L2 (in container): all checks passed.');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
