'use strict';
// Creates CAMPAIGN.json, the frozen profile/configuration schedule and the execution plan
// (protocol v3 §3.2). Runs once per campaign inside the benchmark image (tools service).
//
//   node make_schedule.js --campaign-id <id> --mode dryrun|campaign [--schedule-seed <s>]
//
// Host facts (git commit, image IDs, ...) arrive as ZCORP_META_* environment variables.
const fs = require('fs');
const path = require('path');
const { RESULTS, HARNESS_DIR, sha256File, loadManifest, seededOrder, writeJson, CsvAppender, nowIso } = require('./lib/common');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
}

const PROFILES = (process.env.ZCORP_PROFILES || 'cpu2:1-2,cpu4:1-4,cpu8:1-8').split(',').map((s) => {
  const [id, cpuset] = s.split(':');
  const [lo, hi] = cpuset.split('-').map(Number);
  return { id, cpuset, cpus: (hi === undefined ? lo : hi) - lo + 1 };
});

const ALL_DEPTHS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const PLANS = {
  // Engineering dry run: infrastructure check only; timings are not interpreted.
  dryrun: {
    primary_configs: ['groth16:5', 'groth16:8', 'plonk:10', 'plonk:11'],
    primary_rounds: [0, 1],
    groth16_only_rounds: [],
    diag_configs: ['groth16:5', 'groth16:8', 'plonk:10', 'plonk:11'],
    diag_rounds: [1],
    warmup_in_process: ['groth16:5', 'plonk:5'],
    p7_depths: ALL_DEPTHS,
  },
  // Reduced dry run used only to test round-level resume (bench/test-resume.sh).
  resumetest: {
    primary_configs: ['groth16:5', 'plonk:10'],
    primary_rounds: [0, 1, 2],
    groth16_only_rounds: [],
    diag_configs: ['groth16:5', 'plonk:10'],
    diag_rounds: [1],
    warmup_in_process: ['groth16:5', 'plonk:5'],
    p7_depths: [5, 10],
  },
  // Full prover campaign (protocol v3 §3.2-§3.4). Not started by this build without explicit opt-in.
  campaign: {
    primary_configs: [...ALL_DEPTHS.map((d) => `groth16:${d}`), ...ALL_DEPTHS.map((d) => `plonk:${d}`)],
    primary_rounds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    groth16_only_rounds: [6, 7, 8, 9, 10],
    diag_configs: ['groth16:5', 'groth16:7', 'groth16:8', 'groth16:15', 'plonk:5', 'plonk:10', 'plonk:11', 'plonk:15'],
    diag_rounds: [1, 2, 3, 4, 5],
    warmup_in_process: ['groth16:5', 'plonk:5'],
    p7_depths: ALL_DEPTHS,
  },
};

// Cyclic Latin-square rows over the profiles; each block of three rounds uses every row once,
// in a seeded row order. A final partial block takes a seeded subset of rows.
function profileOrder(kind, round, seed, ids) {
  const rows = ids.map((_, i) => ids.slice(i).concat(ids.slice(0, i)));
  if (kind === 'primary' && round === 0) {
    const perm = seededOrder(rows.map((_, i) => String(i)), `${seed}|round0`);
    return rows[Number(perm[0])];
  }
  const blockLen = rows.length;
  const block = Math.floor((round - 1) / blockLen);
  const perm = seededOrder(rows.map((_, i) => String(i)), `${seed}|${kind}|block=${block}`);
  return rows[Number(perm[(round - 1) % blockLen])];
}

function configSeed(kind, round) { return kind === 'primary' ? round : 100 + round; }

function configOrder(kind, round, plan) {
  const list = kind === 'primary'
    ? plan.primary_configs.filter((c) => !plan.groth16_only_rounds.includes(round) || c.startsWith('groth16:'))
    : plan.diag_configs;
  return seededOrder(list, `config|${kind}|seed=${configSeed(kind, round)}`);
}

