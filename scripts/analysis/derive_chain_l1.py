#!/usr/bin/env python3
"""Manuscript-facing derivations of the CSI-CHAIN-LOCAL-01 L1 campaign (CHAIN-PROTOCOL-v1 sections 9, 10, 13).

Reads one accepted L1 campaign directory -- the three runs <id>-edr-a, <id>-edr-b, <id>-geth and the campaign files
<id>.preflight.json, <id>.postflight.json, <id>.unit_tests.log -- re-checks the validation criteria of section 10
independently of the runner, and derives descriptive quantities from the accepted raw rows of EDR run a (the reference
run; run b and the geth replay are checked equal to it). No thresholds, no exclusions, no rounding of gas values.
Standard library only; deterministic output. Exit 2 if any check fails (nothing is written then).

    python3 scripts/analysis/derive_chain_l1.py --campaign results/chain-local-l1-20260925 --out <dir> [--repo .]
        [--expect-campaign-id ID] [--expect-commit SHA] [--expect-tag TAG] [--expect-image-id ID]
        [--expect-protocol-sha256 SHA] [--plan full]

Outputs (in --out):
  l1_ops.csv                  every row of run a (transactions and calls), measurement columns only
  l1_cells.csv                per cell: section 9 metrics (deployment, setup, verification min/max over K, sizes, derived components)
  l1_proofs.csv               per cell and proof: manager-level and direct verification gas, execution gas, calldata
  l1_negatives.csv            negative controls: expected and observed status / revert reason / return (gas not interpreted, 7.2)
  l1_compile_sizes.csv        compile-only init/runtime sizes of every contract in both build manifests (all 11 depths)
  l1_backend_comparison.csv   descriptive PLONK vs Groth16 differences and ratios per depth (not a section 9 metric)
  l1_bridge_vs_july.csv       bridge cell vs the July 2026 Sepolia records (provenance only) and vs the primary Groth16 d11 cell
  validation.json             every section 10 check re-evaluated from the raw data
  values.tex                  manuscript-facing macros (\\zc...)
  derivation.json             tool, inputs and outputs sha256, identities, rules
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import subprocess
import sys

OPS = ['deploy_verifier', 'deploy_manager', 'set_issuer', 'add_root', 'precheck_call', 'verify_credential', 'verify_proof_call',
       'verify_proof_direct', 'neg_unknown_root', 'neg_tampered_call', 'neg_tampered', 'neg_cross_depth_setup', 'neg_cross_depth_call',
       'neg_cross_depth', 'neg_non_issuer']
REPEATED = {'verify_credential', 'verify_proof_call', 'verify_proof_direct'}
NEG = ['neg_unknown_root', 'neg_tampered_call', 'neg_tampered', 'neg_cross_depth_setup', 'neg_cross_depth_call', 'neg_cross_depth', 'neg_non_issuer']
# Frozen comparison exclusions (CHAIN-PROTOCOL-v1 section 8.4; chainbench/scripts/compare_runs.py)
EXCL_DET = {'run_id'}
EXCL_XC = {'run_id', 'env', 'client_version', 'chain_id', 'tx_hash', 'block_number', 'gas_price_wei'}
OPS_COLS = ['cell_id', 'profile', 'backend', 'depth', 'op_seq', 'op', 'kind', 'proof_id', 'proof_j', 'leaf_index', 'from_account',
            'contract_name', 'gas_limit', 'expected_status', 'status', 'expected_revert', 'revert_reason', 'expected_return', 'return_value',
            'check_pass', 'gas_used', 'calldata_bytes', 'calldata_zero_bytes', 'calldata_tokens', 'calldata_gas_standard', 'floor_gas_7623',
            'create_gas', 'intrinsic_gas', 'exec_gas_derived', 'floor_binding', 'code_deposit_gas', 'initcode_bytes', 'runtime_bytes',
            'runtime_keccak', 'runtime_matches_artifact', 'calldata_sha256']
JULY_DEPLOY = 'results/blockchain/4.1.1-Deployment-and-root-publication-cost/20260712T134135-deploy-sepolia.csv'
JULY_VERIFY = ['results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/20260711T091246-11-50-sepolia.csv',
               'results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/20260711T131457-11-50-sepolia.csv',
               'results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows/20260712T030525-11-50-sepolia.csv']
WORD = {5: 'Five', 10: 'Ten', 11: 'Eleven', 15: 'Fifteen'}


class CheckError(Exception):
    pass


def sha256_bytes(b): return hashlib.sha256(b).hexdigest()
def sha256_file(p): return sha256_bytes(open(p, 'rb').read())
def read_csv(p): return list(csv.DictReader(open(p, newline='')))
def jload(p): return json.load(open(p))


def csv_bytes(cols, rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, lineterminator='\n', extrasaction='raise')
    w.writeheader()
    for r in rows:
        w.writerow({c: ('' if r.get(c) is None else r[c]) for c in cols})
    return buf.getvalue().encode()


def ratio(a, b): return f'{a / b:.4f}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--campaign', required=True); ap.add_argument('--out', required=True); ap.add_argument('--repo', default='.')
    ap.add_argument('--expect-campaign-id'); ap.add_argument('--expect-commit'); ap.add_argument('--expect-tag')
    ap.add_argument('--expect-image-id'); ap.add_argument('--expect-protocol-sha256'); ap.add_argument('--plan', default='full')
    a = ap.parse_args()
    repo = os.path.abspath(a.repo); camp = os.path.abspath(a.campaign)
    rel = lambda p: os.path.relpath(p, repo)
    checks, inputs = {}, {}

    def check(name, cond, detail=''):
        checks[name] = {'pass': bool(cond), 'detail': detail}
        if not cond:
            raise CheckError(f'{name}: {detail}')

    # ---------------------------------------------------------------- locate the campaign files
    runs = sorted(d for d in os.listdir(camp) if os.path.isdir(os.path.join(camp, d)))
    ids = sorted({re.sub(r'-(edr-a|edr-b|geth)$', '', d) for d in runs})
    check('one_campaign_id', len(ids) == 1 and set(runs) == {f'{ids[0]}-edr-a', f'{ids[0]}-edr-b', f'{ids[0]}-geth'}, f'dirs {runs}')
    cid = ids[0]
    if a.expect_campaign_id:
        check('campaign_id_expected', cid == a.expect_campaign_id, f'{cid} vs {a.expect_campaign_id}')
    D = {k: os.path.join(camp, f'{cid}-{k}') for k in ('edr-a', 'edr-b', 'geth')}
    for k, d in D.items():
        for fn in sorted(os.listdir(d)):
            if os.path.isfile(os.path.join(d, fn)):
                inputs[rel(os.path.join(d, fn))] = sha256_file(os.path.join(d, fn))
    for fn in (f'{cid}.preflight.json', f'{cid}.postflight.json', f'{cid}.unit_tests.log'):
        p = os.path.join(camp, fn)
        check(f'file_{fn.split(".", 1)[1].replace(".", "_")}', os.path.exists(p), rel(p))
        inputs[rel(p)] = sha256_file(p)

    run = {k: jload(os.path.join(d, 'run.json')) for k, d in D.items()}
    env = {k: jload(os.path.join(d, 'environment.json')) for k, d in D.items()}
    rows = {k: read_csv(os.path.join(d, 'local_l1_ops.csv')) for k, d in D.items()}
    commit = run['edr-a']['commit']

    # ---------------------------------------------------------------- section 10 re-checks
    exp_rows = run['edr-a']['expected_rows']
    for k in D:
        r = run[k]
        check(f'{k}_plan', r['plan'] == a.plan, r['plan'])
        check(f'{k}_env', r['env'] == ('geth' if k == 'geth' else 'edr'), r['env'])
        check(f'{k}_commit_clean', r['commit'] == commit and r['dirty_tracked_paths'] == [], f"{r['commit']} {r['dirty_tracked_paths']}")
        check(f'{k}_steps', all(s in r.get('steps', {}) for s in ('build', 'envcheck', 'exec', 'finish')), str(r.get('steps')))
        check(f'{k}_accepted_by_runner', r.get('accepted_checks') is True and r.get('env_check_pass') is True, '')
        check(f'{k}_rows', len(rows[k]) == exp_rows == r['rows'], f'{len(rows[k])} of {exp_rows}')
        check(f'{k}_check_pass_all', all(x['check_pass'] == '1' for x in rows[k]), '')
        dep = [x for x in rows[k] if x['op'].startswith('deploy_')]
        check(f'{k}_runtime_matches_artifact', dep and all(x['runtime_matches_artifact'] == '1' for x in dep), f'{len(dep)} deployments')
        ec = jload(os.path.join(D[k], 'env_check.json'))
        check(f'{k}_hardfork', ec.get('pass') is True and ec['edr']['osaka']['osaka_markers_all'] is True and ec['edr']['prague']['osaka_markers_none'] is True
              and (k != 'geth' or ec['geth']['osaka_markers_all'] is True), '')
        for p in ('primary', 'bridge'):
            m = jload(os.path.join(D[k], f'build_manifest.{p}.json'))
            check(f'{k}_build_{p}_limits', all(c['eip170_runtime_ok'] and c['eip3860_initcode_ok'] for c in m['contracts'].values()), '')
            check(f'{k}_build_{p}_staged_equal_head', all(f['equals_head'] for f in m['staged_files']), '')
        c = env[k].get('container') or {}
        check(f'{k}_no_network', c.get('network') == 'none' and (c.get('network_isolation') or {}).get('isolated') is True, str(c.get('network_isolation')))
        if a.expect_image_id:
            check(f'{k}_image', c.get('image_id') == a.expect_image_id, str(c.get('image_id')))
        if a.expect_protocol_sha256:
            check(f'{k}_protocol_sha256', r['protocol_sha256'] == a.expect_protocol_sha256, r['protocol_sha256'])
    if a.expect_commit:
        check('commit_expected', commit == a.expect_commit, f'{commit} vs {a.expect_commit}')
    if a.expect_tag:
        tc = subprocess.run(['git', '-C', repo, 'rev-parse', a.expect_tag + '^{commit}'], capture_output=True, text=True).stdout.strip()
        check('tag_resolves_to_run_commit', tc == commit, f'{a.expect_tag} -> {tc}')
    check('same_proofset_manifest', run['edr-a']['proofset_manifest'] == run['edr-b']['proofset_manifest'] == run['geth']['proofset_manifest'], '')
    check('same_protocol', run['edr-a']['protocol_sha256'] == run['edr-b']['protocol_sha256'] == run['geth']['protocol_sha256'], '')
    check('geth_reference_is_run_a', os.path.basename(run['geth'].get('reference_run') or '') == f'{cid}-edr-a', str(run['geth'].get('reference_run')))
    check('same_image', len({(env[k].get('container') or {}).get('image_id') for k in D}) == 1, '')

    # structure: every cell has every operation, K proofs for the repeated ones
    cells = run['edr-a']['cells']; K = len(run['edr-a']['proofs'])
    for cell in cells:
        ops = [x['op'] for x in rows['edr-a'] if x['cell_id'] == cell]
        want = sorted(o for o in OPS for _ in range(K if o in REPEATED else 1))
        check(f'structure_{cell}', sorted(ops) == want, f'{len(ops)} rows')

    # determinism and cross-client, recomputed from the raw rows and build manifests
    key = lambda x: (x['cell_id'], int(x['op_seq']))
    A = {key(x): x for x in rows['edr-a']}; B = {key(x): x for x in rows['edr-b']}; G = {key(x): x for x in rows['geth']}
    cols = list(rows['edr-a'][0].keys())
    det = sum(1 for kk in A for c in cols if c not in EXCL_DET and A[kk][c] != B.get(kk, {}).get(c))
    xc = sum(1 for kk in A for c in cols if c not in EXCL_XC and A[kk][c] != G.get(kk, {}).get(c))
    check('determinism_rows_identical', set(A) == set(B) and det == 0, f'{det} differing field values')
    check('crossclient_rows_identical', set(A) == set(G) and xc == 0, f'{xc} differing field values')
    for p in ('primary', 'bridge'):
        fa = open(os.path.join(D['edr-a'], f'build_manifest.{p}.json'), 'rb').read()
        check(f'build_manifest_{p}_identical', fa == open(os.path.join(D['edr-b'], f'build_manifest.{p}.json'), 'rb').read()
              == open(os.path.join(D['geth'], f'build_manifest.{p}.json'), 'rb').read(), '')
    checks['determinism_rows_identical']['comparisons'] = len(A) * len([c for c in cols if c not in EXCL_DET])
    checks['crossclient_rows_identical']['comparisons'] = len(A) * len([c for c in cols if c not in EXCL_XC])
    for k, f, want in (('edr-b', 'compare_determinism.json', 'determinism'), ('geth', 'compare_crossclient.json', 'crossclient')):
        cr = jload(os.path.join(D[k], f))
        check(f'runner_{want}_report', cr['mode'] == want and cr['identical'] is True, '')
    # pre-flight / post-flight / unit tests
    pre = jload(os.path.join(camp, f'{cid}.preflight.json')); post = jload(os.path.join(camp, f'{cid}.postflight.json'))
    for n, d in (('preflight', pre), ('postflight', post)):
        check(f'{n}_no_fail', d['fails'] == 0 and d['head'] == commit, f"fails {d['fails']}, head {d['head']}")
        lv = {x['check']: x['level'] for x in d['results']}
        check(f'{n}_archived_image', lv.get('archived image in use') == 'PASS', lv.get('archived image in use', 'missing'))
        check(f'{n}_baseline_tag', lv.get('baseline tag') == 'PASS' and lv.get('measurement sources clean') == 'PASS', '')
        check(f'{n}_network', lv.get('no network access at run time') == 'PASS', '')
    check('preflight_verifier_provenance', {x['check']: x['level'] for x in pre['results']}.get('PLONK verifier provenance re-check') == 'PASS', '')
    check('preflight_proofset_manifest', {x['check']: x['level'] for x in pre['results']}.get('proof set matches its manifest') == 'PASS', '')
    ut = open(os.path.join(camp, f'{cid}.unit_tests.log')).read()
    mp = re.search(r'(\d+) passing', ut); mf = re.search(r'(\d+) failing', ut)
    check('unit_tests', mp is not None and int(mp.group(1)) > 0 and mf is None, f"{mp.group(1) if mp else 0} passing, {mf.group(1) if mf else 0} failing")

    # ---------------------------------------------------------------- derived outputs (run a)
    R = rows['edr-a']
    by = {}
    for x in R:
        by.setdefault(x['cell_id'], []).append(x)
    out = {}
    out['l1_ops.csv'] = csv_bytes(OPS_COLS, [{c: x[c] for c in OPS_COLS} for x in R])

    def one(cell, op): v = [x for x in by[cell] if x['op'] == op]; assert len(v) == 1, (cell, op); return v[0]
    def many(cell, op): return [x for x in by[cell] if x['op'] == op]
    I = lambda x, f: int(x[f])
    cell_rows, proof_rows, neg_rows = [], [], []
    for cell in cells:
        r0 = by[cell][0]
        dv, dm, si, ar = one(cell, 'deploy_verifier'), one(cell, 'deploy_manager'), one(cell, 'set_issuer'), one(cell, 'add_root')
        vc, vd = many(cell, 'verify_credential'), many(cell, 'verify_proof_direct')
        rng = lambda xs, f: (min(I(x, f) for x in xs), max(I(x, f) for x in xs))
        vcg, vdg, vce, vde = rng(vc, 'gas_used'), rng(vd, 'gas_used'), rng(vc, 'exec_gas_derived'), rng(vd, 'exec_gas_derived')
        vdj = {x['proof_j']: x for x in vd}
        ovh = [I(x, 'gas_used') - I(vdj[x['proof_j']], 'gas_used') for x in vc]
        ovx = [I(x, 'exec_gas_derived') - I(vdj[x['proof_j']], 'exec_gas_derived') for x in vc]
        cell_rows.append({
            'cell_id': cell, 'profile': r0['profile'], 'backend': r0['backend'], 'depth': r0['depth'], 'k': len(vc),
            'verifier': dv['contract_name'], 'manager': dm['contract_name'],
            'deploy_verifier_gas': dv['gas_used'], 'deploy_verifier_intrinsic': dv['intrinsic_gas'], 'deploy_verifier_exec': dv['exec_gas_derived'],
            'deploy_verifier_code_deposit': dv['code_deposit_gas'], 'verifier_initcode_bytes': dv['initcode_bytes'], 'verifier_runtime_bytes': dv['runtime_bytes'],
            'deploy_manager_gas': dm['gas_used'], 'deploy_manager_intrinsic': dm['intrinsic_gas'], 'deploy_manager_exec': dm['exec_gas_derived'],
            'deploy_manager_code_deposit': dm['code_deposit_gas'], 'manager_initcode_bytes': dm['initcode_bytes'], 'manager_runtime_bytes': dm['runtime_bytes'],
            'set_issuer_gas': si['gas_used'], 'add_root_gas': ar['gas_used'],
            'verify_credential_gas_min': vcg[0], 'verify_credential_gas_max': vcg[1], 'verify_credential_gas_range': vcg[1] - vcg[0],
            'verify_credential_exec_min': vce[0], 'verify_credential_exec_max': vce[1],
            'verify_proof_direct_gas_min': vdg[0], 'verify_proof_direct_gas_max': vdg[1], 'verify_proof_direct_gas_range': vdg[1] - vdg[0],
            'verify_proof_direct_exec_min': vde[0], 'verify_proof_direct_exec_max': vde[1],
            'manager_overhead_gas_min': min(ovh), 'manager_overhead_gas_max': max(ovh),
            'manager_overhead_exec_min': min(ovx), 'manager_overhead_exec_max': max(ovx),
            'verify_credential_calldata_bytes': '|'.join(sorted({x['calldata_bytes'] for x in vc})),
            'verify_credential_calldata_zero_bytes_min': min(I(x, 'calldata_zero_bytes') for x in vc),
            'verify_credential_calldata_zero_bytes_max': max(I(x, 'calldata_zero_bytes') for x in vc),
            'verify_credential_intrinsic_min': min(I(x, 'intrinsic_gas') for x in vc), 'verify_credential_intrinsic_max': max(I(x, 'intrinsic_gas') for x in vc),
            'floor_binding_any': int(any(x['floor_binding'] == '1' for x in R if x['cell_id'] == cell and x['kind'] == 'tx')),
            'negatives_as_expected': int(all(x['check_pass'] == '1' for x in by[cell] if x['op'] in NEG)),
        })
        for x in vc:
            d = vdj[x['proof_j']]
            proof_rows.append({'cell_id': cell, 'backend': r0['backend'], 'depth': r0['depth'], 'proof_id': x['proof_id'], 'proof_j': x['proof_j'],
                               'leaf_index': x['leaf_index'], 'verify_credential_gas': x['gas_used'], 'verify_credential_exec': x['exec_gas_derived'],
                               'verify_credential_intrinsic': x['intrinsic_gas'], 'verify_credential_calldata_bytes': x['calldata_bytes'],
                               'verify_credential_calldata_zero_bytes': x['calldata_zero_bytes'],
                               'verify_proof_direct_gas': d['gas_used'], 'verify_proof_direct_exec': d['exec_gas_derived'],
                               'verify_proof_direct_intrinsic': d['intrinsic_gas'], 'verify_proof_direct_calldata_bytes': d['calldata_bytes'],
                               'verify_proof_direct_calldata_zero_bytes': d['calldata_zero_bytes'],
                               'manager_overhead_gas': I(x, 'gas_used') - I(d, 'gas_used'), 'manager_overhead_exec': I(x, 'exec_gas_derived') - I(d, 'exec_gas_derived')})
        for x in by[cell]:
            if x['op'] in NEG:
                neg_rows.append({'cell_id': cell, 'backend': r0['backend'], 'depth': r0['depth'], 'op': x['op'], 'kind': x['kind'], 'from_account': x['from_account'],
                                 'expected_status': x['expected_status'], 'status': x['status'], 'expected_revert': x['expected_revert'],
                                 'revert_reason': x['revert_reason'], 'expected_return': x['expected_return'], 'return_value': x['return_value'],
                                 'check_pass': x['check_pass']})
    out['l1_cells.csv'] = csv_bytes(list(cell_rows[0].keys()), cell_rows)
    out['l1_proofs.csv'] = csv_bytes(list(proof_rows[0].keys()), proof_rows)
    out['l1_negatives.csv'] = csv_bytes(list(neg_rows[0].keys()), neg_rows)

    # compile-only sizes (both build manifests of run a; identical in all runs)
    sz = []
    for p in ('primary', 'bridge'):
        m = jload(os.path.join(D['edr-a'], f'build_manifest.{p}.json'))
        for k in sorted(m['contracts']):
            c = m['contracts'][k]
            dm = re.search(r'Depth(\d+)$', c['name'])
            sz.append({'profile': p, 'source': c['source'], 'contract': c['name'], 'depth': dm.group(1) if dm else '',
                       'init_bytes': c['init_bytes'], 'runtime_bytes': c['runtime_bytes'], 'runtime_keccak': c['runtime_keccak'],
                       'eip170_runtime_ok': int(c['eip170_runtime_ok']), 'eip3860_initcode_ok': int(c['eip3860_initcode_ok']),
                       'deployed_in_matrix': int(any(x['contract_name'] == c['name'] and x['op'].startswith('deploy_') and x['profile'] == p for x in R))})
    sz.sort(key=lambda s: (s['profile'], re.sub(r'\d+$', '', s['contract']), int(s['depth'] or 0)))
    out['l1_compile_sizes.csv'] = csv_bytes(list(sz[0].keys()), sz)

    # descriptive backend comparison per depth (primary cells)
    C = {(c['backend'], int(c['depth'])): c for c in cell_rows if c['profile'] == 'primary'}
    cmp_rows = []
    for d in sorted({dd for (_, dd) in C}):
        g, p = C.get(('groth16', d)), C.get(('plonk', d))
        if not (g and p):
            continue
        row = {'depth': d}
        for q in ('verify_credential_gas', 'verify_proof_direct_gas', 'verify_credential_exec', 'verify_proof_direct_exec'):
            row[f'{q}_groth16_min'], row[f'{q}_groth16_max'] = g[f'{q}_min'], g[f'{q}_max']
            row[f'{q}_plonk_min'], row[f'{q}_plonk_max'] = p[f'{q}_min'], p[f'{q}_max']
            row[f'{q}_plonk_over_groth16_at_min'] = ratio(p[f'{q}_min'], g[f'{q}_min'])
            row[f'{q}_plonk_over_groth16_at_max'] = ratio(p[f'{q}_max'], g[f'{q}_max'])
        for q in ('deploy_verifier_gas', 'verifier_runtime_bytes'):
            row[f'{q}_groth16'], row[f'{q}_plonk'] = g[q], p[q]
            row[f'{q}_plonk_over_groth16'] = ratio(int(p[q]), int(g[q]))
        cmp_rows.append(row)
    out['l1_backend_comparison.csv'] = csv_bytes(list(cmp_rows[0].keys()), cmp_rows) if cmp_rows else b''

    # bridge cell vs July 2026 Sepolia (provenance only) and vs the primary Groth16 d11 cell
    br = [c for c in cell_rows if c['profile'] == 'bridge']
    brows = []
    if br:
        b = br[0]; prim = C.get(('groth16', 11))
        jd = {r['step']: r for r in read_csv(os.path.join(repo, JULY_DEPLOY)) if r['network'] == 'sepolia' and r['depth'] == '11'}
        inputs[JULY_DEPLOY] = sha256_file(os.path.join(repo, JULY_DEPLOY))
        jv = []
        for f in JULY_VERIFY:
            inputs[f] = sha256_file(os.path.join(repo, f))
            jv += [int(r['gas']) for r in read_csv(os.path.join(repo, f)) if r['status'] == 'success']
        spec = [('verifier deployment', 'deploy_verifier_gas', 'deploy Verifier'), ('manager deployment', 'deploy_manager_gas', 'deploy CredentialManager'),
                ('setIssuer', 'set_issuer_gas', 'setIssuer'), ('addRoot', 'add_root_gas', 'addRoot')]
        for label, f, step in spec:
            brows.append({'quantity': label, 'bridge_local_min': b[f], 'bridge_local_max': b[f], 'july_sepolia_min': jd[step]['gasUsed'],
                          'july_sepolia_max': jd[step]['gasUsed'], 'july_n': 1, 'bridge_minus_july_min': int(b[f]) - int(jd[step]['gasUsed']),
                          'primary_groth16_d11_min': prim[f] if prim else '', 'primary_groth16_d11_max': prim[f] if prim else ''})
        brows.append({'quantity': 'verifyCredential', 'bridge_local_min': b['verify_credential_gas_min'], 'bridge_local_max': b['verify_credential_gas_max'],
                      'july_sepolia_min': min(jv), 'july_sepolia_max': max(jv), 'july_n': len(jv), 'bridge_minus_july_min': b['verify_credential_gas_min'] - min(jv),
                      'primary_groth16_d11_min': prim['verify_credential_gas_min'] if prim else '', 'primary_groth16_d11_max': prim['verify_credential_gas_max'] if prim else ''})
        out['l1_bridge_vs_july.csv'] = csv_bytes(list(brows[0].keys()), brows)

    # validation.json
    val = {'campaign_id': cid, 'commit': commit, 'plan': a.plan, 'passed': all(c['pass'] for c in checks.values()),
           'rows_per_run': exp_rows, 'cells': cells, 'proofs': run['edr-a']['proofs'], 'checks': checks}
    out['validation.json'] = (json.dumps(val, indent=2, sort_keys=True) + '\n').encode()

    # values.tex
    L = ['% Generated by scripts/analysis/derive_chain_l1.py -- do not edit by hand.',
         f'% Campaign {cid}, commit {commit}, CHAIN-PROTOCOL-v1 (EDR run a; run b and the geth replay are identical on every compared field).',
         '% Gas values are exact integers (gas units). Ratios: 2 decimals. Local gas prices are not reported (bookkeeping only).', '']
    mac = lambda n, v: L.append(f'\\newcommand{{\\zc{n}}}{{{v}}}')
    mac('CampaignId', cid); mac('CampaignCommitShort', commit[:7]); mac('ProofsPerCell', len(run['edr-a']['proofs']))
    mac('RowsPerRun', exp_rows); mac('Cells', len(cells))
    for c in cell_rows:
        pre_ = ('Bridge' if c['profile'] == 'bridge' else '') + ('Groth' if c['backend'] == 'groth16' else 'Plonk') + WORD.get(int(c['depth']), str(c['depth']))
        for n, f in (('DeployVerifier', 'deploy_verifier_gas'), ('DeployManager', 'deploy_manager_gas'), ('SetIssuer', 'set_issuer_gas'),
                     ('AddRoot', 'add_root_gas'), ('VerifyCredMin', 'verify_credential_gas_min'), ('VerifyCredMax', 'verify_credential_gas_max'),
                     ('VerifyDirectMin', 'verify_proof_direct_gas_min'), ('VerifyDirectMax', 'verify_proof_direct_gas_max'),
                     ('VerifyDirectExecMin', 'verify_proof_direct_exec_min'), ('VerifyDirectExecMax', 'verify_proof_direct_exec_max'),
                     ('OverheadMin', 'manager_overhead_gas_min'), ('OverheadMax', 'manager_overhead_gas_max'),
                     ('VerifierRuntime', 'verifier_runtime_bytes'), ('ManagerRuntime', 'manager_runtime_bytes'),
                     ('VerifyCalldata', 'verify_credential_calldata_bytes')):
            mac(pre_ + n, c[f])
    for r in cmp_rows:
        w = WORD.get(int(r['depth']), str(r['depth']))
        mac(f'RatioVerifyCredMin{w}', f"{float(r['verify_credential_gas_plonk_over_groth16_at_min']):.2f}")
        mac(f'RatioVerifyCredMax{w}', f"{float(r['verify_credential_gas_plonk_over_groth16_at_max']):.2f}")
    tex = ('\n'.join(L) + '\n').encode()
    out['values.tex'] = tex

    # ---------------------------------------------------------------- write
    os.makedirs(a.out, exist_ok=True)
    outputs = {}
    for fn in sorted(out):
        if not out[fn]:
            continue
        open(os.path.join(a.out, fn), 'wb').write(out[fn]); outputs[fn] = sha256_bytes(out[fn])
    meta = {'tool': 'scripts/analysis/derive_chain_l1.py', 'tool_sha256': sha256_file(os.path.abspath(__file__)),
            'campaign_id': cid, 'campaign_commit': commit, 'plan': a.plan, 'reference_run': f'{cid}-edr-a',
            'image_id': (env['edr-a'].get('container') or {}).get('image_id'), 'protocol_sha256': run['edr-a']['protocol_sha256'],
            'proofset_manifest': run['edr-a']['proofset_manifest'],
            'rules': ['derived only from the accepted raw rows of EDR run a; run b and the geth replay are checked identical first',
                      'no rows, cells or proofs are excluded; gas values are not rounded',
                      'negative-control gas is not interpreted (protocol 7.2); negatives are summarised by status',
                      'l1_backend_comparison.csv and the ratio macros are descriptive, not section 9 metrics',
                      'l1_compile_sizes.csv is compile-only for depths not in the matrix (from the run build manifests)',
                      'l1_bridge_vs_july.csv: the July 2026 Sepolia files are pre-correction provenance records, not CSI evidence'],
            'checks': {k: v['pass'] for k, v in checks.items()}, 'inputs_sha256': dict(sorted(inputs.items())), 'outputs_sha256': outputs}
    open(os.path.join(a.out, 'derivation.json'), 'w').write(json.dumps(meta, indent=2, sort_keys=True) + '\n')
    print(json.dumps({'campaign': cid, 'checks': f'{sum(1 for c in checks.values() if c["pass"])}/{len(checks)}', 'outputs': sorted(outputs) + ['derivation.json']}))


if __name__ == '__main__':
    try:
        main()
    except CheckError as e:
        print(f'derive_chain_l1: CHECK FAILED: {e}', file=sys.stderr)
        sys.exit(2)
