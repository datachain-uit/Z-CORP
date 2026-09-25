'use strict';
// P7: re-executes the artifact-provenance checks of protocol v3 §1.2 inside the benchmark image.
// Untimed. Writes /results/provenance/p7.json and exits non-zero if any check fails.
// Temporary files (recompiled circuits, regenerated PLONK keys, witnesses) stay in /tmp/p7.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO, RESULTS, HARNESS_DIR, readJson, writeJson, sha256File, loadManifest, artifacts, snarkjsDir, nowIso, packageVersions } = require('./lib/common');

const W = '/tmp/p7';
const PTAU = 'pot16_final.ptau';

function booleanityScan(r1cs, F, d) {
  // Wire layout of CredentialVerifier(d): 0 = one, 1 = root (public), 2..5 = credential fields,
  // 6..5+d = pathIndices[0..d-1]. Checked against the header before scanning.
  const layoutOk = r1cs.nOutputs === 0 && r1cs.nPubInputs === 1 && r1cs.nPrvInputs === 4 + 2 * d;
  let found = 0;
  for (let i = 0; i < d; i++) {
    const w = 6 + i;
    const hit = r1cs.constraints.some(([A, B, C]) => {
      const nz = (X) => Object.keys(X).filter((k) => !F.isZero(X[k])).map(Number);
      if (nz(C).length !== 0) return false;
      const chk = (X, Y) => {
        const kx = nz(X), ky = nz(Y);
        return kx.length === 1 && kx[0] === w && ky.length === 2 && ky.includes(w) && ky.includes(0) && F.eq(F.add(Y[w], Y[0]), F.zero);
      };
      return chk(A, B) || chk(B, A);
    });
    if (hit) found++;
  }
  return { layout_ok: layoutOk, found, expected: d };
}

function solEmbedsVkey(solText, vk) {
  const nums = [];
  const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (typeof x === 'string' && /^\d+$/.test(x) && x !== '0' && x !== '1') nums.push(x); };
  walk([vk.vk_alpha_1, vk.vk_beta_2, vk.vk_gamma_2, vk.vk_delta_2, vk.IC]);
  const missing = nums.filter((n) => !solText.includes(n));
  return { constants: nums.length, missing: missing.length };
}