// Diagnostic pair order: within each backend, the first half of the seeded order is path-first,
// the rest mem-first; the assignment flips on even diagnostic rounds.
function pairOrders(round, plan) {
  const out = {};
  for (const backend of ['groth16', 'plonk']) {
    const cfgs = seededOrder(plan.diag_configs.filter((c) => c.startsWith(`${backend}:`)), `pair|seed=${configSeed('diag', round)}|${backend}`);
    const half = Math.ceil(cfgs.length / 2);
    cfgs.forEach((c, i) => {
      let first = i < half ? 'path_first' : 'mem_first';
      if (round % 2 === 0) first = first === 'path_first' ? 'mem_first' : 'path_first';
      out[c] = first;
    });
  }
  return out;
}

function main() {
  const campaignId = arg('campaign-id');
  const mode = arg('mode', 'dryrun');
  const planName = arg('plan', mode);
  const seed = arg('schedule-seed', 'zcorp-rerun-v3');
  if (!campaignId || !['dryrun', 'campaign'].includes(mode) || !PLANS[planName]) throw new Error('usage: --campaign-id <id> --mode dryrun|campaign [--plan dryrun|resumetest]');
  if (mode === 'campaign' && planName !== 'campaign') throw new Error('a full campaign uses the campaign plan');
  if (mode === 'dryrun' && planName === 'campaign') throw new Error('the campaign plan is not a dry run');
  const plan = JSON.parse(JSON.stringify(PLANS[planName]));
  if (process.env.ZCORP_P7_DEPTHS) plan.p7_depths = process.env.ZCORP_P7_DEPTHS.split(',').map(Number); // off-host test only; recorded
  let baseArm64 = null;
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(RESULTS, 'environment', 'base-image-index.json'), 'utf8'));
    const m = (idx.manifests || []).find((x) => x.platform && x.platform.os === 'linux' && x.platform.architecture === 'arm64');
    baseArm64 = m ? m.digest : null;
  } catch (_) { baseArm64 = null; }
  if (fs.existsSync(path.join(RESULTS, 'CAMPAIGN.json'))) throw new Error('CAMPAIGN.json already exists: refusing to overwrite a campaign');

  const manifest = loadManifest();
  const harnessFiles = ['lib/cpu-visibility.js', 'lib/common.js', 'lib/checks.js', 'lib/pipeline.js', 'lib/schema.js',
    'lib/validate.js', 'harness.js', 'preflight.js', 'provenance.js', 'make_schedule.js', 'summarize_prover.js',
    'record_controls.js', 'campaign_state.js', 'validate_round.js', 'check_resume_test.js', 'package-lock.json'];
  const harness = Object.fromEntries(harnessFiles.map((f) => [f, sha256File(path.join(HARNESS_DIR, f))]));
  const repo = process.env.ZCORP_REPO || '/work';
  const generator = Object.fromEntries(['scripts/setup/generate_input_depth.js', 'scripts/setup/paths.js']
    .map((f) => [f, sha256File(path.join(repo, f))]));
  const M = (k) => process.env[`ZCORP_META_${k}`] || null;

  const schedule = [];
  const execution = [];
  const kinds = [['primary', plan.primary_rounds], ['diag', plan.diag_rounds]];
  let seq = 0;
  for (const [kind, rounds] of kinds) {
    for (const r of rounds) {
      const order = configOrder(kind, r, plan);
      const pairs = kind === 'diag' ? pairOrders(r, plan) : null;
      profileOrder(kind, r, seed, PROFILES.map((p) => p.id)).forEach((pid, pos) => {
        const row = {
          kind, round: r, position: pos + 1, profile_id: pid, config_seed: configSeed(kind, r),
          config_order: order.join(';'),
          pair_orders: pairs ? order.map((c) => `${c}=${pairs[c]}`).join(';') : '',
        };
        schedule.push(row);
        execution.push({ seq: ++seq, kind, round: r, position: pos + 1, profile_id: pid });
      });
    }
  }

  const campaign = {
    protocol_version: 'v3',
    campaign_id: campaignId,
    mode,
    plan_name: planName,
    created_utc: nowIso(),
    schedule_seed: seed,
    profiles: PROFILES,
    plan,
    expect: {
      arch: process.env.ZCORP_EXPECT_ARCH || 'arm64',
      machine: process.env.ZCORP_EXPECT_MACHINE || 'aarch64',
      cpu_implementer: process.env.ZCORP_EXPECT_CPU_IMPLEMENTER === undefined ? '0x61' : (process.env.ZCORP_EXPECT_CPU_IMPLEMENTER || null),
      cgroup_version: Number(process.env.ZCORP_EXPECT_CGROUP || 2),
      memory_bytes: 8 * 2 ** 30,
      node: 'v18.20.8', snarkjs: '0.7.5', ffjavascript: '0.3.1', fastfile: '0.0.20',
      node_options: '--require /opt/zcorp/lib/cpu-visibility.js --max-old-space-size=4096',
    },
    repo: { commit: M('GIT_COMMIT'), dirty: M('GIT_DIRTY') === null ? null : M('GIT_DIRTY') === 'true', status_sha256: M('GIT_STATUS_SHA256'),
      campaign_paths: M('CAMPAIGN_PATHS'), campaign_paths_status_sha256: M('CAMPAIGN_PATHS_STATUS_SHA256') },
    image: {
      built_image_id: M('IMAGE_ID'),
      tag: M('IMAGE_TAG'),
      base_image_ref: M('BASE_IMAGE_REF'),
      base_arm64_manifest_digest: baseArm64,
      platform: M('PLATFORM'),
    },
    // Software environment frozen for the whole campaign; a resumed session must match it (run-campaign.sh).
    environment: {
      docker_desktop: M('DOCKER_DESKTOP'), engine: M('ENGINE'), kernel: M('KERNEL'),
      vm_ncpu: M('VM_NCPU'), vm_mem_bytes: M('VM_MEM_BYTES'), configured_memory_mib: M('CONFIGURED_MEMORY_MIB'),
    },
    host_files_sha256: { 'bench/run-campaign.sh': M('RUNNER_SHA256'), 'bench/compose.yaml': M('COMPOSE_SHA256'), 'bench/Dockerfile': M('DOCKERFILE_SHA256') },
    manifest_sha256: manifest.sha256,
    adapter_sha256: harness['lib/cpu-visibility.js'],
    harness_sha256: harness,
    input_generator_sha256: generator,
  };
  if (!campaign.image.built_image_id) throw new Error('ZCORP_META_IMAGE_ID missing');
  if (process.env.ZCORP_IMAGE_ID && process.env.ZCORP_IMAGE_ID !== campaign.image.built_image_id) throw new Error('image id mismatch');

  const schFile = path.join(RESULTS, 'prover', 'schedule.csv');
  const exFile = path.join(RESULTS, 'prover', 'execution_plan.csv');
  if (fs.existsSync(schFile) || fs.existsSync(exFile)) throw new Error('schedule files already exist');
  const sch = new CsvAppender(schFile, ['kind', 'round', 'position', 'profile_id', 'config_seed', 'config_order', 'pair_orders']);
  schedule.forEach((r) => sch.append(r));
  const ex = new CsvAppender(exFile, ['seq', 'kind', 'round', 'position', 'profile_id']);
  execution.forEach((r) => ex.append(r));
  campaign.schedule_sha256 = sha256File(schFile);
  campaign.execution_plan_sha256 = sha256File(exFile);
  writeJson(path.join(RESULTS, 'CAMPAIGN.json'), campaign); // written last: its presence marks a created campaign
  console.log(`campaign ${campaignId} (${mode}, plan ${planName}): ${execution.length} containers scheduled`);
  for (const e of execution) console.log(`  ${e.seq}. ${e.kind} round ${e.round} position ${e.position}: ${e.profile_id}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(`make_schedule: ${e.message}`); process.exit(2); }
}

module.exports = { PLANS, profileOrder, configOrder, pairOrders, configSeed };
