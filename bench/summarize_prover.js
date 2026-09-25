'use strict';
// Validates a prover campaign directory and writes derived summaries (protocol v3 §3.5, §7).
// Only the accepted attempt of each (kind, round) unit (prover/round_ledger.csv) is used;
// rows of failed or interrupted attempts are preserved but never summarised. Warm-up rows are
// excluded. wall_ms is the pipeline total; stage_sum_ms is kept as a separate derived diagnostic.
//
//   node summarize_prover.js [--campaign /results] [--allow-partial]
// Outputs: derived/prover_summary.csv, derived/prover_diag.csv, derived/validation.json.
// Exit 0 only if every validation check passes (and, without --allow-partial, all rounds are accepted).
const fs = require('fs');
const path = require('path');
const { readJson, writeJson, parseCsv, describe, CsvAppender, nowIso } = require('./lib/common');
const schema = require('./lib/schema');
const V = require('./lib/validate');
const { configOrder, pairOrders, configSeed, profileOrder } = require('./make_schedule');

function arg(name, d) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; }
const dir = arg('campaign', process.env.ZCORP_RESULTS || '/results');
const allowPartial = process.argv.includes('--allow-partial');
const num = (x) => (x === '' || x === undefined ? null : Number(x));

function main() {
  const st = V.loadState(dir);
  const c = st.campaign;
  const checks = [];
  const check = (name, passed, detail) => checks.push({ name, passed: !!passed, detail });

  // ------------------------------------------------------------------ schema
  check('schema_headers', st.headerProblems.length === 0, st.headerProblems.length ? st.headerProblems : 'raw and ledger headers match lib/schema.js');
  const idCols = ['campaign_id', 'session_id', 'round_attempt', 'profile_id', 'container_id'];
  check('schema_required_fields',
    ['stage_sum_ms', 'wall_ms', ...idCols, 'round'].every((f) => schema.RUNS.includes(f))
    && [...idCols, 'diag_round', 'zkey_readfile_ms', 'call', 'pair_order'].every((f) => schema.DIAG.includes(f))
    && idCols.every((f) => schema.ROUNDS.includes(f)), 'identity fields campaign/session/round/attempt/profile/container present');

  // ------------------------------------------------------------------ identity across all rows
  const all = [...st.runs, ...st.diag, ...st.rounds];
  const ids = new Set(all.map((r) => r.campaign_id));
  const imgs = new Set(all.map((r) => r.image_id));
  const mans = new Set([...st.runs, ...st.diag].map((r) => r.manifest_sha256));
  check('ids_campaign', all.length > 0 && ids.size === 1 && ids.has(c.campaign_id), [...ids]);
  check('ids_image', imgs.size === 1 && imgs.has(c.image.built_image_id), [...imgs]);
  check('ids_manifest', mans.size === 1 && mans.has(c.manifest_sha256), [...mans]);
  check('ids_session_and_attempt', all.every((r) => r.session_id && Number(r.round_attempt) >= 1 && r.container_id), 'every row carries session_id, round_attempt and container_id');

  // ------------------------------------------------------------------ ledger and resume rules
  const ledgerProblems = V.checkLedger(st);
  check('ledger_consistency', ledgerProblems.length === 0, ledgerProblems.length ? ledgerProblems : 'one accepted attempt at most per round; accepted rounds form a prefix; every attempt has an outcome; nothing ran after acceptance');
  const accepted = st.units.map((u) => ({ u, a: (() => { try { return V.acceptedAttempt(st, u.kind, u.round); } catch (_) { return null; } })() }));
  const done = accepted.filter((x) => x.a !== null);
  const complete = done.length === st.units.length;
  check('rounds_complete', complete || allowPartial, { accepted: done.length, scheduled: st.units.length, partial_allowed: allowPartial });
  const reval = [];
  for (const { u, a } of done) {
    const r = V.validateAttempt(st, u.kind, u.round, a);
    const led = V.ledgerFor(st, u.kind, u.round).find((l) => Number(l.round_attempt) === a);
    if (!r.passed) reval.push(`${u.key} attempt ${a}: ${r.failures.slice(0, 3).join(' | ')}`);
    if (led && r.session_id !== led.session_id) reval.push(`${u.key}: ledger session ${led.session_id} vs rows ${r.session_id}`);
  }
  check('accepted_rounds_revalidated', reval.length === 0, reval.length ? reval : `${done.length} accepted round attempts pass the round-level checks again`);
  const ledgerSummary = st.ledger.map((l) => `${l.kind}${l.round} a${l.round_attempt} ${l.status} (${l.session_id})`);

  // ------------------------------------------------------------------ schedule reproducibility
  const schedProblems = [];
  for (const s of st.sched) {
    if (configOrder(s.kind, Number(s.round), c.plan).join(';') !== s.config_order || Number(s.config_seed) !== configSeed(s.kind, Number(s.round))) schedProblems.push(`${s.kind}${s.round}/${s.profile_id} config order`);
    if (s.kind === 'diag') {
      const po = pairOrders(Number(s.round), c.plan);
      if (s.config_order.split(';').map((x) => `${x}=${po[x]}`).join(';') !== s.pair_orders) schedProblems.push(`diag${s.round} pair orders`);
    }
  }
  for (const u of st.units) {
    if (profileOrder(u.kind, u.round, c.schedule_seed, c.profiles.map((p) => p.id)).join(',') !== u.profiles.join(',')) schedProblems.push(`${u.key} profile order`);
  }
  check('seeded_schedule_reproducible', schedProblems.length === 0, schedProblems);

  // ------------------------------------------------------------------ session evidence
  const sessFile = path.join(dir, 'environment', 'sessions.csv');
  const sessions = fs.existsSync(sessFile) ? parseCsv(sessFile).rows : [];
  const sessionIds = [...new Set(sessions.map((s) => s.session_id))];
  const usedSessions = [...new Set(all.map((r) => r.session_id))];
  const sessProblems = [];
  for (const s of usedSessions) {
    if (!sessionIds.includes(s)) sessProblems.push(`${s}: not in sessions.csv`);
    for (const p of c.profiles) {
      const f = path.join(dir, 'environment', 'preflight', s, `profile-${p.id}.json`);
      if (!fs.existsSync(f) || readJson(f).passed !== true) sessProblems.push(`${s}: pre-flight ${p.id}`);
    }
    const cf = path.join(dir, 'environment', 'preflight', s, 'controls.json');
    if (!fs.existsSync(cf) || readJson(cf).passed !== true) sessProblems.push(`${s}: adapter controls`);
  }
  check('session_preflight_and_controls', sessProblems.length === 0, sessProblems.length ? sessProblems : `${usedSessions.length} session(s) with rows; each passed its container pre-flight and adapter controls`);
  const ended = sessions.filter((s) => s.event === 'end').map((s) => s.session_id);
  const integProblems = [];
  for (const s of ended) {
    const f = path.join(dir, 'environment', `integrity-${s}.json`);
    const j = fs.existsSync(f) ? readJson(f) : null;
    if (!j || !(j.manifest_before_ok && j.manifest_after_ok && j.git_status_unchanged && j.git_head_unchanged)) integProblems.push(s);
  }
  const current = process.env.ZCORP_SESSION_ID;
  if (current) {
    const f = path.join(dir, 'environment', `integrity-${current}.json`);
    const j = fs.existsSync(f) ? readJson(f) : null;
    if (!j || !(j.manifest_before_ok && j.manifest_after_ok && j.git_status_unchanged && j.git_head_unchanged)) integProblems.push(current);
  }
  check('repository_unchanged', integProblems.length === 0, integProblems.length ? integProblems : 'manifest, git HEAD and git status unchanged in every finished session');
  const p7p = path.join(dir, 'provenance', 'p7.json');
  const p7 = fs.existsSync(p7p) ? readJson(p7p) : null;
  check('provenance_p7', p7 && p7.passed === true && p7.campaign_id === c.campaign_id, p7 ? { passed: p7.passed, depths: p7.depths.length, circom: p7.tools.circom } : 'missing');

  // ------------------------------------------------------------------ derived summaries (accepted attempts only)
  const dd = path.join(dir, 'derived');
  fs.mkdirSync(dd, { recursive: true });
  for (const f of ['prover_summary.csv', 'prover_diag.csv']) fs.rmSync(path.join(dd, f), { force: true });
  const acc = new Set(done.map(({ u, a }) => `${u.key}|${a}`));
  const measured = st.runs.filter((r) => r.kind === 'primary' && r.is_warmup === '0' && acc.has(`${V.unitKey('primary', Number(r.round))}|${Number(r.round_attempt)}`));
  const diagAcc = st.diag.filter((r) => acc.has(`${V.unitKey('diag', Number(r.diag_round))}|${Number(r.round_attempt)}`));
  const sum = new CsvAppender(path.join(dd, 'prover_summary.csv'),
    ['campaign_id', 'profile_id', 'backend', 'depth', 'metric', 'rounds_used', 'round_attempts_used', 'n', 'median', 'q1', 'q3', 'iqr', 'min', 'max']);
  const groups = new Map();
  for (const r of measured) { const k = `${r.profile_id}|${r.backend}|${r.depth}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  let derivedN = 0;
  for (const [k, rs] of [...groups].sort()) {
    const [pid, backend, depth] = k.split('|');
    derivedN += rs.length;
    for (const m of schema.RUN_METRICS) {
      sum.append({ campaign_id: c.campaign_id, profile_id: pid, backend, depth, metric: m,
        rounds_used: [...new Set(rs.map((r) => r.round))].join(' '),
        round_attempts_used: [...new Set(rs.map((r) => `${r.round}a${r.round_attempt}`))].join(' '),
        ...describe(rs.map((r) => num(r[m]))) });
    }
  }
  const allMeasured = st.runs.filter((r) => r.kind === 'primary' && r.is_warmup === '0');
  check('summaries_use_accepted_attempts_only', derivedN === measured.length && measured.every((r) => r.is_warmup === '0'),
    { rows_summarised: derivedN, measured_rows_in_rejected_or_interrupted_attempts: allMeasured.length - measured.length,
      warmup_rows_excluded: st.runs.filter((r) => r.is_warmup === '1').length });
  const dsum = new CsvAppender(path.join(dd, 'prover_diag.csv'),
    ['campaign_id', 'profile_id', 'backend', 'depth', 'call', 'round_attempts_used', 'n', 'median_prove_ms', 'median_zkey_readfile_ms']);
  const dg = new Map();
  for (const r of diagAcc) { const k = `${r.profile_id}|${r.backend}|${r.depth}|${r.call}`; if (!dg.has(k)) dg.set(k, []); dg.get(k).push(r); }
  for (const [k, rs] of [...dg].sort()) {
    const [pid, backend, depth, call] = k.split('|');
    const rf = rs.map((r) => num(r.zkey_readfile_ms)).filter((x) => x !== null);
    dsum.append({ campaign_id: c.campaign_id, profile_id: pid, backend, depth, call,
      round_attempts_used: [...new Set(rs.map((r) => `${r.diag_round}a${r.round_attempt}`))].join(' '), n: rs.length,
      median_prove_ms: describe(rs.map((r) => num(r.prove_ms))).median, median_zkey_readfile_ms: rf.length ? describe(rf).median : null });
  }

  const passed = checks.every((x) => x.passed);
  writeJson(path.join(dd, 'validation.json'), { utc: nowIso(), campaign_id: c.campaign_id, mode: c.mode, plan: c.plan_name,
    passed, complete, accepted_rounds: done.length, scheduled_rounds: st.units.length, ledger: ledgerSummary, sessions: sessionIds, checks,
    note: c.mode === 'dryrun' ? 'Engineering dry run: timing values exist only to exercise the pipeline and are not interpreted.' : undefined });
  for (const x of checks) console.log(`${x.passed ? 'PASS' : 'FAIL'}  ${x.name}`);
  console.log(`validation: ${passed ? 'PASS' : 'FAIL'} (${checks.filter((x) => x.passed).length}/${checks.length}); rounds accepted ${done.length}/${st.units.length}${complete ? '' : ' (partial)'}`);
  process.exit(passed ? 0 : 5);
}

main();
