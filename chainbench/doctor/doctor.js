'use strict';
// chainbench doctor, in-environment part (normally inside the container; run.sh does the host-side checks).
// Checks everything needed before an experiment and stops; it never runs an experiment.
//   node doctor/doctor.js [--require-clean] [--require-baseline] [--require-archived-image] [--skip-envcheck] [--out file]
// Exit 1 if any check FAILs. Every FAIL prints a remediation line.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const W = require('../core/workload');
const C = require('../lib/common');
const ID = require('../docker/identity');

const has = (f) => process.argv.includes(f);
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const results = [];
function rec(level, check, detail = '', fix = '') {
  results.push({ level, check, detail, fix });
  console.log(`[${level}] ${check}${detail ? ` — ${detail}` : ''}`);
  if (fix && level === 'FAIL') console.log(`       Fix: ${fix}`);
}

// 1. Toolchain identity against the reference image record and the accepted readiness toolchain.
const REF_IMAGE = path.join(C.CHAINBENCH, 'docker', 'IMAGE.json');
const ACCEPTED = path.join(C.CHAINBENCH, 'docker', 'ACCEPTED-TOOLCHAIN.json');
const me = ID.identity();
rec('INFO', 'toolchain', `node ${me.toolchain.runtime.node}, npm ${me.toolchain.runtime.npm}, ${me.toolchain.runtime.arch}/${me.toolchain.runtime.libc}, hardhat ${me.toolchain.packages.hardhat}, EDR ${me.toolchain.packages['@nomicfoundation/edr']}, solc ${me.toolchain.packages.solc}, geth ${me.toolchain.geth.version || 'missing'}`);
if (me.toolchain.edr_native.missing) rec('FAIL', 'EDR native binding present', me.toolchain.edr_native.package, 'rebuild the image: ./chainbench/run.sh build-image');
if (me.toolchain.geth.missing) rec('FAIL', 'geth binary present', String(process.env.CHAINBENCH_GETH_BIN), 'rebuild the image: ./chainbench/run.sh build-image');
for (const [label, file] of [['reference image record (chainbench/docker/IMAGE.json)', REF_IMAGE], ['accepted readiness toolchain (chainbench/docker/ACCEPTED-TOOLCHAIN.json)', ACCEPTED]]) {
  if (!fs.existsSync(file)) { rec('WARN', `${label} exists`, 'missing: identity not compared'); continue; }
  const c = ID.compare(file);
  const archDiff = me.toolchain.runtime.arch !== 'arm64';
  const fails = c.lines.filter((l) => l.startsWith('[FAIL]'));
  if (!fails.length) rec('PASS', `toolchain matches ${label}`, c.warns ? `${c.warns} warn-only difference(s): ${c.lines.filter((l) => l.startsWith('[WARN]')).join('; ')}` : '');
  else if (archDiff && fails.every((l) => /edr_native|runtime\.arch|geth\.sha256/.test(l))) rec('WARN', `toolchain vs ${label}`, `different architecture (${me.toolchain.runtime.arch}): only architecture-specific binaries differ: ${fails.join('; ')}`);
  else rec('FAIL', `toolchain matches ${label}`, fails.join('; '), 'rebuild the image from the committed pins (./chainbench/run.sh build-image) and do not modify chainbench/package-lock.json');
}

// 2. Network isolation (the measurement container runs with --network none).
// Judged on what can carry traffic (core/netcheck.js): kernel fallback tunnel devices that are listed but down are allowed.
const ni = me.system.network_isolation || {};
if (process.env.CHAINBENCH_NETWORK === 'none') {
  const down = (ni.interfaces || []).filter((n) => n !== 'lo');
  if (ni.isolated === true) rec('PASS', 'no network access at run time', `no interface up except loopback, no IPv4 route, no non-loopback IPv6 route${down.length ? ` (down, unroutable kernel devices: ${down.join(', ')})` : ''}`);
  else rec('FAIL', 'no network access at run time', JSON.stringify(ni), 'run through ./chainbench/run.sh (it starts containers with --network none)');
} else rec('WARN', 'network isolation', `not running inside the chainbench container (CHAINBENCH_NETWORK unset); isolated=${ni.isolated}`);

