'use strict';
// Workload and campaign binding for the generic local-chain harness.
//
// The harness core (chain start-up, compilation, transaction recording, gas decomposition, cross-client
// replay, run/provenance handling) is workload- and venue-neutral. A *workload* supplies the contracts,
// inputs and cell procedure (workloads/<name>/workload.json -> modules); a *campaign binding*
// (workloads/<name>/campaigns/<id>.json) supplies venue/campaign metadata: campaign id, protocol, frozen
// input locations, tracked paths. Select with CHAINBENCH_WORKLOAD (default: zcorp) and CHAINBENCH_CAMPAIGN
// (default: the workload's default_campaign). This module must not require any other chainbench module.
const fs = require('fs');
const path = require('path');

const CHAINBENCH = path.resolve(__dirname, '..');
const NAME = process.env.CHAINBENCH_WORKLOAD || 'zcorp';
const DIR = path.join(CHAINBENCH, 'workloads', NAME);
if (!/^[a-z0-9_-]+$/.test(NAME) || !fs.existsSync(path.join(DIR, 'workload.json'))) {
  throw new Error(`chainbench: unknown workload "${NAME}" (expected chainbench/workloads/${NAME}/workload.json)`);
}
const workload = JSON.parse(fs.readFileSync(path.join(DIR, 'workload.json'), 'utf8'));
const bindingFile = process.env.CHAINBENCH_CAMPAIGN
  ? path.join(DIR, 'campaigns', `${process.env.CHAINBENCH_CAMPAIGN}.json`)
  : path.join(DIR, workload.default_campaign);
const campaign = JSON.parse(fs.readFileSync(bindingFile, 'utf8'));

// Workload-provided modules (paths relative to chainbench/): constants, profiles, plan, ops, proofset.
function loadModule(role) {
  const rel = workload.modules && workload.modules[role];
  if (!rel) throw new Error(`chainbench: workload "${NAME}" does not provide module "${role}"`);
  return require(path.join(CHAINBENCH, rel));
}
// Workload-provided scripts (paths relative to chainbench/): summarize, unit_tests, verifier_check.
function script(role) {
  const rel = workload.scripts && workload.scripts[role];
  if (!rel) throw new Error(`chainbench: workload "${NAME}" does not provide script "${role}"`);
  return rel;
}

module.exports = { CHAINBENCH, NAME, DIR, workload, campaign, bindingFile, module: loadModule, script };

if (require.main === module) {
  // node core/workload.js <script-role>  -> prints the script path (used by run/incontainer.sh)
  // node core/workload.js --json         -> prints workload + campaign binding
  const a = process.argv[2];
  if (a === '--json') console.log(JSON.stringify({ workload: NAME, binding: path.relative(CHAINBENCH, bindingFile), ...workload, campaign }, null, 2));
  else console.log(script(a));
}
