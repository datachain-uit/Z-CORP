'use strict';
// Shared helpers for chainbench (CSI-CHAIN-LOCAL-01, CHAIN-PROTOCOL-v1).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const CHAINBENCH = path.resolve(__dirname, '..');
const REPO = path.resolve(CHAINBENCH, '..');
const CAMPAIGN_ID = 'CSI-CHAIN-LOCAL-01';
const CAMPAIGN_DIR = path.join(REPO, 'csi', 'campaigns', 'chain', CAMPAIGN_ID);
const PROTOCOL_REL = 'csi/protocols/chain/CHAIN-PROTOCOL-v1.md';
const PROOFSET_DIR = path.join(CAMPAIGN_DIR, 'inputs', 'proofset');
// snarkjs does not export ./package.json; read it from the chainbench install directly.
const SNARKJS_DIR = path.join(CHAINBENCH, 'node_modules', 'snarkjs');
function pkgVersion(name) { return JSON.parse(fs.readFileSync(path.join(CHAINBENCH, 'node_modules', name, 'package.json'), 'utf8')).version; }

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function sha256Buf(b) { return crypto.createHash('sha256').update(b).digest('hex'); }

// Canonical JSON: sorted keys, no whitespace. Used only for equality checks.
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

// ARTIFACTS.sha256 (repository artifact manifest): "sha256  relative/path"
function artifactManifest() {
  const m = {};
  for (const line of fs.readFileSync(path.join(REPO, 'ARTIFACTS.sha256'), 'utf8').split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t.length === 2) m[t[1].replace(/^\*/, '')] = t[0];
  }
  return m;
}
function assertManifest(rel) {
  const m = artifactManifest();
  if (!m[rel]) throw new Error(`not in ARTIFACTS.sha256: ${rel}`);
  const got = sha256File(path.join(REPO, rel));
  if (got !== m[rel]) throw new Error(`sha256 mismatch for ${rel}: ${got} != ${m[rel]}`);
  return got;
}

function git(args) { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function gitHead() { return git(['rev-parse', 'HEAD']); }
function gitDirty(paths) {
  const out = git(['status', '--porcelain', '--', ...paths]);
  return out ? out.split('\n') : [];
}

// Repository artifact paths used by this campaign (all manifest-covered).
function art(backend, depth) {
  const d = depth;
  const base = `data/zkp-circuits/CredentialVerifier_Depth${d}`;
  return backend === 'groth16'
    ? {
        zkey: `${base}/CredentialVerifier_Depth${d}_0001.zkey`,
        vkey: `data/groth16-vkeys/CredentialVerifier_Depth${d}_vkey.json`,
        wasm: `${base}/CredentialVerifier_Depth${d}_js/CredentialVerifier_Depth${d}.wasm`,
        committedPublic: `data/groth16-public-proof/public_depth_${d}_index_0.json`,
        verifierSource: `contracts/Groth16LegacyVerifierDepth${d}.sol`,
        verifierName: `Groth16LegacyVerifierDepth${d}`,
      }
    : {
        zkey: `data/plonk-zkeys/CredentialVerifier_Depth${d}_plonk.zkey`,
        vkey: `data/plonk-vkeys/CredentialVerifier_Depth${d}_plonk_vkey.json`,
        wasm: `${base}/CredentialVerifier_Depth${d}_js/CredentialVerifier_Depth${d}.wasm`,
        committedPublic: `data/plonk-public-proof/public_depth_${d}_index_0.json`,
        verifierSource: `contracts/chain/PlonkVerifierDepth${d}.sol`,
        verifierName: `PlonkVerifierDepth${d}`,
      };
}

function writeJson(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }
function nowUtc() { return new Date().toISOString(); }

module.exports = {
  CHAINBENCH, REPO, CAMPAIGN_ID, CAMPAIGN_DIR, PROTOCOL_REL, PROOFSET_DIR, SNARKJS_DIR, pkgVersion,
  sha256File, sha256Buf, canonical, artifactManifest, assertManifest, git, gitHead, gitDirty, art, writeJson, nowUtc,
};
