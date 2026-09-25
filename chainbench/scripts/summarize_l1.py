#!/usr/bin/env python3
"""Per-cell summary of a run's local_l1_ops.csv (CHAIN-PROTOCOL-v1 §9): deployment and setup gas, manager-level and
direct verification gas (min/max over the proofs of the plan), derived components and sizes. Negative controls: status only.
Usage: summarize_l1.py <run dir> [--out summary.csv]"""
import csv, sys, os
d = sys.argv[1]; out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
R = list(csv.DictReader(open(os.path.join(d, 'local_l1_ops.csv'), newline='')))
cells = []
for r in R:
    if r['cell_id'] not in cells: cells.append(r['cell_id'])
def g(rows, op, f='gas_used'): return [int(x[f]) for x in rows if x['op'] == op and x[f] != '']
out_rows = []
for c in cells:
    rows = [r for r in R if r['cell_id'] == c]
    r0 = rows[0]
    dv = [x for x in rows if x['op'] == 'deploy_verifier'][0]; dm = [x for x in rows if x['op'] == 'deploy_manager'][0]
    vc, vd = g(rows, 'verify_credential'), g(rows, 'verify_proof_direct')
    vce, vde = g(rows, 'verify_credential', 'exec_gas_derived'), g(rows, 'verify_proof_direct', 'exec_gas_derived')
    neg = {x['op']: f"{x['status']}:{x['revert_reason'] or x['return_value']}" for x in rows if x['op'].startswith('neg_')}
    out_rows.append({
        'cell_id': c, 'profile': r0['profile'], 'backend': r0['backend'], 'depth': r0['depth'], 'n_proofs': len(vc),
        'deploy_verifier_gas': dv['gas_used'], 'verifier_initcode_bytes': dv['initcode_bytes'], 'verifier_runtime_bytes': dv['runtime_bytes'],
        'deploy_manager_gas': dm['gas_used'], 'manager_initcode_bytes': dm['initcode_bytes'], 'manager_runtime_bytes': dm['runtime_bytes'],
        'set_issuer_gas': g(rows, 'set_issuer')[0], 'add_root_gas': g(rows, 'add_root')[0],
        'verify_credential_gas_min': min(vc), 'verify_credential_gas_max': max(vc),
        'verify_proof_direct_gas_min': min(vd), 'verify_proof_direct_gas_max': max(vd),
        'verify_credential_exec_min': min(vce), 'verify_credential_exec_max': max(vce),
        'verify_proof_direct_exec_min': min(vde), 'verify_proof_direct_exec_max': max(vde),
        'calldata_bytes_verify': '|'.join(sorted({x['calldata_bytes'] for x in rows if x['op'] == 'verify_credential'})),
        'all_checks_pass': all(x['check_pass'] == '1' for x in rows), 'negatives': ';'.join(f'{k}={v}' for k, v in neg.items()),
    })
cols = list(out_rows[0].keys())
text = '\n'.join([','.join(cols)] + [','.join('"%s"' % str(r[k]) if (',' in str(r[k]) or ';' in str(r[k])) else str(r[k]) for k in cols) for r in out_rows]) + '\n'
if out: open(out, 'w').write(text)
print(text)
