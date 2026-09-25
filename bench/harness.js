'use strict';
// Z-CORP v3 prover harness: one container = one (kind, round, profile) cell of the schedule.
//
//   node --expose-gc /opt/zcorp/harness.js --kind primary|diag --round <n> --attempt <a>
//
// Environment (set by compose/run-campaign.sh): ZCORP_PROFILE, ZCORP_CPUS, ZCORP_IMAGE_ID, ZCORP_SESSION_ID,
// ZCORP_REPO (=/work, read-only), ZCORP_RESULTS (=/results).
const fs = require('fs');
const path = require('path');
const { REPO, RESULTS, readJson, cgroupState, loadManifest, sha256File, parseConfig, parseCsv,
  seededOrder, CsvAppender, nowIso, artifacts } = require('./lib/common');
const { checkContainer } = require('./lib/checks');
const schema = require('./lib/schema');
const { gc, makeContext, runPipeline, runDiagPair } = require('./lib/pipeline');
const V = require('./lib/validate');

function arg(name) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; }

async function main() {
  const kind = arg('kind');
  const round = Number(arg('round'));
  const attempt = Number(arg('attempt'));
  const profileId = process.env.ZCORP_PROFILE;
  const session = process.env.ZCORP_SESSION_ID;
  if (!['primary', 'diag'].includes(kind) || !Number.isInteger(round) || !Number.isInteger(attempt) || attempt < 1) throw new Error('usage: --kind primary|diag --round <n> --attempt <a>');
  if (!session) throw new Error('ZCORP_SESSION_ID is required');
  // Never rerun a round that has an accepted attempt; never write into a decided or existing attempt.
  {
    const st = V.loadState(RESULTS);
    if (V.acceptedAttempt(st, kind, round) !== null) { console.error(`harness: REFUSE ${kind} round ${round} already has an accepted attempt`); process.exit(7); }
    if (V.ledgerFor(st, kind, round).some((l) => Number(l.round_attempt) >= attempt)) { console.error(`harness: REFUSE attempt ${attempt} is not newer than a recorded attempt`); process.exit(7); }
    if (st.rounds.some((r) => r.kind === kind && Number(r.round) === round && Number(r.round_attempt) === attempt && r.profile_id === profileId)) { console.error(`harness: REFUSE ${profileId} already ran ${kind} ${round} attempt ${attempt}`); process.exit(7); }
  }
  const campaign = readJson(path.join(RESULTS, 'CAMPAIGN.json'));
  const plan = campaign.plan;
  const imageId = process.env.ZCORP_IMAGE_ID || null;
  const started = nowIso();
  const profDir = path.join(RESULTS, 'prover', profileId);
  const roundsCsv = new CsvAppender(path.join(profDir, 'rounds.csv'), schema.ROUNDS);

  // Schedule cell for this container.
  const sched = parseCsv(path.join(RESULTS, 'prover', 'schedule.csv')).rows
    .find((r) => r.kind === kind && Number(r.round) === round && r.profile_id === profileId);
  if (!sched) throw new Error(`no schedule cell for ${kind} round ${round} ${profileId}`);
  const order = sched.config_order.split(';');
  const seed = Number(sched.config_seed);
  // Independent recomputation of the seeded configuration order.
  const list = kind === 'primary'
    ? plan.primary_configs.filter((c) => !plan.groth16_only_rounds.includes(round) || c.startsWith('groth16:'))
    : plan.diag_configs;
  const recomputed = seededOrder(list, `config|${kind}|seed=${seed}`);
  if (recomputed.join(';') !== sched.config_order) throw new Error('schedule config order does not match seeded recomputation');

  const failRow = (status, error, extra = {}) => roundsCsv.append({
    campaign_id: campaign.campaign_id, session_id: session, profile_id: profileId, kind, round, round_attempt: attempt,
    position_in_round: Number(sched.position), container_id: require('os').hostname(), image_id: imageId,
    started_at_utc: started, ended_at_utc: nowIso(), status, error, ...extra,
  });

  // 1. Container assertions.
  if (imageId !== campaign.image.built_image_id) { failRow('image_mismatch', `image ${imageId}`); process.exit(3); }
  const pre = checkContainer(campaign, profileId);
  if (!pre.passed) { failRow('assertion_failed', pre.failures.join(' | ')); process.exit(3); }

  // 2. Artifact integrity for everything this container touches (manifest-covered files).
  const manifest = loadManifest();
  if (manifest.sha256 !== campaign.manifest_sha256) { failRow('manifest_changed', 'ARTIFACTS.sha256 differs from campaign'); process.exit(3); }
  const configs = [...new Set([...plan.warmup_in_process, ...order])].map(parseConfig);
  const zkeyHashes = {};
  for (const c of configs) {
    const a = artifacts(c.backend, c.depth);
    for (const k of ['r1cs', 'wasm', 'zkey', 'vkey', 'public']) {
      const want = manifest.map.get(a.rel[k]);
      const got = sha256File(a.abs[k]);
      if (want !== got) { failRow('artifact_mismatch', `${a.rel[k]}`); process.exit(3); }
      if (k === 'zkey') zkeyHashes[a.rel.zkey] = got;
    }
  }

  // 3. Warm the file cache: read every key, wasm and tree file used by this container once.
  for (const c of configs) {
    const a = artifacts(c.backend, c.depth);
    fs.readFileSync(a.abs.zkey); fs.readFileSync(a.abs.wasm);
    fs.readFileSync(path.join(REPO, 'data', 'merkle-trees', `merkle_tree_data_depth_${c.depth}.json`));
  }

  // 4. Load snarkjs BEFORE any curve is built (r1csfile's nested ffjavascript resets the cache).
  const snarkjs = require('snarkjs');
  const { generateInputForDepth } = require(path.join(REPO, 'scripts', 'setup', 'generate_input_depth.js'));
  const ctx = makeContext({ snarkjs, generateInputForDepth, configs, zkeyHashes });

  const runsCsv = new CsvAppender(path.join(profDir, 'runs.csv'), schema.RUNS);
  const diagCsv = kind === 'diag' ? new CsvAppender(path.join(profDir, 'diag.csv'), schema.DIAG) : null;
  const base = { campaign_id: campaign.campaign_id, session_id: session, profile_id: profileId,
    container_id: pre.environment.container_id, image_id: imageId, manifest_sha256: manifest.sha256 };
  let written = 0;
  const writeRun = (c, idx, isWarmup, warmupKind, res, status = 'ok', error = '') => {
    runsCsv.append({ ...base, kind, run_id: `${campaign.campaign_id}/${profileId}/${kind}${round}a${attempt}/${warmupKind || 'm'}${idx}`,
      round, round_attempt: attempt, order_in_round: idx, seed, is_warmup: isWarmup, warmup_kind: warmupKind, backend: c.backend, depth: c.depth,
      leaf_index: 0, started_at_utc: res.started_at_utc, ...res.fields, status, error });
    written++;
  };
  const pipeline = async (c) => {
    gc();
    const startedAt = nowIso();
    const fields = await runPipeline(ctx, c);
    return { started_at_utc: startedAt, fields };
  };

  // 5. In-process warm-up (discarded; rows kept with is_warmup=1).
  let i = 0;
  for (const w of plan.warmup_in_process.map(parseConfig)) writeRun(w, ++i, 1, 'in_process', await pipeline(w));

  // 6. Worker pool actually used by snarkjs.
  const concurrency = globalThis.curve_bn128 && globalThis.curve_bn128.tm ? globalThis.curve_bn128.tm.concurrency : null;
  const profile = campaign.profiles.find((p) => p.id === profileId);
  if (concurrency !== profile.cpus) { failRow('concurrency_mismatch', `ffjavascript concurrency ${concurrency}`, { ffjs_concurrency: concurrency }); process.exit(3); }

  // 7. The round.
  if (kind === 'primary') {
    const warm = round === 0 ? 1 : 0;
    let k = 0;
    for (const key of order) {
      const c = parseConfig(key);
      writeRun(c, ++k, warm, warm ? 'round0' : '', await pipeline(c));
    }
  } else {
    const pairs = Object.fromEntries(sched.pair_orders.split(';').map((s) => s.split('=')));
    for (const key of order) {
      const c = parseConfig(key);
      const rows = await runDiagPair(ctx, c, pairs[key]);
      for (const r of rows) {
        diagCsv.append({ ...base, diag_round: round, round_attempt: attempt, seed, backend: c.backend, depth: c.depth, pair_order: pairs[key], ...r, status: 'ok', error: '' });
        written++;
      }
    }
  }

  // 8. Container record.
  const cg = cgroupState();
  const okFlags = cg.oom_kill === 0 && cg.nr_throttled === 0;
  roundsCsv.append({
    campaign_id: campaign.campaign_id, session_id: session, profile_id: profileId, kind, round, round_attempt: attempt,
    position_in_round: Number(sched.position), container_id: pre.environment.container_id, image_id: imageId,
    cpuset: cg.cpuset_effective, zcorp_cpus: profile.cpus,
    os_cpus_length: pre.environment.os_cpus_length, available_parallelism: pre.environment.available_parallelism,
    ffjs_concurrency: concurrency, heap_limit_mb: pre.environment.heap_size_limit_mb, started_at_utc: started,
    ended_at_utc: nowIso(), rows_written: written, memory_peak_bytes: cg.memory_peak_bytes, memory_max_bytes: cg.memory_max_bytes,
    swap_max: cg.swap_max, cpu_max: cg.cpu_max, oom_kill: cg.oom_kill, nr_throttled: cg.nr_throttled,
    repo_readonly: pre.repo_readonly.readonly, artifacts_verified: true, assertions_passed: true,
    status: okFlags ? 'ok' : 'resource_flag', error: okFlags ? '' : `oom_kill=${cg.oom_kill} nr_throttled=${cg.nr_throttled}`,
  });
  if (curveTerminate()) { /* workers stopped */ }
  process.exit(okFlags ? 0 : 4);
}

function curveTerminate() {
  try { if (globalThis.curve_bn128) { globalThis.curve_bn128.terminate(); return true; } } catch (_) { /* ignore */ }
  return false;
}

main().catch((e) => { console.error(`harness: ${e.stack || e}`); process.exit(1); });
