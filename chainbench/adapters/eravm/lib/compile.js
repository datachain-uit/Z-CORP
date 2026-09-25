'use strict';
// EraVM compilation: zksolc + era-solc through standard JSON, in a fresh work directory; build manifest (§16.3).
// Sources are read from the repository (contracts/...) and the adapter's node_modules (@openzeppelin/...).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const C = require('../../../lib/common');
const E = require('./constants');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const IMPORT_RE = /import\s+(?:[^'";]*?from\s+)?["']([^"']+)["']/g;
function sourcePath(key) {
  if (key.startsWith('@openzeppelin/')) return path.join(C.CHAINBENCH, 'node_modules', key);
  if (key.startsWith('contracts/')) return path.join(C.REPO, key);
  throw new Error(`unsupported import ${key}`);
}
function collectSources(files) {
  const sources = {};
  const queue = [...files];
  while (queue.length) {
    const key = queue.shift();
    if (sources[key]) continue;
    const content = fs.readFileSync(sourcePath(key), 'utf8');
    sources[key] = content;
    for (const m of content.matchAll(IMPORT_RE)) {
      const imp = m[1];
      queue.push(imp.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(key), imp)) : imp);
    }
  }
  return Object.fromEntries(Object.keys(sources).sort().map((k) => [k, sources[k]]));
}
function headBlobEqual(rel) {
  try { return C.git(['rev-parse', `HEAD:${rel}`]) === C.git(['hash-object', rel]); } catch (e) { return false; }
}
function compile(files, workdir) {
  const B = E.binaries();
  for (const [k, p] of Object.entries({ zksolc: B.zksolc, era_solc: B.era_solc })) if (!p || !fs.existsSync(p)) throw new Error(`${k} not found (${p || 'unset'})`);
  fs.mkdirSync(workdir, { recursive: true });
  const src = collectSources(files);
  const input = { language: 'Solidity', sources: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, { content: v }])), settings: E.ZKSOLC_SETTINGS };
  const inputJson = JSON.stringify(input);
  const inPath = path.join(workdir, 'zksolc-input.json');
  fs.writeFileSync(inPath, inputJson);
  const outRaw = execFileSync(B.zksolc, ['--standard-json', inPath, '--solc', B.era_solc], { maxBuffer: 1 << 30, cwd: workdir });
  fs.writeFileSync(path.join(workdir, 'zksolc-output.json'), outRaw);
  const out = JSON.parse(outRaw.toString());
  const errors = (out.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) throw new Error(`zksolc errors: ${errors.map((e) => e.formattedMessage || e.message).join('\n').slice(0, 2000)}`);
  const contracts = {};
  for (const [file, byName] of Object.entries(out.contracts || {})) {
    for (const [name, c] of Object.entries(byName)) {
      const obj = c.evm && c.evm.bytecode && c.evm.bytecode.object;
      if (!obj) continue;
      const bytes = obj.length / 2;
      contracts[`${file}:${name}`] = {
        source: file, name, bytecode_bytes: bytes, bytecode_words: bytes / 32, bytecode_sha256: sha(Buffer.from(obj, 'hex')),
        bytecode_hash: `0x${c.hash}`, abi_sha256: sha(Buffer.from(JSON.stringify(c.abi))),
        factory_dependencies: Object.keys(c.factoryDependencies || {}).length, object_format: c.objectFormat || null,
        eravm_size_ok: bytes <= E.MAX_BYTECODE_BYTES,
      };
    }
  }
  const warn = (out.errors || []).filter((e) => e.severity !== 'error');
  const wsum = {};
  for (const w of warn) { const k = `${(w.sourceLocation || {}).file || '-'}: ${String(w.message).split('\n')[0]}`; wsum[k] = (wsum[k] || 0) + 1; }
  const sorted = Object.keys(contracts).sort().reduce((a, k) => { a[k] = contracts[k]; return a; }, {});
  const manifest = {
    arm: 'L2-EraVM',
    compiler: {
      zksolc_version_output: out.zk_version || null, era_solc_long_version: out.long_version || null,
      zksolc_cli_version: execFileSync(B.zksolc, ['--version'], { encoding: 'utf8' }).trim(),
      era_solc_cli_version: execFileSync(B.era_solc, ['--version'], { encoding: 'utf8' }).trim().split('\n').slice(1).join(' | '),
      zksolc_sha256: sha(fs.readFileSync(B.zksolc)), era_solc_sha256: sha(fs.readFileSync(B.era_solc)),
    },
    settings: E.ZKSOLC_SETTINGS,
    requested_files: [...files],
    sources: Object.entries(src).map(([k, v]) => ({ path: k, sha256: sha(Buffer.from(v)), equals_head: k.startsWith('contracts/') ? headBlobEqual(k) : null })),
    input_sha256: sha(Buffer.from(inputJson)), output_sha256: sha(outRaw),
    warnings: Object.entries(wsum).sort().map(([k, n]) => ({ warning: k, count: n })),
    contracts: sorted,
  };
  return { manifest, output: out };
}
function artifact(out, source, name) {
  const c = out.contracts && out.contracts[source] && out.contracts[source][name];
  if (!c || !c.evm.bytecode.object) throw new Error(`no EraVM artifact ${source}:${name}`);
  return { source, name, abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`, hash: `0x${c.hash}` };
}
module.exports = { compile, artifact, collectSources };
