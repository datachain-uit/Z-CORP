'use strict';
// Toolchain identity of the chainbench-l2 environment (normally the container).
//   node adapters/eravm/scripts/identity_l2.js [--out file]
//   node adapters/eravm/scripts/identity_l2.js --compare <IMAGE.json> [--out file]   compare `toolchain` with a reference
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('../lib/constants');
const A = require('../lib/anvil');
const { flatten } = require('../../../docker/identity');

const CB = path.resolve(__dirname, '..', '..', '..');
const ADAPTER = path.resolve(__dirname, '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const tryRun = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { return null; } };
const pkg = (n) => { try { return JSON.parse(fs.readFileSync(path.join(CB, 'node_modules', n, 'package.json'), 'utf8')).version; } catch (e) { return null; } };
function libc() { const h = process.report && process.report.getReport ? process.report.getReport().header : {}; return h.glibcVersionRuntime ? `glibc ${h.glibcVersionRuntime}` : 'musl-or-other'; }
function binId(p, args) { if (!p || !fs.existsSync(p)) return { missing: true }; return { sha256: A.sha256File(p), version: tryRun(p, args) }; }
function identity() {
  const B = E.binaries();
  const toolchain = {
    runtime: { node: process.version, npm: tryRun('npm', ['-v']), arch: os.arch(), libc: libc() },
    packages: Object.fromEntries(['ethers', 'zksync-ethers', 'snarkjs', 'ffjavascript', '@openzeppelin/contracts'].map((n) => [n, pkg(n)])),
    lockfile_sha256: A.sha256File(path.join(ADAPTER, 'package-lock.json')),
    package_json_sha256: A.sha256File(path.join(ADAPTER, 'package.json')),
    anvil_zksync: binId(B.anvil_zksync, ['--version']),
    zksolc: binId(B.zksolc, ['--version']),
    era_solc: (() => { const b = binId(B.era_solc, ['--version']); if (b.version) b.version = b.version.split('\n').slice(1).join(' | '); return b; })(),
  };
  let host = null;
  if (process.env.CHAINBENCH_HOST_JSON) { try { host = JSON.parse(process.env.CHAINBENCH_HOST_JSON); } catch (e) { host = { raw: process.env.CHAINBENCH_HOST_JSON }; } }
  let build = null;
  const bm = process.env.CHAINBENCH_BUILD_METADATA;
  if (bm && fs.existsSync(bm)) { try { build = JSON.parse(fs.readFileSync(bm, 'utf8')); } catch (e) { build = { unreadable: bm }; } }
  return {
    schema: 'chainbench-l2-toolchain-identity/1', at_utc: new Date().toISOString(), toolchain,
    pins_for_this_arch: (() => { try { return E.archPins(); } catch (e) { return { error: e.message }; } })(),
    system: {
      os_release: (() => { try { return fs.readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="([^"]+)"/)[1]; } catch (e) { return null; } })(),
      kernel: os.release(), cpus: os.cpus().length, mem_bytes: os.totalmem(), git: tryRun('git', ['--version']), python3: tryRun('python3', ['--version']),
      apt_packages: (() => { try { return fs.readFileSync('/opt/chainbench/APT-PACKAGES.txt', 'utf8').trim().split('\n'); } catch (e) { return null; } })(),
      eravm_versions: (() => { try { return fs.readFileSync('/opt/eravm/VERSIONS.txt', 'utf8').trim().split('\n'); } catch (e) { return null; } })(),
      network_isolation: require('../../../core/netcheck').networkIsolation(),
    },
    container: { image_id: process.env.CHAINBENCH_IMAGE_ID || null, image_ref: process.env.CHAINBENCH_IMAGE_REF || null, base_image: process.env.CHAINBENCH_BASE_IMAGE || null, network: process.env.CHAINBENCH_NETWORK || null },
    host, build_metadata: build,
  };
}
function compare(refFile) {
  const ref = JSON.parse(fs.readFileSync(refFile, 'utf8'));
  const warnOnly = new Set(ref.warn_only || []);
  const want = flatten(ref.toolchain); const got = flatten(identity().toolchain);
  const lines = []; let fails = 0; let warns = 0;
  for (const [k, v] of Object.entries(want)) {
    if (JSON.stringify(got[k]) === JSON.stringify(v)) lines.push(`[PASS] ${k} = ${v}`);
    else if (warnOnly.has(k)) { warns++; lines.push(`[WARN] ${k}: reference ${v}, here ${got[k]}`); }
    else { fails++; lines.push(`[FAIL] ${k}: reference ${v}, here ${got[k]}`); }
  }
  return { reference: path.relative(CB, path.resolve(refFile)), fails, warns, lines };
}
if (require.main === module) {
  const refFile = arg('--compare');
  const res = refFile ? compare(refFile) : identity();
  if (refFile) console.log(res.lines.join('\n'));
  const out = arg('--out');
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 2) + '\n');
  if (!refFile && !out) console.log(JSON.stringify(res, null, 2));
  process.exit(refFile && res.fails ? 1 : 0);
}
module.exports = { identity, compare };
