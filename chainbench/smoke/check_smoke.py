#!/usr/bin/env python3
"""Validate a smoke run (not scientific data). Checks, with explicit messages:
  1. the run finished and its own checks were accepted (run.json);
  2. the CSV header equals the raw schema (lib/schema.js COLUMNS) and the row count equals the plan;
  3. every row passes its expected status / revert reason / return value (check_pass = 1);
  4. at least one Groth16 and one PLONK verifyCredential succeeded, and the negative controls were rejected;
  5. the rows equal the workload's smoke reference (accepted readiness values) on status, revert reason, return value,
     gas, calldata and deployed-code fields -- i.e. this environment reproduces the accepted measurements exactly.
Usage: check_smoke.py <smoke run dir> <reference csv> [--out result.json]"""
import csv, json, os, re, sys
run_dir, ref_path = sys.argv[1], sys.argv[2]
out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
here = os.path.dirname(os.path.abspath(__file__))
results = []
def check(ok, what, fix=''):
    results.append({'ok': bool(ok), 'check': what, 'fix': '' if ok else fix})
    print(('[PASS] ' if ok else '[FAIL] ') + what + ('' if ok or not fix else f'\n       Fix: {fix}'))
run = json.load(open(os.path.join(run_dir, 'run.json')))
check(run.get('steps', {}).get('finish') and run.get('accepted_checks') is True,
      f"run {run.get('run_id')} finished with accepted checks ({run.get('rows')} rows, {run.get('rows_failing_check')} failing)",
      'inspect run.json and local_l1_ops.csv in the smoke directory; re-run ./chainbench/run.sh doctor')
schema_src = open(os.path.join(here, '..', 'lib', 'schema.js')).read()
columns = re.findall(r"'([a-z0-9_]+)'", schema_src.split('const COLUMNS = [')[1].split('];')[0])
with open(os.path.join(run_dir, 'local_l1_ops.csv'), newline='') as f:
    rd = csv.DictReader(f); rows = list(rd); header = rd.fieldnames
check(header == columns, f'CSV header matches the raw schema ({len(columns)} columns)', 'the harness and lib/schema.js disagree; do not use this environment')
check(len(rows) == run.get('rows_expected'), f"row count {len(rows)} equals the plan ({run.get('rows_expected')})")
check(all(r['check_pass'] == '1' for r in rows), 'every row matches its expected status / revert reason / return value')
ok_g = any(r['backend'] == 'groth16' and r['op'] == 'verify_credential' and r['status'] == '1' for r in rows)
ok_p = any(r['backend'] == 'plonk' and r['op'] == 'verify_credential' and r['status'] == '1' for r in rows)
check(ok_g, 'a Groth16 proof verifies through its manager (verifyCredential succeeded)')
check(ok_p, 'a PLONK proof verifies through its manager (verifyCredential succeeded)')
check(all(r['status'] == '1' for r in rows if r['op'] in ('deploy_verifier', 'deploy_manager', 'set_issuer', 'add_root')),
      'contracts deploy and manager setup (setIssuer, addRoot) succeed')
neg = {r['op']: r['revert_reason'] for r in rows if r['op'] in ('neg_unknown_root', 'neg_tampered', 'neg_non_issuer')}
check(neg.get('neg_unknown_root') == 'Invalid root' and neg.get('neg_tampered') == 'Invalid proof' and neg.get('neg_non_issuer') == 'CredentialManager: not issuer',
      'negative cases are rejected (unknown root, tampered proof, non-issuer root publication)')
ref = {(r['cell_id'], r['op'], r['proof_id']): r for r in csv.DictReader(open(ref_path, newline=''))}
got = {(r['cell_id'], r['op'], r['proof_id']): r for r in rows}
fields = ['kind', 'expected_status', 'status', 'revert_reason', 'return_value', 'gas_used', 'exec_gas_derived', 'calldata_bytes',
          'calldata_zero_bytes', 'runtime_bytes', 'runtime_keccak', 'contract_address']
diffs = [(k, f, ref[k][f], got[k][f]) for k in ref if k in got for f in fields if ref[k][f] != got[k][f]]
check(set(ref) == set(got) and not diffs,
      f'all {len(ref)} rows equal the accepted reference on {len(fields)} fields (gas, status, calldata, deployed code)',
      f'environment does not reproduce the accepted measurements: {diffs[:5]} keys-missing={sorted(set(ref) ^ set(got))[:5]}; report this, do not run the full experiment')
res = {'smoke_run': run.get('run_id'), 'reference': os.path.relpath(ref_path), 'pass': all(r['ok'] for r in results), 'checks': results,
       'note': 'smoke test only; not scientific data'}
if out:
    json.dump(res, open(out, 'w'), indent=2); open(out, 'a').write('\n')
print('SMOKE ' + ('PASS' if res['pass'] else 'FAIL'))
sys.exit(0 if res['pass'] else 1)
