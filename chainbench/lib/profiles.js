'use strict';
// Compile profiles (CHAIN-PROTOCOL-v1 §4).
const path = require('path');
const { CHAINBENCH } = require('./common');
const ALL = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const PROFILES = {
  primary: {
    solcSettings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' },
    files: [
      'contracts/chain/CredentialManagerBase.sol',
      'contracts/chain/CredentialManagerGroth16.sol',
      'contracts/chain/CredentialManagerPlonk.sol',
      ...ALL.map((d) => `contracts/chain/PlonkVerifierDepth${d}.sol`),
      ...ALL.map((d) => `contracts/Groth16LegacyVerifierDepth${d}.sol`),
    ],
  },
  bridge: {
    solcSettings: { optimizer: { enabled: false, runs: 200 }, evmVersion: 'paris' },
    files: ['contracts/CredentialManager.sol', 'contracts/IGroth16Verifier.sol', 'contracts/Groth16LegacyVerifierDepth11.sol'],
  },
};
// Every build uses its own fresh work directory inside chainbench/.work/ (so that library imports resolve to
// chainbench/node_modules and no deletion of previous builds is needed): <workdir>/stage/<profile> is the
// Hardhat project root; artifacts and cache live beside it.
function defaultWorkdir() { return process.env.CHAINBENCH_WORKDIR || path.join(CHAINBENCH, '.work', 'default'); }
function get(name, workdir = defaultWorkdir()) {
  const p = PROFILES[name];
  if (!p) throw new Error(`unknown profile ${name}`);
  if (!path.resolve(workdir).startsWith(path.join(CHAINBENCH, '.work') + path.sep)) throw new Error('workdir must be inside chainbench/.work/');
  return {
    name, ...p, workdir,
    root: path.join(workdir, 'stage', name),
    sources: path.join(workdir, 'stage', name, 'contracts'),
    artifacts: path.join(workdir, `artifacts-${name}`),
    cache: path.join(workdir, `cache-${name}`),
  };
}
module.exports = { PROFILES, get, defaultWorkdir, NAMES: Object.keys(PROFILES) };
