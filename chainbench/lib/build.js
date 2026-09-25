'use strict';
// Stage + compile one profile into a fresh work directory and describe the result (CHAIN-PROTOCOL-v1 §4, §8.3).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ethers } = require('ethers');
const C = require('./common');
const P = require('./profiles');
const { stage } = require('./stage');

function sortObj(o) { return Object.keys(o).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {}); }
function build(name, workdir) {
  const staged = stage(name, workdir);
  const hh = path.join(C.CHAINBENCH, 'node_modules', '.bin', 'hardhat');
  const r = spawnSync(hh, ['compile', '--force', '--quiet'], { cwd: C.CHAINBENCH, env: { ...process.env, CHAINBENCH_PROFILE: name, CHAINBENCH_WORKDIR: workdir }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`compile ${name} failed: ${r.stdout}\n${r.stderr}`);
  const p = P.get(name, workdir);
  const biDir = path.join(p.artifacts, 'build-info');
  const bis = fs.readdirSync(biDir).filter((f) => f.endsWith('.json'));
  if (bis.length !== 1) throw new Error(`expected one build-info, got ${bis.length}`);
  const bi = JSON.parse(fs.readFileSync(path.join(biDir, bis[0]), 'utf8'));
  const { outputSelection, ...settings } = bi.input.settings;
  const contracts = {};
  for (const [src, byName] of Object.entries(bi.output.contracts)) {
    for (const [cn, c] of Object.entries(byName)) {
      const init = '0x' + c.evm.bytecode.object; const rt = '0x' + c.evm.deployedBytecode.object;
      if (init === '0x') continue;
      contracts[`${src}:${cn}`] = {
        source: src, name: cn, init_bytes: (init.length - 2) / 2, runtime_bytes: (rt.length - 2) / 2,
        init_keccak: ethers.keccak256(init), runtime_keccak: ethers.keccak256(rt),
        abi_sha256: C.sha256Buf(Buffer.from(JSON.stringify(c.abi))),
        eip170_runtime_ok: (rt.length - 2) / 2 <= 24576, eip3860_initcode_ok: (init.length - 2) / 2 <= 49152,
        init_hex: init, runtime_hex: rt,
      };
    }
  }
  return {
    profile: name,
    compiler: { solc_long_version: bi.solcLongVersion, soljson_sha256: C.sha256File(require.resolve('solc/soljson.js')) },
    settings,
    staged_files: staged.files,
    sources_in_build: Object.keys(bi.input.sources).sort(),
    contracts: sortObj(contracts),
  };
}
function loadArtifact(name, workdir, sourceName, contractName) {
  const p = P.get(name, workdir);
  return JSON.parse(fs.readFileSync(path.join(p.artifacts, sourceName, `${contractName}.json`), 'utf8'));
}
module.exports = { build, loadArtifact };
