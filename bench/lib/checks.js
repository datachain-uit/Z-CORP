'use strict';
// Container pre-flight assertions (protocol v3 §3.7). Used by preflight.js and by harness.js
// before every round. Returns a record; the caller aborts when `passed` is false.
const { environmentRecord, repoReadOnlyProbe } = require('./common');

function checkContainer(campaign, profileId) {
  const env = environmentRecord();
  const expect = campaign.expect;
  const profile = campaign.profiles.find((p) => p.id === profileId);
  const failures = [];
  const need = (cond, msg) => { if (!cond) failures.push(msg); };

  need(profile, `unknown profile ${profileId}`);
  const cg = env.cgroup;
  if (profile) {
    need(String(profile.cpus) === env.zcorp_cpus_env, `ZCORP_CPUS=${env.zcorp_cpus_env} but profile ${profile.id} has ${profile.cpus} CPUs`);
    need(cg.cpuset_effective === profile.cpuset, `effective cpuset ${cg.cpuset_effective} != ${profile.cpuset}`);
    need(env.os_cpus_length === profile.cpus, `os.cpus().length ${env.os_cpus_length} != ${profile.cpus}`);
    need(env.available_parallelism === profile.cpus, `availableParallelism ${env.available_parallelism} != ${profile.cpus}`);
  }
  need(env.adapter && env.adapter.os_cpus_after_adapter === env.os_cpus_length, 'CPU-visibility adapter not active');
  need(cg.version === expect.cgroup_version, `cgroup v${cg.version} != v${expect.cgroup_version}`);
  need(cg.quota_unlimited === true, `CPU quota present (${cg.cpu_max})`);
  need(Number(cg.memory_max_bytes) === expect.memory_bytes, `memory limit ${cg.memory_max_bytes} != ${expect.memory_bytes}`);
  need(cg.swap_disabled === true, `swap not disabled (${cg.swap_max})`);
  need(cg.oom_kill === 0, `oom_kill=${cg.oom_kill}`);
  need(cg.nr_throttled === 0, `nr_throttled=${cg.nr_throttled}`);
  need(env.process_arch === expect.arch, `arch ${env.process_arch} != ${expect.arch} (emulation or wrong image)`);
  need(env.machine === expect.machine, `machine ${env.machine} != ${expect.machine}`);
  if (expect.cpu_implementer) need(env.cpuinfo.implementer === expect.cpu_implementer, `CPU implementer ${env.cpuinfo.implementer} != ${expect.cpu_implementer}`);
  need(env.node === expect.node, `node ${env.node} != ${expect.node}`);
  need(env.packages.snarkjs === expect.snarkjs, `snarkjs ${env.packages.snarkjs}`);
  need(env.packages.ffjavascript_used_by_snarkjs === expect.ffjavascript, `ffjavascript ${env.packages.ffjavascript_used_by_snarkjs}`);
  need(env.packages.fastfile === expect.fastfile, `fastfile ${env.packages.fastfile}`);
  need(env.node_options === expect.node_options, `NODE_OPTIONS "${env.node_options}" != "${expect.node_options}"`);
  need(env.heap_size_limit_mb >= 4096, `heap limit ${env.heap_size_limit_mb} MiB`);
  const ro = repoReadOnlyProbe();
  need(ro.readonly === true, `repository is not mounted read-only (${ro.error})`);
  return { passed: failures.length === 0, failures, environment: env, repo_readonly: ro };
}

module.exports = { checkContainer };
