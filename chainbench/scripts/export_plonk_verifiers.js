'use strict';
// CHAIN-PROTOCOL-v1 §2.2: generate contracts/chain/PlonkVerifierDepth{5..15}.sol with the official
// snarkjs 0.7.5 export (zKey.exportSolidityVerifier) from the frozen, manifest-covered PLONK zkeys.
// Only change to the snarkjs output: the contract name (PlonkVerifier -> PlonkVerifierDepth{d}).
// Checks per depth: (1) zkey sha256 = ARTIFACTS.sha256; (2) vkey exported from the zkey = committed vkey;
// (3) snarkjs output = template rendered from the committed vkey; (4) written file re-reads identically.
// Usage: node scripts/export_plonk_verifiers.js [--check-only]
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const snarkjs = require('snarkjs');
const C = require('../lib/common');

const checkOnly = process.argv.includes('--check-only');
const TPL = path.join(C.SNARKJS_DIR, 'templates');
const templates = {
  groth16: fs.readFileSync(path.join(TPL, 'verifier_groth16.sol.ejs'), 'utf8'),
  plonk: fs.readFileSync(path.join(TPL, 'verifier_plonk.sol.ejs'), 'utf8'),
  fflonk: fs.readFileSync(path.join(TPL, 'verifier_fflonk.sol.ejs'), 'utf8'),
};

(async () => {
  const rows = [];
  for (let d = 5; d <= 15; d++) {
    const a = C.art('plonk', d);
    const zkeySha = C.assertManifest(a.zkey);
    const vkeySha = C.assertManifest(a.vkey);
    const committedVkey = JSON.parse(fs.readFileSync(path.join(C.REPO, a.vkey), 'utf8'));
    const exportedVkey = await snarkjs.zKey.exportVerificationKey(path.join(C.REPO, a.zkey));
    const vkeyEqual = C.canonical(exportedVkey) === C.canonical(committedVkey);
    const sol = await snarkjs.zKey.exportSolidityVerifier(path.join(C.REPO, a.zkey), templates);
    const rendered = ejs.render(templates.plonk, committedVkey);
    const renderEqual = sol === rendered;
    const nameCount = sol.split('contract PlonkVerifier {').length - 1;
    const named = sol.replace('contract PlonkVerifier {', `contract ${a.verifierName} {`);
    const onlyNameChanged = nameCount === 1 && named.replace(`contract ${a.verifierName} {`, 'contract PlonkVerifier {') === sol;
    const out = path.join(C.REPO, a.verifierSource);
    let fileEqual;
    if (checkOnly) fileEqual = fs.existsSync(out) && fs.readFileSync(out, 'utf8') === named;
    else { fs.writeFileSync(out, named); fileEqual = fs.readFileSync(out, 'utf8') === named; }
    const row = {
      depth: d, power: exportedVkey.power, nPublic: exportedVkey.nPublic,
      zkey: a.zkey, zkey_sha256: zkeySha, vkey: a.vkey, vkey_sha256: vkeySha,
      exported_vkey_equals_committed: vkeyEqual,
      snarkjs_output_sha256: C.sha256Buf(Buffer.from(sol)),
      snarkjs_output_equals_template_render_from_committed_vkey: renderEqual,
      only_contract_name_changed: onlyNameChanged,
      file: a.verifierSource, file_sha256: C.sha256Buf(Buffer.from(named)), file_matches: fileEqual,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  const ok = rows.every((r) => r.exported_vkey_equals_committed && r.snarkjs_output_equals_template_render_from_committed_vkey && r.only_contract_name_changed && r.file_matches && r.nPublic === 1);
  const prov = {
    protocol: C.PROTOCOL_REL, generated_by: 'chainbench/scripts/export_plonk_verifiers.js',
    mode: checkOnly ? 'check-only' : 'generate', at_utc: C.nowUtc(), node: process.version,
    snarkjs: C.pkgVersion('snarkjs'),
    template_sha256: C.sha256Buf(Buffer.from(templates.plonk)),
    all_checks_pass: ok, depths: rows,
  };
  if (!checkOnly) C.writeJson(path.join(C.CAMPAIGN_DIR, 'inputs', 'plonk-verifiers.provenance.json'), prov);
  console.log('ALL_CHECKS_PASS', ok);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
