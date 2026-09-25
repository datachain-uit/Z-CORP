#!/usr/bin/env python3
"""Local-EraVM smoke check (not scientific data).
  check_smoke_l2.py <smoke run dir> <reference csv> [--out result.json]
      the run was accepted and validates; Groth16 and PLONK verify on EraVM and the negative controls are rejected; if the
      reference exists: every row equals it on the scientific fields (this environment reproduces the accepted values).
  check_smoke_l2.py --make-reference <smoke run dir> --out <reference csv>
      write a reference from an accepted smoke run (author only)."""
import csv, json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from l2common import load_run
FIELDS = ['kind', 'expected_status', 'status', 'revert_reason', 'return_value', 'computational_gas', 'pubdata_bytes', 'pubdata_gas',
          'gas_per_pubdata', 'gas_used', 'calldata_bytes', 'calldata_sha256', 'bytecode_bytes', 'bytecode_hash', 'contract_address', 'tx_hash', 'block_number']
KEY = ['cell_id', 'op', 'proof_id', 'op_seq']
args = [a for a in sys.argv[1:]]
out = args[args.index('--out') + 1] if '--out' in args else None
if '--make-reference' in args:
    run_dir = args[args.index('--make-reference') + 1]
    rows, _, run = load_run(run_dir)
    if not run.get('accepted_checks') or run.get('plan') != 'smoke':
        sys.exit(f'{run_dir}: not an accepted smoke run')
    with open(out, 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n'); w.writerow(KEY + FIELDS)
        for r in rows: w.writerow([r[c] for c in KEY + FIELDS])
    print(f'reference written: {out} ({len(rows)} rows from {run["run_id"]})')
    sys.exit(0)
run_dir, ref_path = args[0], args[1]
results = []
def check(ok, what, fix='', level='FAIL'):
    results.append({'ok': bool(ok), 'check': what, 'level': 'PASS' if ok else level, 'fix': '' if ok else fix})
    print(('[PASS] ' if ok else f'[{level}] ') + what + ('' if ok or not fix else f'\n       Fix: {fix}'))
rows, _, run = load_run(run_dir)
check(run.get('steps', {}).get('finish') and run.get('accepted_checks') is True,
      f"run {run.get('run_id')} finished with accepted checks ({run.get('rows')} rows, {run.get('rows_failing_check')} failing, {run.get('tx_failing_accounting')} accounting failures)",
      'inspect run.json and local_l2_ops.csv; re-run ./chainbench/run.sh doctor-l2')
v = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'validate_l2.py'), run_dir, '--out', os.path.join(run_dir, 'validation.json')], capture_output=True, text=True)
check(v.returncode == 0, 'raw data validates (validate_l2.py: schema, sequence, outcomes, fee accounting, bytecode identity)', v.stdout.strip().split('\n')[-1])
ok_g = any(r['backend'] == 'groth16' and r['op'] == 'verify_credential' and r['status'] == '1' and r['return_value'] == 'true' for r in rows)
ok_p = any(r['backend'] == 'plonk' and r['op'] == 'verify_credential' and r['status'] == '1' and r['return_value'] == 'true' for r in rows)
check(ok_g, 'a Groth16 proof verifies on EraVM through its manager')
check(ok_p, 'a PLONK proof verifies on EraVM through its manager')
check(all(r['return_value'] == 'true' for r in rows if r['op'] == 'verify_proof_direct'), 'direct verifier transactions return true')
neg = {(r['backend'], r['op']): r['revert_reason'] for r in rows if r['op'] in ('neg_unknown_root', 'neg_tampered', 'neg_cross_depth', 'neg_non_issuer')}
check(all(neg.get((b, 'neg_unknown_root')) == 'Invalid root' and neg.get((b, 'neg_tampered')) == 'Invalid proof' and neg.get((b, 'neg_cross_depth')) == 'Invalid proof'
          and neg.get((b, 'neg_non_issuer')) == 'CredentialManager: not issuer' for b in ('groth16', 'plonk')),
      'negative controls rejected on both backends (unknown root, tampered proof, cross-depth proof, non-issuer)')
if os.path.exists(ref_path):
    ref = {tuple(r[c] for c in KEY): r for r in csv.DictReader(open(ref_path, newline=''))}
    got = {tuple(r[c] for c in KEY): r for r in rows}
    diffs = [(k, f, ref[k][f], got[k][f]) for k in ref if k in got for f in FIELDS if ref[k][f] != got[k][f]]
    check(set(ref) == set(got) and not diffs, f'all {len(ref)} rows equal the accepted L2 smoke reference on {len(FIELDS)} fields (computational gas, pubdata, gasUsed, outcome, bytecode, hashes)',
          f'this environment does not reproduce the accepted values: {diffs[:4]} keys-missing={sorted(set(ref) ^ set(got))[:4]}; report it, do not run the full L2 experiment')
else:
    check(False, f'L2 smoke reference {os.path.basename(ref_path)} not present (the author creates it); values not compared', level='WARN')
res = {'smoke_run': run.get('run_id'), 'reference': os.path.relpath(ref_path), 'reference_present': os.path.exists(ref_path),
       'pass': all(r['ok'] or r['level'] == 'WARN' for r in results), 'checks': results, 'note': 'smoke test only; not scientific data'}
if out:
    json.dump(res, open(out, 'w'), indent=2); open(out, 'a').write('\n')
print('SMOKE-L2 ' + ('PASS' if res['pass'] else 'FAIL'))
sys.exit(0 if res['pass'] else 1)
