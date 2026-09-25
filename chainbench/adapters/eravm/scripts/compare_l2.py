#!/usr/bin/env python3
"""CHAIN-PROTOCOL-v1 §16.6: determinism of the local-EraVM arm. Two runs from scratch must be identical on every raw
field except run_id; build manifests and the environment-check probe must be identical. Differences are reported,
never normalised.  Usage: compare_l2.py --a <run dir> --b <run dir> [--out report.json]"""
import argparse, hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from l2common import load_run
EXCL = {'run_id'}
ap = argparse.ArgumentParser(); ap.add_argument('--a', required=True); ap.add_argument('--b', required=True); ap.add_argument('--out')
a = ap.parse_args()
Arows, _, runA = load_run(a.a); Brows, _, runB = load_run(a.b)
A = {(r['cell_id'], int(r['op_seq'])): r for r in Arows}; B = {(r['cell_id'], int(r['op_seq'])): r for r in Brows}
RUNK = ('arm', 'plan', 'protocol_sha256', 'proofset_manifest', 'cells', 'proofs', 'expected_rows', 'expected_tx', 'build_output_sha256')
rep = {'mode': 'determinism', 'a': os.path.relpath(a.a), 'b': os.path.relpath(a.b), 'excluded_fields': sorted(EXCL),
       'run_level': {k: runA.get(k) == runB.get(k) for k in RUNK}, 'commit_a': runA.get('commit'), 'commit_b': runB.get('commit')}
fa = open(os.path.join(a.a, 'build_manifest.eravm.json'), 'rb').read(); fb = open(os.path.join(a.b, 'build_manifest.eravm.json'), 'rb').read()
rep['build_manifest'] = {'identical': fa == fb, 'sha256_a': hashlib.sha256(fa).hexdigest(), 'sha256_b': hashlib.sha256(fb).hexdigest()}
pa = json.load(open(os.path.join(a.a, 'env_check.json'))); pb = json.load(open(os.path.join(a.b, 'env_check.json')))
rep['env_check'] = {'probe_identical': pa.get('probe') == pb.get('probe'), 'checks_identical': pa.get('checks') == pb.get('checks')}
ea = json.load(open(os.path.join(a.a, 'environment.json'))); eb = json.load(open(os.path.join(a.b, 'environment.json')))
rep['environment'] = {k: ea.get(k) == eb.get(k) for k in ('toolchain', 'packages', 'lockfile_sha256', 'pins_sha256', 'node_options', 'tx_fields', 'fee_input', 'compiler_settings', 'node')}
cols = [c for c in Arows[0].keys() if c not in EXCL]
diffs, per_field = [], {}
for key in sorted(set(A) & set(B)):
    for c in cols:
        if A[key].get(c) != B[key].get(c):
            per_field[c] = per_field.get(c, 0) + 1
            if len(diffs) < 50: diffs.append({'cell_id': key[0], 'op_seq': key[1], 'op': A[key]['op'], 'field': c, 'a': A[key].get(c), 'b': B[key].get(c)})
common = set(A) & set(B)
rep.update({'rows_a': len(Arows), 'rows_b': len(Brows), 'keys_only_in_a': sorted(map(list, set(A) - set(B)))[:20], 'keys_only_in_b': sorted(map(list, set(B) - set(A)))[:20],
            'fields_compared': cols, 'rows_compared': len(common),
            'tx_rows_compared': sum(1 for x in common if A[x]['kind'] == 'tx'), 'call_rows_compared': sum(1 for x in common if A[x]['kind'] == 'call'),
            'differences_per_field': per_field, 'first_differences': diffs})
rep['field_value_comparisons'] = rep['rows_compared'] * len(cols)
rep['identical'] = (not per_field and set(A) == set(B) and rep['build_manifest']['identical'] and all(rep['run_level'].values())
                    and all(rep['env_check'].values()) and all(rep['environment'].values()))
s = json.dumps(rep, indent=2)
if a.out: open(a.out, 'w').write(s + '\n')
print(json.dumps({k: rep[k] for k in ('identical', 'rows_a', 'rows_b', 'rows_compared', 'tx_rows_compared', 'call_rows_compared', 'field_value_comparisons', 'differences_per_field', 'build_manifest', 'env_check', 'environment', 'run_level')}, indent=1))
sys.exit(0 if rep['identical'] else 1)
