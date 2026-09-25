'use strict';
// Resume bookkeeping (protocol v3 §3.2): run by run-campaign.sh at the start of every session,
// after the pre-flight. It
//   1. checks that the image's harness, the frozen schedule and the protocol version are the
//      ones recorded in CAMPAIGN.json (refuses otherwise);
//   2. records every interrupted attempt (rows present, no ledger outcome) as "incomplete" in
//      prover/round_ledger.csv - its rows are preserved and never continued;
//   3. writes prover/sessions/<session>/units.csv: the units still to run, in schedule order,
//      each with a new attempt number. Units with an accepted attempt are never rerun.
//
//   node campaign_state.js --session <session_id>
const fs = require('fs');
const path = require('path');
const { RESULTS, HARNESS_DIR, sha256File, CsvAppender, nowIso } = require('./lib/common');
const schema = require('./lib/schema');
const V = require('./lib/validate');

const PROTOCOL_VERSION = 'v3';
function arg(n) { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; }

function main() {
  const session = arg('session');
  if (!session) throw new Error('--session required');
  const st = V.loadState(RESULTS);
  const c = st.campaign;
  const bad = [];
  if (c.protocol_version !== PROTOCOL_VERSION) bad.push(`protocol version ${c.protocol_version} != ${PROTOCOL_VERSION}`);
  for (const [f, want] of Object.entries(c.harness_sha256 || {})) {
    const got = sha256File(path.join(HARNESS_DIR, f));
    if (got !== want) bad.push(`image harness file ${f} differs from the campaign record`);
  }
  if (sha256File(path.join(RESULTS, 'prover', 'schedule.csv')) !== c.schedule_sha256) bad.push('schedule.csv differs from the campaign record');
  if (sha256File(path.join(RESULTS, 'prover', 'execution_plan.csv')) !== c.execution_plan_sha256) bad.push('execution_plan.csv differs from the campaign record');
  if (st.headerProblems.length) bad.push(`raw file headers: ${st.headerProblems.join(', ')}`);
  const pre = V.checkLedger(st).filter((p) => !/no ledger outcome/.test(p));
  if (pre.length) bad.push(...pre);
  if (bad.length) { bad.forEach((b) => console.error(`campaign_state: REFUSE ${b}`)); process.exit(8); }

  // Interrupted attempts -> "incomplete" (evidence kept, never continued).
  const ledger = new CsvAppender(path.join(RESULTS, 'prover', 'round_ledger.csv'), schema.LEDGER);
  const marked = [];
  for (const u of st.units) {
    const decided = new Set(V.ledgerFor(st, u.kind, u.round).map((l) => Number(l.round_attempt)));
    for (const a of V.observedAttempts(st, u.kind, u.round)) {
      if (decided.has(a)) continue;
      const R = V.rowsOf(st, u.kind, u.round, a);
      const sess = [...new Set([...R.rounds, ...R.runs, ...R.diag].map((r) => r.session_id))].join(';');
      ledger.append({ campaign_id: c.campaign_id, kind: u.kind, round: u.round, round_attempt: a, session_id: sess,
        status: 'incomplete', accepted: 0, recorded_utc: nowIso(), recorded_by_session: session,
        profiles: [...new Set(R.rounds.map((r) => r.profile_id))].join(';'), rows_runs: R.runs.length, rows_diag: R.diag.length,
        detail: 'interrupted before round validation; rows preserved; the whole round is rerun as a new attempt' });
      marked.push(`${u.key} attempt ${a}`);
    }
  }
  const st2 = V.loadState(RESULTS);
  const after = V.checkLedger(st2);
  if (after.length) { after.forEach((b) => console.error(`campaign_state: REFUSE ${b}`)); process.exit(8); }

  // Units still to run, in schedule order.
  const todo = [];
  for (const u of st2.units) {
    if (V.acceptedAttempt(st2, u.kind, u.round) !== null) continue;
    const seen = [...V.observedAttempts(st2, u.kind, u.round), ...V.ledgerFor(st2, u.kind, u.round).map((l) => Number(l.round_attempt))];
    todo.push({ kind: u.kind, round: u.round, attempt: (seen.length ? Math.max(...seen) : 0) + 1, profiles: u.profiles.join(';') });
  }
  const dir = path.join(RESULTS, 'prover', 'sessions', session);
  fs.mkdirSync(dir, { recursive: true });
  const out = new CsvAppender(path.join(dir, 'units.csv'), ['kind', 'round', 'attempt', 'profiles']);
  todo.forEach((t) => out.append(t));
  const done = st2.units.length - todo.length;
  console.log(`campaign_state: ${c.campaign_id} session ${session}: ${done}/${st2.units.length} rounds accepted; ${todo.length} to run`);
  for (const m of marked) console.log(`campaign_state: preserved interrupted ${m} as incomplete`);
  for (const t of todo.slice(0, 3)) console.log(`campaign_state: next ${t.kind} round ${t.round} attempt ${t.attempt} (${t.profiles})`);
}

try { main(); } catch (e) { console.error(`campaign_state: ${e.stack || e}`); process.exit(8); }
