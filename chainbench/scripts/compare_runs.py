#!/usr/bin/env python3
"""CHAIN-PROTOCOL-v1 §10 items 5-6: compare two runs.
  determinism : two EDR runs from scratch; identical on every field except run_id (and timestamps in run.json).
  crossclient : EDR run vs geth replay; identical on every field except run_id, env, client_version, chain_id,
                tx_hash, block_number, gas_price_wei (legitimate client differences, §8.4).
Build manifests must be byte-identical in both modes. Differences are reported, never normalised.
Usage: compare_runs.py --mode determinism|crossclient --a <run dir> --b <run dir> [--out report.json]"""
import argparse, csv, json, os, sys, hashlib
EXCL = {'determinism': {'run_id'},
        'crossclient': {'run_id', 'env', 'client_version', 'chain_id', 'tx_hash', 'block_number', 'gas_price_wei'}}
ap = argparse.ArgumentParser(); ap.add_argument('--mode', required=True, choices=EXCL); ap.add_argument('--a', required=True); ap.add_argument('--b', required=True); ap.add_argument('--out')
a = ap.parse_args()
def load(d):
    rows = list(csv.DictReader(open(os.path.join(d, 'local_l1_ops.csv'), newline='')))
    return {(r['cell_id'], int(r['op_seq'])): r for r in rows}, rows, json.load(open(os.path.join(d, 'run.json')))
A, Arows, runA = load(a.a); B, Brows, runB = load(a.b)
rep = {'mode': a.mode, 'a': os.path.relpath(a.a), 'b': os.path.relpath(a.b), 'excluded_fields': sorted(EXCL[a.mode])}
# run-level identity
rep['run_level'] = {k: runA.get(k) == runB.get(k) for k in ('plan', 'protocol_sha256', 'plonk_verifier_provenance_sha256', 'proofset_manifest', 'cells', 'proofs', 'expected_rows')}
rep['run_level']['commit_a'] = runA.get('commit'); rep['run_level']['commit_b'] = runB.get('commit')
rep['run_level']['env_a'] = runA.get('env'); rep['run_level']['env_b'] = runB.get('env')
# build manifests
bm = {}
for p in ('primary', 'bridge'):
    fa = open(os.path.join(a.a, f'build_manifest.{p}.json'), 'rb').read(); fb = open(os.path.join(a.b, f'build_manifest.{p}.json'), 'rb').read()
    bm[p] = {'identical': fa == fb, 'sha256_a': hashlib.sha256(fa).hexdigest(), 'sha256_b': hashlib.sha256(fb).hexdigest()}
rep['build_manifests'] = bm
# rows
keysA, keysB = set(A), set(B)
rep['rows_a'], rep['rows_b'] = len(Arows), len(Brows)
rep['keys_only_in_a'] = sorted(map(list, keysA - keysB))[:20]; rep['keys_only_in_b'] = sorted(map(list, keysB - keysA))[:20]
cols = [c for c in Arows[0].keys() if c not in EXCL[a.mode]]
diffs, per_field = [], {}
for k in sorted(keysA & keysB):
    for c in cols:
        if A[k].get(c) != B[k].get(c):
            per_field[c] = per_field.get(c, 0) + 1
            if len(diffs) < 50: diffs.append({'cell_id': k[0], 'op_seq': k[1], 'op': A[k]['op'], 'field': c, 'a': A[k].get(c), 'b': B[k].get(c)})
rep['fields_compared'] = cols; rep['rows_compared'] = len(keysA & keysB)
rep['tx_rows_compared'] = sum(1 for k in keysA & keysB if A[k]['kind'] == 'tx'); rep['call_rows_compared'] = sum(1 for k in keysA & keysB if A[k]['kind'] == 'call')
rep['field_value_comparisons'] = rep['rows_compared'] * len(cols)
rep['differences_per_field'] = per_field; rep['first_differences'] = diffs
rep['check_pass_all_a'] = all(r['check_pass'] == '1' for r in Arows); rep['check_pass_all_b'] = all(r['check_pass'] == '1' for r in Brows)
rep['identical'] = (not per_field and keysA == keysB and all(v['identical'] for v in bm.values())
                    and all(rep['run_level'][k] for k in ('plan', 'protocol_sha256', 'plonk_verifier_provenance_sha256', 'proofset_manifest', 'cells', 'proofs', 'expected_rows')))
s = json.dumps(rep, indent=2)
if a.out: open(a.out, 'w').write(s + '\n')
print(json.dumps({k: rep[k] for k in ('mode', 'identical', 'rows_a', 'rows_b', 'rows_compared', 'tx_rows_compared', 'call_rows_compared', 'field_value_comparisons', 'differences_per_field', 'build_manifests', 'check_pass_all_a', 'check_pass_all_b')}, indent=1))
sys.exit(0 if rep['identical'] else 1)