async function main() {
  const campaign = readJson(path.join(RESULTS, 'CAMPAIGN.json'));
  const depths = campaign.plan.p7_depths;
  const snarkjs = require('snarkjs');
  const { readR1cs } = require(require.resolve('r1csfile', { paths: [snarkjsDir()] }));
  const { generateInputForDepth } = require(path.join(REPO, 'scripts', 'setup', 'generate_input_depth.js'));
  const circom2Cli = require.resolve('circom2/cli.js', { paths: [HARNESS_DIR] });
  const circomlibDir = path.dirname(require.resolve('circomlib/package.json', { paths: [HARNESS_DIR] }));
  fs.rmSync(W, { recursive: true, force: true });
  fs.mkdirSync(path.join(W, 'circuits'), { recursive: true });
  fs.mkdirSync(path.join(W, 'node_modules'), { recursive: true });
  // Copy (not symlink): the WebAssembly compiler's WASI sandbox resolves includes inside the work tree only.
  fs.cpSync(circomlibDir, path.join(W, 'node_modules', 'circomlib'), { recursive: true, dereference: true });

  const result = { utc_start: nowIso(), campaign_id: campaign.campaign_id, image_id: process.env.ZCORP_IMAGE_ID || null,
    tools: { circom: null, circom2_npm: require(path.join(path.dirname(circom2Cli), 'package.json')).version,
      circomlib: require(path.join(circomlibDir, 'package.json')).version, snarkjs: packageVersions().snarkjs },
    depths: [], checks: {} };

  // Full manifest check (all entries) inside the container.
  const manifest = loadManifest();
  let manifestOk = 0; const manifestBad = [];
  for (const [rel, want] of manifest.map) {
    const p = path.join(REPO, rel);
    if (fs.existsSync(p) && sha256File(p) === want) manifestOk++; else manifestBad.push(rel);
  }
  result.checks.manifest = { entries: manifest.map.size, ok: manifestOk, failed: manifestBad, manifest_sha256: manifest.sha256,
    passed: manifestBad.length === 0 && manifest.sha256 === campaign.manifest_sha256 };
  result.checks.ptau = { passed: manifest.map.get(PTAU) === sha256File(path.join(REPO, PTAU)), note: 'sha256 only; ceremony origin not verified' };

  const ver = spawnSync(process.execPath, [circom2Cli, '--version'], { encoding: 'utf8' });
  result.tools.circom = (ver.stdout.match(/circom compiler (\S+)/) || [])[1] || null;

  for (const d of depths) {
    const g = artifacts('groth16', d);
    const p = artifacts('plonk', d);
    const b = g.base;
    const rec = { depth: d };
    // (1) Source -> R1CS (byte identity) with circom 2.1.6 built to WebAssembly (circom2 npm 0.2.16).
    fs.copyFileSync(path.join(REPO, 'circuits', `${b}.circom`), path.join(W, 'circuits', `${b}.circom`));
    const out = path.join(W, 'out');
    fs.mkdirSync(out, { recursive: true });
    const comp = spawnSync(process.execPath, [circom2Cli, `circuits/${b}.circom`, '--r1cs', '--wasm', '--sym', '-o', out], { cwd: W, encoding: 'utf8' });
    const newR1cs = path.join(out, `${b}.r1cs`);
    const newWasm = path.join(out, `${b}_js`, `${b}.wasm`);
    rec.compile_ok = comp.status === 0 && fs.existsSync(newR1cs);
    if (!rec.compile_ok) rec.compile_error = `${comp.status} ${(comp.stderr || '').slice(-400)} ${(comp.stdout || '').slice(-400)}`;
    rec.r1cs_byte_identical = rec.compile_ok && sha256File(newR1cs) === manifest.map.get(g.rel.r1cs);
    rec.wasm_byte_identical_to_circom2_build = rec.compile_ok && sha256File(newWasm) === manifest.map.get(g.rel.wasm);
    // (2) Committed wasm: witness identical to the circom2-built wasm and satisfies the committed R1CS.
    const inputFile = path.join(W, `input_d${d}.json`);
    generateInputForDepth(d, 0, { outputFile: inputFile });
    const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    rec.input_matches_committed = JSON.stringify(input) === JSON.stringify(JSON.parse(fs.readFileSync(g.abs.input, 'utf8')));
    const wA = path.join(W, `committed_d${d}.wtns`);
    const wB = path.join(W, `rebuilt_d${d}.wtns`);
    await snarkjs.wtns.calculate(input, g.abs.wasm, wA);
    if (rec.compile_ok) await snarkjs.wtns.calculate(input, newWasm, wB);
    rec.witness_identical = rec.compile_ok && sha256File(wA) === sha256File(wB);
    rec.witness_satisfies_committed_r1cs = (await snarkjs.wtns.check(g.abs.r1cs, wA)) === true;
    // (3) Constraint count and booleanity scan on the committed R1CS.
    const r1cs = await readR1cs(g.abs.r1cs, { loadConstraints: true, loadMap: false });
    rec.r1cs_constraints = r1cs.nConstraints;
    rec.constraint_count_ok = r1cs.nConstraints === 297 + 243 * d;
    rec.booleanity = booleanityScan(r1cs, r1cs.curve.Fr, d);
    // (4) Groth16 zkey derived from R1CS + ptau.
    rec.groth16_zkey_verify = (await snarkjs.zKey.verifyFromR1cs(g.abs.r1cs, path.join(REPO, PTAU), g.abs.zkey)) === true;
    // (5) PLONK zkey: deterministic regeneration, byte identity.
    const regen = path.join(W, `plonk_d${d}.zkey`);
    await snarkjs.plonk.setup(g.abs.r1cs, path.join(REPO, PTAU), regen);
    rec.plonk_zkey_regenerated_identical = sha256File(regen) === manifest.map.get(p.rel.zkey);
    fs.rmSync(regen, { force: true });
    // (6) vkeys, verifier contract, committed proofs.
    const gvk = JSON.parse(fs.readFileSync(g.abs.vkey, 'utf8'));
    const pvk = JSON.parse(fs.readFileSync(p.abs.vkey, 'utf8'));
    rec.groth16_vkey_export_equal = JSON.stringify(await snarkjs.zKey.exportVerificationKey(g.abs.zkey)) === JSON.stringify(gvk);
    const pExp = await snarkjs.zKey.exportVerificationKey(p.abs.zkey);
    rec.plonk_vkey_export_equal = JSON.stringify(pExp) === JSON.stringify(pvk);
    rec.plonk_power = pExp.power;
    const sol = solEmbedsVkey(fs.readFileSync(path.join(REPO, 'contracts', `Groth16LegacyVerifierDepth${d}.sol`), 'utf8'), gvk);
    rec.sol_embeds_groth16_vkey = sol.missing === 0 && sol.constants > 0;
    for (const [name, x, vk] of [['groth16', g, gvk], ['plonk', p, pvk]]) {
      const pub = JSON.parse(fs.readFileSync(x.abs.public, 'utf8'));
      const prf = JSON.parse(fs.readFileSync(x.abs.proof, 'utf8'));
      rec[`${name}_committed_proof_verifies`] = (await snarkjs[name].verify(vk, pub, prf)) === true && String(pub[0]) === String(input.root);
    }
    rec.passed = rec.r1cs_byte_identical && rec.witness_identical && rec.witness_satisfies_committed_r1cs && rec.input_matches_committed
      && rec.constraint_count_ok && rec.booleanity.layout_ok && rec.booleanity.found === d && rec.groth16_zkey_verify
      && rec.plonk_zkey_regenerated_identical && rec.groth16_vkey_export_equal && rec.plonk_vkey_export_equal
      && rec.plonk_power === (d <= 10 ? 15 : 16) && rec.sol_embeds_groth16_vkey && rec.groth16_committed_proof_verifies
      && rec.plonk_committed_proof_verifies;
    result.depths.push(rec);
    console.log(`P7 d=${d}: ${rec.passed ? 'PASS' : 'FAIL'}`);
  }
  result.utc_end = nowIso();
  result.passed = result.checks.manifest.passed && result.checks.ptau.passed && result.tools.circom === '2.1.6'
    && result.depths.length === depths.length && result.depths.every((r) => r.passed);
  result.notes = [
    'R1CS byte identity is checked with circom 2.1.6 compiled to WebAssembly (circom2 npm 0.2.16), architecture-independent.',
    'The circom2 build of the witness-calculator wasm is not byte-identical to the committed wasm (native circom 2.1.6 build); equivalence is checked by identical witnesses for the committed input and by wtns check against the committed R1CS.',
    'Byte identity of the committed wasm with the native circom 2.1.6 binary was established separately on 2026-09-24 (protocol §1.2).',
  ];
  writeJson(path.join(RESULTS, 'provenance', 'p7.json'), result);
  console.log(`P7 overall: ${result.passed ? 'PASS' : 'FAIL'}`);
  if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
  process.exit(result.passed ? 0 : 3);
}

main().catch((e) => { console.error(`provenance: ${e.stack || e}`); process.exit(1); });
