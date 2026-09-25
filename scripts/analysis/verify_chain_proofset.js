'use strict';
// Off-chain re-verification of the frozen proof set PS-01 (CHAIN-PROTOCOL-v1 §10 item 2: "every proof verifies off-chain").
// Read-only: nothing is regenerated. For every proof in PROOFSET.csv: file sha256 = manifest, vkey sha256 = ARTIFACTS.sha256 and
// = the vkey recorded at generation, snarkjs <backend>.verify(vkey, public, proof) = true, and public[0] = the recorded root.
//   node scripts/analysis/verify_chain_proofset.js [--out file.json]
// Uses chainbench's pinned snarkjs 0.7.5 and the manifest-covered vkeys under data/ (not in git). Exit 1 on any failure.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const REPO = path.resolve(__dirname, '..', '..');
const CB = path.join(REPO, 'chainbench');
const C = require(path.join(CB, 'lib', 'common.js'));
const snarkjs = require(path.join(CB, 'node_modules', 'snarkjs', 'build', 'main.cjs'));
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
(async () => {
  const dir = C.PROOFSET_DIR;
  const lines = fs.readFileSync(path.join(dir, 'PROOFSET.csv'), 'utf8').trim().split('\n');
  const cols = lines[0].split(',');
  const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
  const res = []; const vk = {};
  for (const r of rows) {
    const a = C.art(r.backend, Number(r.depth));
    if (!vk[a.vkey]) vk[a.vkey] = { obj: JSON.parse(fs.readFileSync(path.join(REPO, a.vkey), 'utf8')), sha: C.assertManifest(a.vkey) };
    const proof = JSON.parse(fs.readFileSync(path.join(dir, r.proof_file), 'utf8'));
    const pub = JSON.parse(fs.readFileSync(path.join(dir, r.public_file), 'utf8'));
    const ok = await snarkjs[r.backend].verify(vk[a.vkey].obj, pub, proof);
    res.push({ proof_id: r.proof_id, backend: r.backend, depth: Number(r.depth), j: Number(r.j),
      proof_sha256_ok: sha(path.join(dir, r.proof_file)) === r.proof_sha256, public_sha256_ok: sha(path.join(dir, r.public_file)) === r.public_sha256,
      vkey: a.vkey, vkey_sha256: vk[a.vkey].sha, vkey_matches_generation: vk[a.vkey].sha === r.vkey_sha256,
      verified: ok === true, root_matches: pub.length === 1 && pub[0] === r.root });
  }
  const pass = res.every((x) => x.proof_sha256_ok && x.public_sha256_ok && x.vkey_matches_generation && x.verified && x.root_matches);
  const out = { tool: 'scripts/analysis/verify_chain_proofset.js', snarkjs: C.pkgVersion('snarkjs'), node: process.version,
    proofset_csv_sha256: sha(path.join(dir, 'PROOFSET.csv')), proofset_sha256_file_sha256: sha(path.join(dir, 'PROOFSET.sha256')),
    proofs: res.length, verified: res.filter((x) => x.verified).length, all_checks_pass: pass, results: res };
  const o = process.argv.indexOf('--out');
  if (o > 0) fs.writeFileSync(process.argv[o + 1], JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({ proofs: out.proofs, verified: out.verified, all_checks_pass: pass }));
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
