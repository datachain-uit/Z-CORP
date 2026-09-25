'use strict';
// Shared helpers for the Z-CORP v3 prover harness (runs inside the benchmark container).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const v8 = require('v8');

const REPO = process.env.ZCORP_REPO || '/work';
const RESULTS = process.env.ZCORP_RESULTS || '/results';
const HARNESS_DIR = process.env.ZCORP_HARNESS_DIR || path.join(__dirname, '..');

// ---------------------------------------------------------------- small utils
const rd = (p) => { try { return fs.readFileSync(p, 'utf8').trim(); } catch (_) { return null; } };
const nowIso = () => new Date().toISOString();
const round3 = (x) => Math.round(x * 1000) / 1000;
const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(8 << 20);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

function kv(text, keep) {
  if (text == null) return null;
  const out = {};
  for (const line of text.split('\n')) {
    const [k, v] = line.trim().split(/\s+/);
    if (k !== undefined && v !== undefined && (!keep || keep.includes(k))) out[k] = Number(v);
  }
  return out;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

// ---------------------------------------------------------------- cgroup view
function cgroupState() {
  if (fs.existsSync('/sys/fs/cgroup/cgroup.controllers')) {
    const mem = kv(rd('/sys/fs/cgroup/memory.events'), ['oom', 'oom_kill', 'max']);
    const cpu = kv(rd('/sys/fs/cgroup/cpu.stat'), ['nr_periods', 'nr_throttled', 'throttled_usec']);
    return {
      version: 2,
      cpuset_effective: rd('/sys/fs/cgroup/cpuset.cpus.effective'),
      cpu_max: rd('/sys/fs/cgroup/cpu.max'),
      quota_unlimited: (rd('/sys/fs/cgroup/cpu.max') || '').startsWith('max'),
      memory_max_bytes: Number(rd('/sys/fs/cgroup/memory.max')) || rd('/sys/fs/cgroup/memory.max'),
      swap_max: rd('/sys/fs/cgroup/memory.swap.max'),
      swap_disabled: rd('/sys/fs/cgroup/memory.swap.max') === '0',
      memory_peak_bytes: Number(rd('/sys/fs/cgroup/memory.peak')) || null,
      oom_kill: mem ? (mem.oom_kill || 0) : null,
      oom: mem ? (mem.oom || 0) : null,
      nr_throttled: cpu ? (cpu.nr_throttled || 0) : null,
    };
  }
  // cgroup v1 (used only for the off-host engineering test; the campaign host is v2)
  const quota = rd('/sys/fs/cgroup/cpu/cpu.cfs_quota_us') || rd('/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us');
  const limit = Number(rd('/sys/fs/cgroup/memory/memory.limit_in_bytes'));
  const memsw = Number(rd('/sys/fs/cgroup/memory/memory.memsw.limit_in_bytes'));
  const oomCtl = kv(rd('/sys/fs/cgroup/memory/memory.oom_control'));
  const cpu = kv(rd('/sys/fs/cgroup/cpu/cpu.stat') || rd('/sys/fs/cgroup/cpu,cpuacct/cpu.stat'), ['nr_periods', 'nr_throttled']);
  return {
    version: 1,
    cpuset_effective: rd('/sys/fs/cgroup/cpuset/cpuset.effective_cpus') || rd('/sys/fs/cgroup/cpuset/cpuset.cpus'),
    cpu_max: quota,
    quota_unlimited: quota === '-1',
    memory_max_bytes: limit,
    swap_max: Number.isFinite(memsw) ? String(memsw - limit) : null,
    swap_disabled: Number.isFinite(memsw) && memsw === limit,
    memory_peak_bytes: Number(rd('/sys/fs/cgroup/memory/memory.max_usage_in_bytes')) || null,
    oom_kill: oomCtl ? (oomCtl.oom_kill || 0) : null,
    oom: oomCtl ? (oomCtl.under_oom || 0) : null,
    nr_throttled: cpu ? (cpu.nr_throttled || 0) : null,
  };
}

// ---------------------------------------------------------------- environment
function pkgVersion(name, fromDir) {
  try {
    const pj = require.resolve(`${name}/package.json`, { paths: [fromDir || HARNESS_DIR] });
    return JSON.parse(fs.readFileSync(pj, 'utf8')).version;
  } catch (_) {
    try {
      const main = require.resolve(name, { paths: [fromDir || HARNESS_DIR] });
      let dir = path.dirname(main);
      while (dir !== '/' && !fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
      return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    } catch (__) { return null; }
  }
}

function snarkjsDir() {
  // snarkjs' "exports" field hides package.json: resolve the entry point and walk up.
  let dir = path.dirname(require.resolve('snarkjs', { paths: [HARNESS_DIR] }));
  while (dir !== '/' && !fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
  return dir;
}

function packageVersions() {
  const sdir = snarkjsDir();
  return {
    snarkjs: pkgVersion('snarkjs'),
    ffjavascript_used_by_snarkjs: pkgVersion('ffjavascript', sdir),
    fastfile: pkgVersion('fastfile', sdir),
    binfileutils: pkgVersion('@iden3/binfileutils', sdir),
    r1csfile: pkgVersion('r1csfile', sdir),
    circom_runtime: pkgVersion('circom_runtime', sdir),
    circom2: pkgVersion('circom2'),
    circomlib: pkgVersion('circomlib'),
  };
}

function cpuinfoIdentity() {
  const text = rd('/proc/cpuinfo') || '';
  const pick = (key) => { const m = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm').exec(text); return m ? m[1].trim() : null; };
  return { implementer: pick('CPU implementer'), part: pick('CPU part'), model_name: pick('model name') };
}

function environmentRecord() {
  const osRelease = rd('/etc/os-release') || '';
  return {
    utc: nowIso(),
    container_id: os.hostname(),
    profile: process.env.ZCORP_PROFILE || null,
    zcorp_cpus_env: process.env.ZCORP_CPUS || null,
    node_options: process.env.NODE_OPTIONS || null,
    node: process.version,
    libuv: process.versions.uv,
    v8: process.versions.v8,
    process_arch: process.arch,
    machine: os.machine ? os.machine() : null,
    kernel: os.release(),
    os_release: (/^PRETTY_NAME="?([^"\n]+)"?/m.exec(osRelease) || [])[1] || null,
    cpuinfo: cpuinfoIdentity(),
    os_cpus_length: os.cpus().length,
    available_parallelism: os.availableParallelism(),
    adapter: globalThis.__zcorpCpuVisibility || null,
    heap_size_limit_mb: Math.round(v8.getHeapStatistics().heap_size_limit / 2 ** 20),
    os_totalmem_gib: +(os.totalmem() / 2 ** 30).toFixed(2),
    packages: packageVersions(),
    cgroup: cgroupState(),
  };
}

// Repository must be mounted read-only: any write attempt must fail with EROFS.
function repoReadOnlyProbe() {
  const probe = path.join(REPO, `.zcorp-ro-probe-${process.pid}`);
  try {
    fs.writeFileSync(probe, 'x');
    try { fs.unlinkSync(probe); } catch (_) { /* ignore */ }
    return { readonly: false, error: null };
  } catch (e) {
    return { readonly: e.code === 'EROFS', error: e.code || String(e) };
  }
}

// ---------------------------------------------------------------- manifest
function loadManifest() {
  const text = fs.readFileSync(path.join(REPO, 'ARTIFACTS.sha256'), 'utf8');
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m) map.set(m[2], m[1]);
  }
  return { map, sha256: sha256Hex(text) };
}

// ---------------------------------------------------------------- artifacts
function artifacts(backend, depth) {
  const b = `CredentialVerifier_Depth${depth}`;
  const rel = {
    r1cs: `data/zkp-circuits/${b}/${b}.r1cs`,
    wasm: `data/zkp-circuits/${b}/${b}_js/${b}.wasm`,
    zkey: backend === 'groth16' ? `data/zkp-circuits/${b}/${b}_0001.zkey` : `data/plonk-zkeys/${b}_plonk.zkey`,
    vkey: backend === 'groth16' ? `data/groth16-vkeys/${b}_vkey.json` : `data/plonk-vkeys/${b}_plonk_vkey.json`,
    proof: `data/${backend}-public-proof/proof_depth_${depth}_index_0.json`,
    public: `data/${backend}-public-proof/public_depth_${depth}_index_0.json`,
    input: `data/inputs/input_depth_${depth}_index_0.json`, // not manifest-covered; compared by content
  };
  const abs = {};
  for (const [k, v] of Object.entries(rel)) abs[k] = path.join(REPO, v);
  return { base: b, rel, abs };
}

const parseConfig = (s) => { const [backend, d] = s.split(':'); return { backend, depth: Number(d), key: s }; };

// ---------------------------------------------------------------- seeded order
// Deterministic permutation: sort items by sha256(label|item). Reproducible in any language.
function seededOrder(items, label) {
  return items.slice().sort((a, b) => {
    const ha = sha256Hex(`${label}|${a}`);
    const hb = sha256Hex(`${label}|${b}`);
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
}

// ---------------------------------------------------------------- stats
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function describe(values) {
  const s = values.slice().sort((a, b) => a - b);
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  return { n: s.length, median: quantile(s, 0.5), q1, q3, iqr: q3 - q1, min: s[0], max: s[s.length - 1] };
}

// ---------------------------------------------------------------- CSV
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

class CsvAppender {
  constructor(file, columns) {
    this.file = file;
    this.columns = columns;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 0) {
      const header = fs.readFileSync(file, 'utf8').split('\n')[0];
      if (header !== columns.join(',')) throw new Error(`CSV header mismatch in ${file}`);
    } else {
      fs.writeFileSync(file, columns.join(',') + '\n');
    }
  }
  append(row) {
    for (const k of Object.keys(row)) if (!this.columns.includes(k)) throw new Error(`unknown column ${k} for ${this.file}`);
    fs.appendFileSync(this.file, this.columns.map((c) => csvCell(row[c])).join(',') + '\n');
  }
}

function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return { header, rows: rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))) };
}

module.exports = {
  REPO, RESULTS, HARNESS_DIR, rd, nowIso, round3, sha256Hex, sha256File, readJson, writeJson,
  cgroupState, environmentRecord, packageVersions, repoReadOnlyProbe, loadManifest, artifacts,
  parseConfig, seededOrder, describe, CsvAppender, parseCsv, snarkjsDir,
};
