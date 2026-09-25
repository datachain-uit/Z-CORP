'use strict';
// Z-CORP benchmark harness component: CPU-visibility adapter.
// Loaded with `node --require cpu-visibility.js` (via NODE_OPTIONS) inside a resource-profile container.
//
// Why it exists: ffjavascript sizes its worker pool from os.cpus().length. Inside a container,
// os.cpus() lists every CPU of the Linux VM; a cgroup cpuset changes only the scheduling
// affinity, not that list. This adapter makes os.cpus() return exactly the CPUs of the
// effective cpuset, so ffjavascript starts one worker per allocated CPU.
//
// What it does, and nothing else:
//   1. reads the effective cpuset of this container (cgroup v2, or v1 fallback);
//   2. aborts (exit 97) unless cpuset size == sched-affinity size == ZCORP_CPUS;
//   3. replaces os.cpus() by a function returning the entries of exactly those CPUs;
//   4. exposes the values it used as a frozen, non-enumerable global for the harness to record.
// It does not touch snarkjs, ffjavascript, the prover, timers, the filesystem or any other API.
const os = require('os');
const fs = require('fs');

function abort(msg) {
  process.stderr.write(`[cpu-visibility] ABORT: ${msg}\n`);
  process.exit(97);
}

function parseCpuList(text) {
  const ids = [];
  for (const part of text.trim().split(',')) {
    if (part === '') continue;
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) abort(`cannot parse cpuset "${text}"`);
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    for (let i = lo; i <= hi; i++) ids.push(i);
  }
  return ids;
}

function readFirst(paths) {
  for (const p of paths) {
    try { return { path: p, value: fs.readFileSync(p, 'utf8').trim() }; } catch (_) { /* try next */ }
  }
  return null;
}

const wanted = Number(process.env.ZCORP_CPUS);
if (!Number.isInteger(wanted) || wanted < 1) abort('ZCORP_CPUS is not set to a positive integer');

const src = readFirst([
  '/sys/fs/cgroup/cpuset.cpus.effective',      // cgroup v2
  '/sys/fs/cgroup/cpuset/cpuset.effective_cpus', // cgroup v1
  '/sys/fs/cgroup/cpuset/cpuset.cpus',           // cgroup v1
]);
if (!src || src.value === '') abort('no effective cpuset found (not a cpuset-limited Linux container?)');

const cpusetIds = parseCpuList(src.value);
const affinity = os.availableParallelism();
if (cpusetIds.length !== wanted) abort(`effective cpuset "${src.value}" has ${cpusetIds.length} CPU(s), ZCORP_CPUS=${wanted}`);
if (affinity !== wanted) abort(`scheduler affinity allows ${affinity} CPU(s), ZCORP_CPUS=${wanted}`);

const originalCpus = os.cpus;
const before = originalCpus.call(os);
for (const id of cpusetIds) {
  if (before[id] === undefined) abort(`cpuset CPU ${id} is not listed by os.cpus() (${before.length} entries)`);
}

os.cpus = function cpus() {
  const all = originalCpus.call(os);
  return cpusetIds.map((id) => all[id]);
};

Object.defineProperty(globalThis, '__zcorpCpuVisibility', {
  value: Object.freeze({
    zcorp_cpus: wanted,
    cpuset: src.value,
    cpuset_source: src.path,
    cpuset_ids: Object.freeze(cpusetIds.slice()),
    available_parallelism: affinity,
    os_cpus_before_adapter: before.length,
    os_cpus_after_adapter: os.cpus().length,
  }),
  enumerable: false,
});
