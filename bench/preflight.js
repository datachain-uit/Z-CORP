'use strict';
// Container pre-flight for one resource profile (protocol v3 §3.7). Untimed: no durations are
// recorded. Writes /results/environment/preflight/<session>/profile-<id>.json; exits non-zero on failure.
//
//   node preflight.js            full check (assertions + untimed proof validity)
//   node preflight.js --probe    environment + worker count only (used by the controls)
const fs = require('fs');
const path = require('path');
const { RESULTS, readJson, writeJson, environmentRecord, artifacts, snarkjsDir, nowIso } = require('./lib/common');
const { checkContainer } = require('./lib/checks');

async function proofCheck(snarkjs, backend, depth, zkeyMode) {
  const a = artifacts(backend, depth);
  const { generateInputForDepth } = require(path.join(process.env.ZCORP_REPO || '/work', 'scripts', 'setup', 'generate_input_depth.js'));
  fs.mkdirSync('/tmp/zcorp-preflight', { recursive: true });
  const inputFile = `/tmp/zcorp-preflight/input_${backend}_d${depth}.json`;
  const wtns = `/tmp/zcorp-preflight/${backend}_d${depth}.wtns`;
  generateInputForDepth(depth, 0, { outputFile: inputFile });
  const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  await snarkjs.wtns.calculate(input, a.abs.wasm, wtns);
  const zkeyArg = zkeyMode === 'mem' ? fs.readFileSync(a.abs.zkey) : a.abs.zkey;
  const { proof, publicSignals } = await snarkjs[backend].prove(zkeyArg, wtns);
  const vkey = JSON.parse(fs.readFileSync(a.abs.vkey, 'utf8'));
  const expected = String(JSON.parse(fs.readFileSync(a.abs.public, 'utf8'))[0]);
  const ok = await snarkjs[backend].verify(vkey, publicSignals, proof);
  const shifted = await snarkjs[backend].verify(vkey, [(BigInt(publicSignals[0]) + 1n).toString()], proof);
  return {
    backend, depth, zkey_mode: zkeyMode,
    proof_verifies: ok === true,
    public_root_equals_committed: String(publicSignals[0]) === expected,
    input_matches_committed: JSON.stringify(input) === JSON.stringify(JSON.parse(fs.readFileSync(a.abs.input, 'utf8'))),
    shifted_root_rejected: shifted === false,
  };
}

async function main() {
  const probe = process.argv.includes('--probe');
  const profileId = process.env.ZCORP_PROFILE;
  if (probe) {
    const snarkjs = require('snarkjs'); // loaded first, as in the harness
    const ff = require(require.resolve('ffjavascript', { paths: [snarkjsDir()] }));
    const curve = await ff.buildBn128();
    const out = { mode: 'probe', environment: environmentRecord(), ffjs_concurrency: curve.tm.concurrency, snarkjs_loaded: !!snarkjs };
    await curve.terminate();
    process.stdout.write(`ZCORP_PREFLIGHT_JSON ${JSON.stringify(out)}\n`);
    process.exit(0);
  }
  const campaign = readJson(path.join(RESULTS, 'CAMPAIGN.json'));
  const pre = checkContainer(campaign, profileId);
  const out = { utc: nowIso(), campaign_id: campaign.campaign_id, profile: profileId, image_id: process.env.ZCORP_IMAGE_ID || null,
    assertions_passed: pre.passed, failures: pre.failures, environment: pre.environment, repo_readonly: pre.repo_readonly };
  if (out.image_id !== campaign.image.built_image_id) { out.assertions_passed = false; out.failures.push('image id mismatch'); }
  if (pre.passed) {
    const snarkjs = require('snarkjs');
    out.proofs = [];
    for (const [b, d, m] of [['groth16', 5, 'path'], ['plonk', 10, 'path'], ['plonk', 11, 'path'],
      ['groth16', 5, 'mem'], ['groth16', 11, 'mem'], ['plonk', 5, 'mem'], ['plonk', 11, 'mem']]) {
      out.proofs.push(await proofCheck(snarkjs, b, d, m));
    }
    const curve = globalThis.curve_bn128;
    out.ffjs_concurrency = curve && curve.tm ? curve.tm.concurrency : null;
    const prof = campaign.profiles.find((p) => p.id === profileId);
    out.proofs_passed = out.proofs.every((p) => p.proof_verifies && p.public_root_equals_committed && p.input_matches_committed && p.shifted_root_rejected);
    out.concurrency_passed = out.ffjs_concurrency === prof.cpus;
    out.cgroup_after = require('./lib/common').cgroupState();
    out.resource_flags_passed = out.cgroup_after.oom_kill === 0 && out.cgroup_after.nr_throttled === 0;
    if (curve) await curve.terminate();
  }
  out.passed = !!(out.assertions_passed && out.proofs_passed && out.concurrency_passed && out.resource_flags_passed);
  out.session_id = process.env.ZCORP_SESSION_ID || null;
  writeJson(path.join(RESULTS, 'environment', 'preflight', process.env.ZCORP_SESSION_ID || 'nosession', `profile-${profileId}.json`), out);
  console.log(`preflight ${profileId}: ${out.passed ? 'PASS' : 'FAIL'}${out.failures.length ? ' - ' + out.failures.join(' | ') : ''}`);
  process.exit(out.passed ? 0 : 3);
}

main().catch((e) => { console.error(`preflight: ${e.stack || e}`); process.exit(1); });
