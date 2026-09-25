'use strict';
// Round-level acceptance (protocol v3 §3.2): after all profiles of one attempt of a (kind, round)
// unit have run, validate the attempt and append its outcome to prover/round_ledger.csv.
// Accepted only if every scheduled profile completed, all expected rows exist, every proof is
// valid, no OOM/throttling/pre-flight failure occurred and this session's pre-flight passed.
//
//   node validate_round.js --kind primary|diag --round <n> --attempt <a>     (ZCORP_SESSION_ID set)
const fs = require('fs');
const path = require('path');
const { RESULTS, CsvAppender, nowIso, readJson } = require('./lib/common');
const schema = require('./lib/schema');
const V = require('./lib/validate');

function arg(n) { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; }

function main() {
  const kind = arg('kind'); const round = Number(arg('round')); const attempt = Number(arg('attempt'));
  const session = process.env.ZCORP_SESSION_ID;
  if (!session || !['primary', 'diag'].includes(kind) || !Number.isInteger(round) || !Number.isInteger(attempt)) throw new Error('usage: --kind --round --attempt with ZCORP_SESSION_ID');
  const st = V.loadState(RESULTS);
  if (V.ledgerFor(st, kind, round).some((l) => Number(l.round_attempt) === attempt)) throw new Error('this attempt already has a ledger outcome');
  if (V.acceptedAttempt(st, kind, round) !== null) throw new Error('this round already has an accepted attempt');
  const res = V.validateAttempt(st, kind, round, attempt);
  if (res.session_id && res.session_id !== session) res.failures.push(`rows belong to session ${res.session_id}`);
  for (const p of st.campaign.profiles) {
    const f = path.join(RESULTS, 'environment', 'preflight', session, `profile-${p.id}.json`);
    if (!fs.existsSync(f) || readJson(f).passed !== true) res.failures.push(`session pre-flight for ${p.id} missing or failed`);
  }
  const passed = res.failures.length === 0;
  new CsvAppender(path.join(RESULTS, 'prover', 'round_ledger.csv'), schema.LEDGER).append({
    campaign_id: st.campaign.campaign_id, kind, round, round_attempt: attempt, session_id: session,
    status: passed ? 'complete' : 'failed', accepted: passed ? 1 : 0, recorded_utc: nowIso(), recorded_by_session: session,
    profiles: st.units.find((u) => u.kind === kind && u.round === round).profiles.join(';'),
    rows_runs: res.rows_runs, rows_diag: res.rows_diag, detail: passed ? '' : res.failures.slice(0, 20).join(' | '),
  });
  console.log(`round ${kind} ${round} attempt ${attempt}: ${passed ? 'ACCEPTED' : 'FAILED'}${passed ? '' : ' - ' + res.failures.slice(0, 5).join(' | ')}`);
  process.exit(passed ? 0 : 6);
}

try { main(); } catch (e) { console.error(`validate_round: ${e.message}`); process.exit(6); }