// 3. Frozen inputs: proof set manifest, protocol, contract sources.
const psDir = C.PROOFSET_DIR;
const psMan = path.join(psDir, 'PROOFSET.sha256');
if (!fs.existsSync(psMan)) rec('FAIL', 'proof-set manifest present', path.relative(C.REPO, psMan), 'restore the committed proof set (git checkout -- <path>); never regenerate it');
else {
  const lines = fs.readFileSync(psMan, 'utf8').trim().split('\n');
  const bad = lines.filter((l) => { const [h, f] = l.split(/\s+/); return !fs.existsSync(path.join(psDir, f)) || C.sha256File(path.join(psDir, f)) !== h; });
  if (bad.length) rec('FAIL', 'proof set matches its manifest', `${bad.length} of ${lines.length} files differ: ${bad.slice(0, 3).join('; ')}`, 'restore the committed proof set (git checkout -- csi/…/inputs/proofset); never regenerate it');
  else rec('PASS', 'proof set matches its manifest', `${lines.length} files, ${path.relative(C.REPO, psDir)}`);
}
if (fs.existsSync(path.join(C.REPO, C.PROTOCOL_REL))) rec('PASS', 'protocol present', `${C.PROTOCOL_REL} sha256 ${C.sha256File(path.join(C.REPO, C.PROTOCOL_REL)).slice(0, 16)}…`);
else rec('FAIL', 'protocol present', C.PROTOCOL_REL, 'check out the repository at the baseline tag');
const P = W.module('profiles');
const missing = P.NAMES.flatMap((n) => P.get(n, path.join(C.CHAINBENCH, '.work', 'doctor')).files).filter((f) => !fs.existsSync(path.join(C.REPO, f)));
if (missing.length) rec('FAIL', 'contract sources present', missing.join(', '), 'check out the repository at the baseline tag');
else rec('PASS', 'contract sources present', `${P.NAMES.map((n) => `${n}: ${P.get(n, path.join(C.CHAINBENCH, '.work', 'doctor')).files.length}`).join(', ')} files`);

// 4. Source state (git). The image records (pins.env, IMAGE.json) are excluded from the binding's path lists (the author
// pins them after the packaged dry run) and are checked here explicitly.
const CB_REL = path.relative(C.REPO, C.CHAINBENCH);
const IMAGE_RECORDS = [`${CB_REL}/docker/pins.env`, `${CB_REL}/docker/IMAGE.json`, `${CB_REL}/docker/ARCHIVE.json`];
const MEAS = W.campaign.measurement_paths || W.campaign.tracked_paths;
let head = null;
try { head = C.gitHead(); } catch (e) { rec('FAIL', 'git repository readable', String(e.message).slice(0, 120), 'run from a git clone of the repository'); }
if (head) {
  // Separate git calls: an ':(exclude)' pathspec would also exclude the image records if they were in the same call.
  const dirty = [...C.gitDirty(W.campaign.tracked_paths), ...C.gitDirty(IMAGE_RECORDS)];
  if (!dirty.length) rec('PASS', 'measurement sources clean', `HEAD ${head.slice(0, 7)}; tracked: ${W.campaign.tracked_paths.join(' ')} + image records`);
  else rec(has('--require-clean') ? 'FAIL' : 'WARN', 'measurement sources clean', `${dirty.length} change(s): ${dirty.slice(0, 5).join('; ')}`, 'commit or discard the changes (git status), then re-run');
  const prefix = W.campaign.baseline_tag_prefix;
  let tags = [];
  try { tags = C.git(['tag', '--list', `${prefix}*`, '--sort=-creatordate']).split('\n').filter(Boolean); } catch (e) { tags = []; }
  if (!tags.length) rec(has('--require-baseline') ? 'FAIL' : 'WARN', 'baseline tag', `no tag ${prefix}*`, 'the author creates the baseline tag after the packaged dry run; check out a released baseline');
  else {
    const t = tags[0];
    const tc = C.git(['rev-parse', `${t}^{commit}`]);
    let changed = '';
    try { changed = [C.git(['diff', '--name-only', tc, 'HEAD', '--', ...MEAS]), C.git(['diff', '--name-only', tc, 'HEAD', '--', ...IMAGE_RECORDS])].filter(Boolean).join('\n'); } catch (e) { changed = `error: ${e.message}`; }
    if (!changed) rec('PASS', 'baseline tag', `${t} -> ${tc.slice(0, 7)}; measurement sources and image records unchanged since the tag`);
    else rec(has('--require-baseline') ? 'FAIL' : 'WARN', 'baseline tag', `${t} -> ${tc.slice(0, 7)}; changed since the tag: ${changed.split('\n').slice(0, 5).join(', ')}`, `git checkout ${t}`);
  }
}

