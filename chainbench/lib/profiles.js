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
function get(name) {
  const p = PROFILES[name];
  if (!p) throw new Error(`unknown profile ${name}`);
  return {
    name, ...p,
    root: path.join(CHAINBENCH, '.stage', name),
    sources: path.join(CHAINBENCH, '.stage', name, 'contracts'),
    artifacts: path.join(CHAINBENCH, `artifacts-${name}`),
    cache: path.join(CHAINBENCH, `cache-${name}`),
  };
}
module.exports = { PROFILES, get, NAMES: Object.keys(PROFILES) };
