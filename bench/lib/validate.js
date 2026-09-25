'use strict';
// Campaign state and validation shared by campaign_state.js, validate_round.js and
// summarize_prover.js. A "unit" is one (kind, round) of the schedule with all its profiles;
// an "attempt" is one execution of a unit. Only accepted attempts (round_ledger.csv) count.
const fs = require('fs');
const path = require('path');
const { readJson, parseCsv } = require('./common');
const schema = require('./schema');

const unitKey = (kind, round) => `${kind}|${round}`;

function readTable(file, cols) {
  if (!fs.existsSync(file)) return { rows: [], headerOk: true, missing: true };
  const t = parseCsv(file);
  return { rows: t.rows, headerOk: t.header.join(',') === cols.join(','), missing: false };
}

function loadState(dir) {
  const campaign = readJson(path.join(dir, 'CAMPAIGN.json'));
  const sched = parseCsv(path.join(dir, 'prover', 'schedule.csv')).rows;
  const profiles = campaign.profiles;
  const runs = [], diag = [], rounds = [], headerProblems = [];
  for (const p of profiles) {
    for (const [file, cols, sink] of [['runs.csv', schema.RUNS, runs], ['diag.csv', schema.DIAG, diag], ['rounds.csv', schema.ROUNDS, rounds]]) {
      const t = readTable(path.join(dir, 'prover', p.id, file), cols);
      if (!t.headerOk) headerProblems.push(`${p.id}/${file}`);
      sink.push(...t.rows);
    }
  }
  const ledgerT = readTable(path.join(dir, 'prover', 'round_ledger.csv'), schema.LEDGER);
  if (!ledgerT.headerOk) headerProblems.push('round_ledger.csv');
  // Units in execution order: primary rounds ascending, then diagnostic rounds ascending.
  const units = [];
  for (const [kind, list] of [['primary', campaign.plan.primary_rounds], ['diag', campaign.plan.diag_rounds]]) {
    for (const r of list) {
      const cells = sched.filter((s) => s.kind === kind && Number(s.round) === r).sort((a, b) => Number(a.position) - Number(b.position));
      units.push({ kind, round: r, key: unitKey(kind, r), profiles: cells.map((c) => c.profile_id), cells: Object.fromEntries(cells.map((c) => [c.profile_id, c])) });
    }
  }
  return { dir, campaign, sched, units, runs, diag, rounds, ledger: ledgerT.rows, headerProblems };
}

const rowsOf = (st, kind, round, attempt) => ({
  rounds: st.rounds.filter((r) => r.kind === kind && Number(r.round) === round && Number(r.round_attempt) === attempt),
  runs: st.runs.filter((r) => r.kind === kind && Number(r.round) === round && Number(r.round_attempt) === attempt),
  diag: kind === 'diag' ? st.diag.filter((r) => Number(r.diag_round) === round && Number(r.round_attempt) === attempt) : [],
});

function observedAttempts(st, kind, round) {
  const s = new Set();
  for (const r of st.rounds) if (r.kind === kind && Number(r.round) === round) s.add(Number(r.round_attempt));
  for (const r of st.runs) if (r.kind === kind && Number(r.round) === round) s.add(Number(r.round_attempt));
  if (kind === 'diag') for (const r of st.diag) if (Number(r.diag_round) === round) s.add(Number(r.round_attempt));
  return [...s].sort((a, b) => a - b);
}

function ledgerFor(st, kind, round) { return st.ledger.filter((l) => l.kind === kind && Number(l.round) === round); }

function acceptedAttempt(st, kind, round) {
  const acc = ledgerFor(st, kind, round).filter((l) => l.accepted === '1');
  if (acc.length > 1) throw new Error(`more than one accepted attempt for ${kind} ${round}`);
  return acc.length ? Number(acc[0].round_attempt) : null;
}

const num = (x) => (x === '' || x === undefined ? null : Number(x));