// 4b. The exact archived image (docker/ARCHIVE.json, written when the author archives the frozen image with `docker save`).
const ARCH_REC = path.join(C.CHAINBENCH, 'docker', 'ARCHIVE.json');
if (fs.existsSync(ARCH_REC)) {
  const ar = JSON.parse(fs.readFileSync(ARCH_REC, 'utf8'));
  const here = process.env.CHAINBENCH_IMAGE_ID || null;
  const samePlatform = ar.platform === `linux/${me.toolchain.runtime.arch}`;
  if (here && here === ar.image_id) rec('PASS', 'archived image in use', `${ar.image_id} = ${ar.archive} (sha256 ${String(ar.archive_sha256).slice(0, 16)}…)`);
  else if (!samePlatform) rec('WARN', 'archived image in use', `this platform is linux/${me.toolchain.runtime.arch}; the archived image is ${ar.platform} (a reproduction, not the archived environment)`);
  else if (process.env.CHAINBENCH_ALLOW_REBUILT_IMAGE === '1') rec('WARN', 'archived image in use', `running ${here}, archived ${ar.image_id}: reproduction with a rebuilt image (CHAINBENCH_ALLOW_REBUILT_IMAGE=1)`);
  else rec(has('--require-archived-image') ? 'FAIL' : 'WARN', 'archived image in use', `running ${here}, archived ${ar.image_id}`,
    `load the archived image: ./chainbench/run.sh load-image <path to ${ar.archive}>`);
} else rec(has('--require-archived-image') ? 'FAIL' : 'INFO', 'archived image record', 'chainbench/docker/ARCHIVE.json not present', 'the author archives the frozen image with ./chainbench/run.sh save-image');

// 5. Output locations writable.
for (const [plan, p] of Object.entries(W.workload.plans || {})) {
  const dir = path.join(C.REPO, p.out_root);
  try { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, `.doctor-${process.pid}`); fs.writeFileSync(f, 'ok'); fs.rmSync(f); rec('PASS', `output location writable (${plan})`, p.out_root); }
  catch (e) { rec('FAIL', `output location writable (${plan})`, `${p.out_root}: ${e.code || e.message}`, 'check permissions of the build/ directory in the repository clone'); }
}

// 6. Optional: PLONK verifier provenance (needs the git-ignored data/ artifacts).
const dataOk = (W.workload.optional_data_for_checks || []).every((p) => fs.existsSync(path.join(C.REPO, p)));
if (!dataOk) rec('SKIP', 'PLONK verifier provenance re-check', 'data/ artifacts not present (the committed provenance record is used)');
else {
  const r = spawnSync(process.execPath, [path.join(C.CHAINBENCH, W.script('verifier_check')), '--check-only'], { cwd: C.CHAINBENCH, encoding: 'utf8' });
  if (r.status === 0 && /ALL_CHECKS_PASS true/.test(r.stdout)) rec('PASS', 'PLONK verifier provenance re-check', '11/11 generated verifiers equal the snarkjs export of the committed zkeys');
  else rec('FAIL', 'PLONK verifier provenance re-check', (r.stdout + r.stderr).trim().split('\n').slice(-2).join(' '), 'do not edit contracts/chain/PlonkVerifierDepth*.sol; restore them from git');
}

// 7. Behavioural hardfork check (EDR osaka + prague control, and geth).
if (!has('--skip-envcheck')) {
  const tmp = path.join(os.tmpdir(), `envcheck-${process.pid}.json`);
  const args = [path.join(C.CHAINBENCH, 'scripts', 'env_check.js'), '--out', tmp];
  if (process.env.CHAINBENCH_GETH_BIN) args.push('--geth-bin', process.env.CHAINBENCH_GETH_BIN);
  const r = spawnSync(process.execPath, args, { cwd: C.CHAINBENCH, encoding: 'utf8' });
  let ec = null; try { ec = JSON.parse(fs.readFileSync(tmp, 'utf8')); } catch (e) { ec = null; }
  if (r.status === 0 && ec && ec.pass) rec('PASS', 'hardfork behaviour (Osaka)', `EDR osaka markers ${Object.values(ec.edr.osaka.markers).filter(Boolean).length}/4, prague control 0/4${ec.geth ? `, geth ${Object.values(ec.geth.markers).filter(Boolean).length}/4 (${ec.geth.client_version})` : ''}`);
  else rec('FAIL', 'hardfork behaviour (Osaka)', ec ? JSON.stringify({ edr: ec.edr && ec.edr.osaka && ec.edr.osaka.markers, geth: ec.geth && ec.geth.markers }) : (r.stderr || '').slice(-300), 'the toolchain does not implement the protocol hardfork; rebuild the image from the committed pins');
}

rec('INFO', 'resources visible to the environment', `${os.cpus().length} CPUs, ${(os.totalmem() / 2 ** 30).toFixed(1)} GiB memory`);
const fails = results.filter((r) => r.level === 'FAIL').length;
console.log(fails ? `DOCTOR: ${fails} FAIL — fix the items above before running an experiment.` : 'DOCTOR: all checks passed (no experiment was run).');
if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify({ at_utc: new Date().toISOString(), head, fails, results, identity: me }, null, 2) + '\n');
process.exit(fails ? 1 : 0);
