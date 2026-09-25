'use strict';
// Collects the adapter control runs (launched by run-campaign.sh) into environment/preflight/controls.json.
const fs = require('fs');
const path = require('path');
const { RESULTS, writeJson } = require('./lib/common');

const d = path.join(RESULTS, 'environment', 'preflight', process.env.ZCORP_SESSION_ID || 'nosession');
const exits = Object.fromEntries(fs.readFileSync(path.join(d, 'controls-exit.txt'), 'utf8').trim().split('\n').map((l) => l.split(' ')));
const read = (f) => { try { return fs.readFileSync(path.join(d, f), 'utf8'); } catch (_) { return ''; } };
const probeLine = read('control-no-adapter.out').split('\n').find((l) => l.startsWith('ZCORP_PREFLIGHT_JSON '));
const probe = probeLine ? JSON.parse(probeLine.slice('ZCORP_PREFLIGHT_JSON '.length)) : null;
const out = {
  no_adapter: 'control cpuset, adapter not loaded (ffjavascript sizes its pool from all VM CPUs)',
  no_adapter_exit: Number(exits['no-adapter']),
  no_adapter_os_cpus: probe ? probe.environment.os_cpus_length : null,
  no_adapter_available_parallelism: probe ? probe.environment.available_parallelism : null,
  no_adapter_ffjs_concurrency: probe ? probe.ffjs_concurrency : null,
  mismatch: 'control cpuset with ZCORP_CPUS = 2 x its size (adapter must abort)',
  mismatch_exit: Number(exits.mismatch),
  mismatch_stderr: read('control-mismatch.err').trim(),
  quota_only: 'CFS quota (--cpus) without cpuset, ZCORP_CPUS = quota (adapter must abort)',
  quota_only_exit: Number(exits['quota-only']),
  quota_only_stderr: read('control-quota-only.err').trim(),
};
out.control_cpuset_size = Number(exits.size);
const ok = out.mismatch_exit === 97 && out.quota_only_exit === 97 && out.no_adapter_exit === 0
  && out.no_adapter_ffjs_concurrency === out.no_adapter_os_cpus && out.no_adapter_ffjs_concurrency > out.control_cpuset_size;
out.passed = ok;
out.session_id = process.env.ZCORP_SESSION_ID || null;
writeJson(path.join(d, 'controls.json'), out);
console.log(`controls: ${ok ? 'PASS' : 'FAIL'} (no adapter -> ${out.no_adapter_ffjs_concurrency} workers on a ${out.control_cpuset_size}-CPU cpuset; mismatch exit ${out.mismatch_exit}; quota-only exit ${out.quota_only_exit})`);
process.exit(ok ? 0 : 3);
