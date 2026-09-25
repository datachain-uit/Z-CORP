'use strict';
// Toolchain identity of the running chainbench environment (normally the container). Workload-neutral.
//   node docker/identity.js [--out file]                      record the identity (JSON)
//   node docker/identity.js --compare <file> [--out file]     compare this environment's `toolchain` with a reference
// A reference file holds a `toolchain` object (a complete or partial identity) and optionally `warn_only` keys
// (dotted paths whose mismatch is reported as WARN instead of FAIL). Exit 1 on any FAIL.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const CB = path.resolve(__dirname, '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const tryRun = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { return null; } };
const pkg = (name) => { try { return JSON.parse(fs.readFileSync(path.join(CB, 'node_modules', name, 'package.json'), 'utf8')).version; } catch (e) { return null; } };

function libc() {
  const h = process.report && process.report.getReport ? process.report.getReport().header : {};
  return h.glibcVersionRuntime ? `glibc ${h.glibcVersionRuntime}` : 'musl-or-other';
}
// The native EDR binding the loader selects: @nomicfoundation/edr-<platform>-<arch>-<gnu|musl>.
function edrNative() {
  const plat = os.platform(); const arch = os.arch();
  const flavour = plat === 'linux' ? (libc().startsWith('glibc') ? '-gnu' : '-musl') : '';
  const name = `edr-${plat}-${arch}${flavour}`;
  const dir = path.join(CB, 'node_modules', '@nomicfoundation', name);
  if (!fs.existsSync(dir)) return { package: `@nomicfoundation/${name}`, missing: true };
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.node'));
  return { package: `@nomicfoundation/${name}`, version: pkg(`@nomicfoundation/${name}`), file, sha256: sha(path.join(dir, file)) };
}
function geth() {
  const bin = process.env.CHAINBENCH_GETH_BIN;
  if (!bin || !fs.existsSync(bin)) return { missing: true, path: bin || null };
  const v = tryRun(bin, ['version']) || '';
  const f = (k) => ((v.match(new RegExp(`^${k}: (.*)$`, 'm')) || [])[1] || null);
  return { path: bin, sha256: sha(bin), version: f('Version'), git_commit: f('Git Commit'), go: f('Go Version'), arch: f('Architecture'),
    source: process.env.CHAINBENCH_GETH_SOURCE || null };
}
function identity() {
  const soljson = path.join(CB, 'node_modules', 'solc', 'soljson.js');
  const g = geth();
  const toolchain = {
    runtime: { node: process.version, npm: tryRun('npm', ['-v']), arch: os.arch(), libc: libc() },
    packages: Object.fromEntries(['hardhat', '@nomicfoundation/edr', '@nomicfoundation/hardhat-ethers', 'ethers', 'snarkjs', 'ffjavascript', 'solc', '@openzeppelin/contracts', 'ejs'].map((n) => [n, pkg(n)])),
    lockfile_sha256: sha(path.join(CB, 'package-lock.json')),
    package_json_sha256: sha(path.join(CB, 'package.json')),
    edr_native: edrNative(),
    soljson_sha256: fs.existsSync(soljson) ? sha(soljson) : null,
    hardhat_console_sol_sha256: fs.existsSync(path.join(CB, 'node_modules', 'hardhat', 'console.sol')) ? sha(path.join(CB, 'node_modules', 'hardhat', 'console.sol')) : null,
    geth: g.missing ? { missing: true } : { sha256: g.sha256, version: g.version, git_commit: g.git_commit, go: g.go },
  };
  let build = null;
  const bm = process.env.CHAINBENCH_BUILD_METADATA;
  if (bm && fs.existsSync(bm)) { try { build = JSON.parse(fs.readFileSync(bm, 'utf8')); } catch (e) { build = { unreadable: bm }; } }
  let host = null;
  if (process.env.CHAINBENCH_HOST_JSON) { try { host = JSON.parse(process.env.CHAINBENCH_HOST_JSON); } catch (e) { host = { raw: process.env.CHAINBENCH_HOST_JSON }; } }
  return {
    schema: 'chainbench-toolchain-identity/1',
    at_utc: new Date().toISOString(),
    toolchain,
    geth_detail: g,
    system: {
      os_release: (() => { try { return fs.readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="([^"]+)"/)[1]; } catch (e) { return null; } })(),
      kernel: os.release(), cpus: os.cpus().length, mem_bytes: os.totalmem(),
      git: tryRun('git', ['--version']), python3: tryRun('python3', ['--version']),
      apt_packages: (() => { try { return fs.readFileSync('/opt/chainbench/APT-PACKAGES.txt', 'utf8').trim().split('\n'); } catch (e) { return null; } })(),
      network_interfaces: (() => { try { return fs.readdirSync('/sys/class/net').sort(); } catch (e) { return null; } })(),
      network_isolation: require('../core/netcheck').networkIsolation(),
    },
    container: {
      image_id: process.env.CHAINBENCH_IMAGE_ID || null, image_ref: process.env.CHAINBENCH_IMAGE_REF || null,
      base_image: process.env.CHAINBENCH_BASE_IMAGE || null, geth_source: process.env.CHAINBENCH_GETH_SOURCE || null,
      network: process.env.CHAINBENCH_NETWORK || null,
    },
    host, build_metadata: build,
  };
}
function flatten(o, pre = '', out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    const key = pre ? `${pre}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out); else out[key] = v;
  }
  return out;
}
function compare(refFile) {
  const ref = JSON.parse(fs.readFileSync(refFile, 'utf8'));
  const warnOnly = new Set(ref.warn_only || []);
  const want = flatten(ref.toolchain); const got = flatten(identity().toolchain);
  const lines = []; let fails = 0; let warns = 0;
  for (const [k, v] of Object.entries(want)) {
    const same = JSON.stringify(got[k]) === JSON.stringify(v);
    if (same) lines.push(`[PASS] ${k} = ${v}`);
    else if (warnOnly.has(k) || [...warnOnly].some((w) => w.endsWith('.*') && k.startsWith(w.slice(0, -1)))) { warns++; lines.push(`[WARN] ${k}: reference ${v}, here ${got[k]}`); }
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
module.exports = { identity, compare, flatten };
