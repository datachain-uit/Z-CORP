'use strict';
// Checks the outcome of bench/test-resume.sh (engineering dry run of round-level resume).
// Expected history of the reduced dry run (units: primary0, primary1, primary2, diag1):
//   session 1: primary0 accepted (attempt 1), then a clean planned stop;
//   session 2: resume; primary0 skipped; primary1 attempt 1 interrupted after one container;
//   session 3: resume; primary1 attempt 1 preserved as "incomplete"; primary1 rerun whole as
//              attempt 2 and accepted; primary2 and diag1 accepted; final validation PASS.
// Plus: a direct harness call for the accepted primary0 is refused (exit 7) without new rows,
// and resumes of a copy with an altered schedule or another recorded git commit are refused.
const fs = require('fs');
const path = require('path');
const { RESULTS, readJson, parseCsv, writeJson } = require('./lib/common');
const V = require('./lib/validate');

const checks = [];
const check = (name, ok, detail) => checks.push({ name, passed: !!ok, detail });
const st = V.loadState(RESULTS);
const sessions = parseCsv(path.join(RESULTS, 'environment', 'sessions.csv')).rows;
const starts = sessions.filter((s) => s.event === 'start');
const [s1, s2, s3] = starts.map((s) => s.session_id);
check('three_sessions_with_new_ids', starts.length === 3 && new Set([s1, s2, s3]).size === 3
  && starts[1].detail === 'resume' && starts[2].detail === 'resume', starts.map((s) => `${s.session_id} ${s.detail} ${s.utc}`));
const L = (k, r, a) => st.ledger.find((l) => l.kind === k && Number(l.round) === r && Number(l.round_attempt) === a);
const p0 = L('primary', 0, 1);
check('round_completed_in_session1', p0 && p0.status === 'complete' && p0.accepted === '1' && p0.session_id === s1, p0);
const endS1 = sessions.find((s) => s.session_id === s1 && s.event === 'end');
check('session1_clean_planned_stop', endS1 && /^STOPPED/.test(endS1.detail), endS1 && endS1.detail);
const rowsP0 = [...st.runs, ...st.rounds].filter((r) => r.kind === 'primary' && r.round === '0');
check('completed_round_not_rerun', rowsP0.every((r) => r.session_id === s1 && r.round_attempt === '1') && !L('primary', 0, 2),
  { rows: rowsP0.length, sessions: [...new Set(rowsP0.map((r) => r.session_id))] });
const p1a1 = L('primary', 1, 1);
const p1a1rounds = st.rounds.filter((r) => r.kind === 'primary' && r.round === '1' && r.round_attempt === '1');
check('interrupted_round_preserved_as_incomplete', p1a1 && p1a1.status === 'incomplete' && p1a1.accepted === '0'
  && p1a1.session_id === s2 && p1a1.recorded_by_session === s3 && p1a1rounds.length === 1 && Number(p1a1.rows_runs) > 0, p1a1);
const p1a2 = L('primary', 1, 2);
const p1a2rounds = st.rounds.filter((r) => r.kind === 'primary' && r.round === '1' && r.round_attempt === '2');
const unitP1 = st.units.find((u) => u.kind === 'primary' && u.round === 1);
check('interrupted_round_rerun_whole', p1a2 && p1a2.status === 'complete' && p1a2.accepted === '1' && p1a2.session_id === s3
  && p1a2rounds.map((r) => r.profile_id).sort().join(',') === unitP1.profiles.slice().sort().join(','), { attempt2_profiles: p1a2rounds.map((r) => r.profile_id) });
const rest = st.units.filter((u) => !(u.kind === 'primary' && u.round <= 1));
check('remaining_rounds_accepted_in_session3', rest.every((u) => { const l = L(u.kind, u.round, 1); return l && l.accepted === '1' && l.session_id === s3; }), rest.map((u) => u.key));
const val = readJson(path.join(RESULTS, 'derived', 'validation.json'));
check('final_validation_pass', val.passed === true && val.complete === true, { passed: val.passed, complete: val.complete, accepted: val.accepted_rounds });
const sum = parseCsv(path.join(RESULTS, 'derived', 'prover_summary.csv')).rows;
const used = new Set(sum.flatMap((r) => r.round_attempts_used.split(' ')));
check('summary_uses_accepted_attempt_only', used.has('1a2') && !used.has('1a1'), [...used]);
const refusal = fs.readFileSync(path.join(RESULTS, 'environment', 'resume-test', 'refusal.txt'), 'utf8').trim().split('\n');
const R = Object.fromEntries(refusal.map((l) => l.split('=')));
check('accepted_round_rerun_refused', R.harness_exit === '7' && R.rows_before === R.rows_after, R);
check('altered_schedule_resume_refused', R.tamper_exit !== '0' && R.tamper_refused === 'yes' && /schedule\.csv differs/.test(R.tamper_reason || ''),
  { exit: R.tamper_exit, reason: R.tamper_reason });
check('other_commit_resume_refused', R.commit_tamper_exit !== undefined && R.commit_tamper_exit !== '0' && /identity differs.*git commit/.test(R.commit_tamper_reason || ''),
  { exit: R.commit_tamper_exit, reason: R.commit_tamper_reason });
const passed = checks.every((c) => c.passed);
writeJson(path.join(RESULTS, 'environment', 'resume-test', 'resume-test.json'), { passed, sessions: [s1, s2, s3], ledger: st.ledger, checks });
for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'}  ${c.name}`);
console.log(`resume test: ${passed ? 'PASS' : 'FAIL'} (${checks.filter((c) => c.passed).length}/${checks.length})`);
process.exit(passed ? 0 : 9);
