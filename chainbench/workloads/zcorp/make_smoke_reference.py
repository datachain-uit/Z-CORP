#!/usr/bin/env python3
"""Extract the smoke-test reference (workloads/zcorp/smoke-reference.csv) from the accepted readiness dry run.
The smoke plan (lib/plan.js: primary Groth16 d5 and primary PLONK d10, proof p0, all negative controls) is a subset of
the dry plan, so every smoke row has an accepted counterpart keyed by (cell_id, op, proof_id). Regression fixture only.
Usage: make_smoke_reference.py <accepted dry-run EDR dir>/local_l1_ops.csv > smoke-reference.csv"""
import csv, sys
CELLS = {'primary-groth16-d5', 'primary-plonk-d10'}
FIELDS = ['cell_id', 'op', 'proof_id', 'kind', 'expected_status', 'status', 'revert_reason', 'return_value', 'gas_used',
          'exec_gas_derived', 'calldata_bytes', 'calldata_zero_bytes', 'runtime_bytes', 'runtime_keccak', 'contract_address']
rows = [r for r in csv.DictReader(open(sys.argv[1], newline='')) if r['cell_id'] in CELLS and not r['proof_id'].endswith('-p1')]
keys = [(r['cell_id'], r['op'], r['proof_id']) for r in rows]
assert len(keys) == len(set(keys)), 'smoke reference keys are not unique'
w = csv.DictWriter(sys.stdout, fieldnames=FIELDS, lineterminator='\n', extrasaction='ignore')
w.writeheader()
for r in rows:
    w.writerow(r)