// Round-level completeness and validity of one attempt (protocol v3 §3.2, resume rule).
function validateAttempt(st, kind, round, attempt) {
  const c = st.campaign;
  const unit = st.units.find((u) => u.kind === kind && u.round === round);
  const f = [];
  if (!unit) return { passed: false, failures: [`unit ${kind} ${round} not in schedule`] };
  const R = rowsOf(st, kind, round, attempt);
  const prof = Object.fromEntries(c.profiles.map((p) => [p.id, p]));
  const sessions = new Set([...R.rounds, ...R.runs, ...R.diag].map((r) => r.session_id));
  if (sessions.size !== 1) f.push(`attempt rows come from ${sessions.size} sessions`);
  for (const pid of unit.profiles) {
    const cell = unit.cells[pid];
    const p = prof[pid];
    const rr = R.rounds.filter((r) => r.profile_id === pid);
    if (rr.length !== 1) { f.push(`${pid}: ${rr.length} container records`); continue; }
    const x = rr[0];
    if (x.status !== 'ok') f.push(`${pid}: container status ${x.status} ${x.error}`);
    if (x.assertions_passed !== '1' || x.artifacts_verified !== '1') f.push(`${pid}: pre-flight/artifact assertions not passed`);
    if (x.repo_readonly !== '1') f.push(`${pid}: repository not read-only`);
    if (x.oom_kill !== '0' || x.nr_throttled !== '0') f.push(`${pid}: oom_kill=${x.oom_kill} nr_throttled=${x.nr_throttled}`);
    for (const k of ['zcorp_cpus', 'ffjs_concurrency', 'os_cpus_length', 'available_parallelism']) if (Number(x[k]) !== p.cpus) f.push(`${pid}: ${k}=${x[k]}`);
    if (x.cpuset !== p.cpuset) f.push(`${pid}: cpuset ${x.cpuset}`);
    if (Number(x.memory_max_bytes) !== c.expect.memory_bytes || x.swap_max !== '0') f.push(`${pid}: memory/swap limits`);
    if (x.image_id !== c.image.built_image_id) f.push(`${pid}: image ${x.image_id}`);
    // Pipeline rows.
    const pr = R.runs.filter((r) => r.profile_id === pid).sort((a, b) => Number(a.order_in_round) - Number(b.order_in_round));
    const wu = pr.filter((r) => r.warmup_kind === 'in_process');
    if (wu.map((r) => `${r.backend}:${r.depth}`).join(';') !== c.plan.warmup_in_process.join(';')) f.push(`${pid}: in-process warm-up rows`);
    if (wu.some((r) => r.is_warmup !== '1')) f.push(`${pid}: in-process warm-up not flagged`);
    const order = cell.config_order.split(';');
    if (kind === 'primary') {
      const meas = pr.filter((r) => r.warmup_kind !== 'in_process');
      if (meas.map((r) => `${r.backend}:${r.depth}`).join(';') !== cell.config_order) f.push(`${pid}: configuration rows/order ${meas.map((r) => `${r.backend}:${r.depth}`).join(';')}`);
      const wantW = round === 0 ? ['1', 'round0'] : ['0', ''];
      if (meas.some((r) => r.is_warmup !== wantW[0] || r.warmup_kind !== wantW[1])) f.push(`${pid}: warm-up flags of round rows`);
    } else {
      if (pr.length !== wu.length) f.push(`${pid}: unexpected pipeline rows in a diagnostic container`);
      const pairs = Object.fromEntries(cell.pair_orders.split(';').map((s) => s.split('=')));
      const dr = R.diag.filter((r) => r.profile_id === pid);
      if (dr.length !== 2 * order.length) f.push(`${pid}: ${dr.length} diagnostic rows, expected ${2 * order.length}`);
      for (const cfg of order) {
        const rows = dr.filter((r) => `${r.backend}:${r.depth}` === cfg).sort((a, b) => Number(a.call_position) - Number(b.call_position));
        const want = pairs[cfg] === 'path_first' ? 'path,mem' : 'mem,path';
        if (rows.map((r) => r.call).join(',') !== want) f.push(`${pid}: ${cfg} call order ${rows.map((r) => r.call)}`);
        const mem = rows.find((r) => r.call === 'mem'); const pth = rows.find((r) => r.call === 'path');
        if (!mem || mem.zkey_readfile_ms === '' || !pth || pth.zkey_readfile_ms !== '') f.push(`${pid}: ${cfg} readfile fields`);
      }
    }
  }
  // Every row of the attempt: validity, identity and the stage_sum / wall relation.
  for (const r of [...R.runs, ...R.diag]) {
    if (r.proof_valid !== '1' || r.root_matches !== '1' || r.status !== 'ok') f.push(`invalid proof or status: ${r.run_id || `${r.profile_id} ${r.backend}:${r.depth} ${r.call}`}`);
    if (r.campaign_id !== c.campaign_id || r.image_id !== c.image.built_image_id || r.manifest_sha256 !== c.manifest_sha256) f.push('identity mismatch in a row');
    if (!/^[0-9a-f]{64}$/.test(r.zkey_sha256)) f.push('row without zkey sha256');
  }
  for (const r of R.runs) {
    if (r.input_matches_committed !== '1') f.push(`input mismatch: ${r.run_id}`);
    const s = num(r.input_ms) + num(r.witness_ms) + num(r.prove_ms) + num(r.verify_first_ms);
    if (Math.abs(s - num(r.stage_sum_ms)) > 0.0025 || !(num(r.wall_ms) > num(r.stage_sum_ms))) f.push(`stage_sum/wall: ${r.run_id}`);
  }
  // Profiles ran in the scheduled order.
  const got = R.rounds.slice().sort((a, b) => a.started_at_utc.localeCompare(b.started_at_utc)).map((x) => x.profile_id);
  if (got.join(',') !== unit.profiles.join(',')) f.push(`profile order ${got} vs ${unit.profiles}`);
  return { passed: f.length === 0, failures: f, session_id: [...sessions][0] || '', rows_runs: R.runs.length, rows_diag: R.diag.length };
}

// Campaign-level ledger rules: at most one accepted attempt per unit; accepted units form a
// prefix of the execution order; every observed attempt has a ledger outcome; nothing ran for
// a unit after its accepted attempt.
function checkLedger(st) {
  const problems = [];
  let prefixOpen = true;
  for (const u of st.units) {
    let acc = null;
    try { acc = acceptedAttempt(st, u.kind, u.round); } catch (e) { problems.push(e.message); }
    if (acc !== null && !prefixOpen) problems.push(`${u.key}: accepted after an unaccepted unit`);
    if (acc === null) prefixOpen = false;
    const lrows = ledgerFor(st, u.kind, u.round);
    for (const a of observedAttempts(st, u.kind, u.round)) {
      if (!lrows.some((l) => Number(l.round_attempt) === a)) problems.push(`${u.key} attempt ${a}: no ledger outcome`);
      if (acc !== null && a > acc) problems.push(`${u.key}: attempt ${a} ran after accepted attempt ${acc}`);
    }
  }
  return problems;
}

module.exports = { unitKey, loadState, rowsOf, observedAttempts, ledgerFor, acceptedAttempt, validateAttempt, checkLedger };
