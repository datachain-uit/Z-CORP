#!/usr/bin/env python3
"""Manuscript-facing prover derivations (rerun protocol v3, sections 3.3-3.6 and 8).

Reads one validated prover campaign directory, uses only the accepted attempt of every round
(prover/round_ledger.csv), excludes warm-up rows, and writes descriptive quantities. No
thresholds, no outlier exclusion. Standard library only; deterministic output.

    python3 scripts/analysis/derive_prover.py --campaign results/postcorr-20260925 --out <dir> \
        [--repo .] [--expect-campaign-id ID] [--expect-commit SHA] [--expect-tag TAG] \
        [--expect-image-id ID] [--expect-manifest-sha256 SHA]

Round sets (section 3.3/3.5): rounds 1-5 for everything compared across backends or profiles
(both backends); Groth16-specific depth quantities use rounds 1-10 and also 1-5 and 6-10.
The total is wall_ms; stage_sum_ms appears only as a labelled diagnostic.

Outputs (in --out): prover_stage_summary.csv, prover_boundary.csv, prover_crossbackend.csv,
prover_scaling.csv, prover_verify.csv, prover_diagnostic.csv, prover_containers.csv,
values.tex, derivation.json. Exit 2 if any input check fails (nothing is written then).
"""
import argparse
import csv
import hashlib
import io
import json
import os
import platform
import subprocess
import sys

STAGES = ['input_ms', 'witness_ms', 'prove_ms', 'verify_first_ms', 'wall_ms']
SUMMARY_STAGES = ['input_ms', 'witness_ms', 'prove_ms', 'verify_first_ms', 'verify_steady_ms', 'wall_ms', 'stage_sum_ms']
STRUCTURE_CSV = 'results/constraints/4.2.1-The-Growth-of-Depth-Parameterized-Circuit/20260920T120000-depth5-15-constraints.csv'


# ------------------------------------------------------------------ helpers
class CheckError(Exception):
    pass


def check(cond, msg):
    if not cond:
        raise CheckError(msg)


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha256_file(p):
    with open(p, 'rb') as f:
        return sha256_bytes(f.read())


def read_csv(p):
    with open(p, newline='') as f:
        return list(csv.DictReader(f))


def quantile(sorted_vals, q):
    """Linear interpolation between order statistics (same rule as bench/lib/common.js)."""
    pos = (len(sorted_vals) - 1) * q
    lo, hi = int(pos // 1), int(-(-pos // 1))
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def describe(vals):
    s = sorted(vals)
    q1, q3 = quantile(s, 0.25), quantile(s, 0.75)
    return {'n': len(s), 'median': quantile(s, 0.5), 'q1': q1, 'q3': q3, 'iqr': q3 - q1, 'min': s[0], 'max': s[-1]}


def median(vals):
    return describe(vals)['median']


def g(x):
    """Deterministic compact number format for CSV output."""
    if isinstance(x, int):
        return str(x)
    return format(x, '.6g')


def rounds_label(rs):
    rs = sorted(rs)
    return f'{rs[0]}-{rs[-1]}' if rs == list(range(rs[0], rs[-1] + 1)) else ' '.join(map(str, rs))


def write_csv(path, cols, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\n')
    w.writerow(cols)
    for r in rows:
        w.writerow([g(r[c]) if isinstance(r.get(c), (int, float)) else r.get(c, '') for c in cols])
    data = buf.getvalue().encode()
    with open(path, 'wb') as f:
        f.write(data)
    return sha256_bytes(data)


def git(repo, *args):
    return subprocess.run(['git', '-C', repo, *args], check=True, capture_output=True).stdout


# ------------------------------------------------------------------ load and validate
def load(args):
    c_dir = args.campaign
    cj = json.load(open(os.path.join(c_dir, 'CAMPAIGN.json')))
    checks = {}

    check(cj.get('protocol_version') == 'v3', f"protocol_version {cj.get('protocol_version')!r} != 'v3'")
    check(cj.get('mode') == 'campaign' and cj.get('plan_name') == 'campaign', 'not a full prover campaign (mode/plan)')
    for key, got in [('campaign-id', cj['campaign_id']), ('commit', cj['repo']['commit']),
                     ('image-id', cj['image']['built_image_id']), ('manifest-sha256', cj['manifest_sha256'])]:
        want = getattr(args, 'expect_' + key.replace('-', '_'))
        if want is not None:
            check(got == want, f'{key}: campaign has {got}, expected {want}')
    checks['identity_matches_expectations'] = True

    val = json.load(open(os.path.join(c_dir, 'derived', 'validation.json')))
    check(val.get('passed') is True and val.get('complete') is True, 'derived/validation.json is not passed+complete')
    check(open(os.path.join(c_dir, 'environment', 'RESULT.txt')).read().startswith('result: PASS'), 'environment/RESULT.txt is not PASS')
    checks['pipeline_validation_pass'] = f"{sum(1 for x in val['checks'] if x['passed'])}/{len(val['checks'])}"

    structure = None
    if args.repo:
        repo = args.repo
        commit = cj['repo']['commit']
        git(repo, 'cat-file', '-e', commit + '^{commit}')
        if args.expect_tag:
            tag_commit = git(repo, 'rev-parse', args.expect_tag + '^{commit}').decode().strip()
            check(tag_commit == commit, f'tag {args.expect_tag} -> {tag_commit}, campaign commit {commit}')
        manifest = git(repo, 'show', f'{commit}:ARTIFACTS.sha256')
        check(sha256_bytes(manifest) == cj['manifest_sha256'], 'ARTIFACTS.sha256 at the campaign commit does not match the campaign manifest digest')
        sbytes = git(repo, 'show', f'{commit}:{STRUCTURE_CSV}')
        want = [ln.split()[0] for ln in manifest.decode().splitlines() if ln.endswith(STRUCTURE_CSV)]
        check(want and sha256_bytes(sbytes) == want[0], 'constraint-count CSV at the campaign commit is not the manifest-covered file')
        structure = {int(r['Depth']): r for r in csv.DictReader(io.StringIO(sbytes.decode()))}
        checks['repo_commit_manifest_structure'] = True

    plan = cj['plan']
    profiles = sorted(cj['profiles'], key=lambda p: p['cpus'])
    pids = [p['id'] for p in profiles]
    units = [('primary', r) for r in plan['primary_rounds']] + [('diag', r) for r in plan['diag_rounds']]

    ledger = read_csv(os.path.join(c_dir, 'prover', 'round_ledger.csv'))
    accepted = {}
    for l in ledger:
        check(l['campaign_id'] == cj['campaign_id'], 'ledger row from another campaign')
        check(l['status'] in ('complete', 'failed', 'incomplete'), f"unknown ledger status {l['status']}")
        if l['accepted'] == '1':
            key = (l['kind'], int(l['round']))
            check(key not in accepted, f'more than one accepted attempt for {key}')
            check(l['status'] == 'complete', f'accepted attempt not complete for {key}')
            accepted[key] = int(l['round_attempt'])
    for u in units:
        check(u in accepted, f'no accepted attempt for {u}')
    check(set(accepted) == set(units), 'ledger has accepted units outside the plan')
    checks['ledger'] = {'units': len(units), 'accepted': len(accepted),
                        'failed': sum(1 for l in ledger if l['status'] == 'failed'),
                        'incomplete': sum(1 for l in ledger if l['status'] == 'incomplete'),
                        'rerun_attempts': sum(1 for a in accepted.values() if a > 1)}

    runs, diag, conts = [], [], []
    for p in pids:
        runs += read_csv(os.path.join(c_dir, 'prover', p, 'runs.csv'))
        diag += read_csv(os.path.join(c_dir, 'prover', p, 'diag.csv'))
        conts += read_csv(os.path.join(c_dir, 'prover', p, 'rounds.csv'))
    for r in runs + diag + conts:
        check(r['campaign_id'] == cj['campaign_id'], 'row from another campaign')
        check(r['image_id'] == cj['image']['built_image_id'], 'row with another image')
    for r in runs + diag:
        check(r['manifest_sha256'] == cj['manifest_sha256'], 'row with another manifest')
    checks['rows_identity'] = True

    acc = lambda kind, rnd, att: accepted.get((kind, int(rnd))) == int(att)
    prim = [r for r in runs if r['kind'] == 'primary' and r['is_warmup'] == '0' and acc('primary', r['round'], r['round_attempt'])]
    dg = [r for r in diag if acc('diag', r['diag_round'], r['round_attempt'])]
    ctn = [r for r in conts if acc(r['kind'], r['round'], r['round_attempt'])]
    warm_acc = [r for r in runs if r['is_warmup'] == '1' and acc(r['kind'], r['round'], r['round_attempt'])]

    T = {}
    for r in prim:
        check(r['status'] == 'ok' and r['proof_valid'] == '1' and r['root_matches'] == '1' and r['input_matches_committed'] == '1',
              f"invalid accepted row {r['run_id']}")
        k = (r['profile_id'], r['backend'], int(r['depth']), int(r['round']))
        check(k not in T, f'duplicate accepted row {k}')
        T[k] = r
    depths = sorted({int(c.split(':')[1]) for c in plan['primary_configs']})
    g16_rounds = [r for r in plan['primary_rounds'] if r != 0]
    plonk_rounds = [r for r in g16_rounds if r not in plan['groth16_only_rounds']]
    expected = {(p, 'groth16', d, r) for p in pids for d in depths for r in g16_rounds} | \
               {(p, 'plonk', d, r) for p in pids for d in depths for r in plonk_rounds}
    check(set(T) == expected, f'accepted measured rows != expected ({len(T)} vs {len(expected)})')

    D = {}
    diag_cfgs = [(c.split(':')[0], int(c.split(':')[1])) for c in plan['diag_configs']]
    for r in dg:
        check(r['status'] == 'ok' and r['proof_valid'] == '1' and r['root_matches'] == '1', 'invalid accepted diagnostic row')
        k = (r['profile_id'], r['backend'], int(r['depth']), int(r['diag_round']), r['call'])
        check(k not in D, f'duplicate diagnostic row {k}')
        D[k] = r
    expected_d = {(p, b, d, r, call) for p in pids for (b, d) in diag_cfgs for r in plan['diag_rounds'] for call in ('path', 'mem')}
    check(set(D) == expected_d, f'accepted diagnostic rows != expected ({len(D)} vs {len(expected_d)})')

    for r in ctn:
        prof = next(p for p in profiles if p['id'] == r['profile_id'])
        check(r['status'] == 'ok' and r['oom_kill'] == '0' and r['nr_throttled'] == '0', f"container flag {r['container_id']}")
        check(int(r['ffjs_concurrency']) == prof['cpus'], f"ffjavascript concurrency {r['ffjs_concurrency']} in {r['profile_id']}")
    check(len(ctn) == len(units) * len(pids), 'accepted container count != units x profiles')

    checks['expected_counts'] = {'measured_primary_rows': len(T), 'diagnostic_rows': len(D), 'containers': len(ctn),
                                 'warmup_rows_in_accepted_attempts_excluded': len(warm_acc)}
    inputs = {}
    for rel in ['CAMPAIGN.json', 'derived/validation.json', 'environment/RESULT.txt', 'prover/round_ledger.csv'] + \
               [f'prover/{p}/{f}' for p in pids for f in ('runs.csv', 'diag.csv', 'rounds.csv')]:
        inputs[rel] = sha256_file(os.path.join(c_dir, rel))
    return dict(cj=cj, pids=pids, profiles=profiles, depths=depths, g16_rounds=g16_rounds, plonk_rounds=plonk_rounds,
                diag_rounds=plan['diag_rounds'], diag_cfgs=diag_cfgs, T=T, D=D, ctn=ctn, checks=checks, inputs=inputs,
                structure=structure)


# ------------------------------------------------------------------ derivations
def ratio_row(base, vals, definition):
    d = describe([v for _, v in vals])
    return dict(base, n=d['n'], median=d['median'], min=d['min'], max=d['max'],
                values=';'.join(f'{k}={g(v)}' for k, v in vals), definition=definition)


def derive(S):
    T, D, pids, depths = S['T'], S['D'], S['pids'], S['depths']
    v = lambda p, b, d, r, m='prove_ms': float(T[(p, b, d, r)][m])
    out = {}

    # ---- stage summary (Table 8 uses round_set 1-5)
    rows = []
    sets = {'plonk': [S['plonk_rounds']], 'groth16': [S['plonk_rounds'], S['g16_rounds'],
                                                        [r for r in S['g16_rounds'] if r not in S['plonk_rounds']]]}
    for p in pids:
        for b in ('groth16', 'plonk'):
            for rs in sets[b]:
                for d in depths:
                    for m in SUMMARY_STAGES:
                        st = describe([v(p, b, d, r, m) for r in rs])
                        rows.append(dict(profile_id=p, backend=b, depth=d, stage=m, rounds=rounds_label(rs),
                                         role='total' if m == 'wall_ms' else ('diagnostic' if m == 'stage_sum_ms' else 'stage'), **st))
    out['prover_stage_summary.csv'] = (['profile_id', 'backend', 'depth', 'stage', 'role', 'rounds', 'n', 'median', 'q1', 'q3', 'iqr', 'min', 'max'], rows)

    # ---- boundary / plateau (prove_ms)
    rows = []
    P_L, P_U = [d for d in depths if d <= 10], [d for d in depths if d >= 11]
    G_L, G_U = [d for d in depths if d <= 7], [d for d in depths if d >= 8]
    pr = S['plonk_rounds']
    for p in pids:
        b = 'plonk'
        base = dict(backend=b, profile_id=p, metric='prove_ms', rounds=rounds_label(pr))
        rows.append(ratio_row(dict(base, quantity='A_boundary_d11_over_d10'), [(f'r{r}', v(p, b, 11, r) / v(p, b, 10, r)) for r in pr], 'prove_r(11)/prove_r(10)'))
        rows.append(ratio_row(dict(base, quantity='S_plateau_medU_over_medL'),
                              [(f'r{r}', median([v(p, b, d, r) for d in P_U]) / median([v(p, b, d, r) for d in P_L])) for r in pr],
                              'median over d in {11..15} / median over d in {5..10}, per round'))
        for lo, hi, nm in [(10, 5, 'plateau_end_L_d10_over_d5'), (15, 11, 'plateau_end_U_d15_over_d11')]:
            rows.append(ratio_row(dict(base, quantity=nm), [(f'r{r}', v(p, b, lo, r) / v(p, b, hi, r)) for r in pr], f'prove_r({lo})/prove_r({hi})'))
        for plateau, ds in [('L', P_L), ('U', P_U)]:
            pooled = []
            for d0, d1 in zip(ds, ds[1:]):
                vals = [(f'r{r}', v(p, b, d1, r) / v(p, b, d0, r)) for r in pr]
                rows.append(ratio_row(dict(base, quantity=f'adjacent_d{d1}_over_d{d0}'), vals, f'prove_r({d1})/prove_r({d0}), within plateau {plateau}'))
                pooled += [(f'{k}:d{d1}/d{d0}', x) for k, x in vals]
            rows.append(ratio_row(dict(base, quantity=f'adjacent_within_{plateau}_pooled'), pooled, f'all adjacent ratios within plateau {plateau}, pooled over pairs and rounds'))
        b = 'groth16'
        for rs in sets['groth16']:
            base = dict(backend=b, profile_id=p, metric='prove_ms', rounds=rounds_label(rs))
            rows.append(ratio_row(dict(base, quantity='depth_d15_over_d5'), [(f'r{r}', v(p, b, 15, r) / v(p, b, 5, r)) for r in rs], 'prove_r(15)/prove_r(5)'))
            rows.append(ratio_row(dict(base, quantity='B_boundary_d8_over_d7'), [(f'r{r}', v(p, b, 8, r) / v(p, b, 7, r)) for r in rs], 'prove_r(8)/prove_r(7)'))
            rows.append(ratio_row(dict(base, quantity='S_plateau_medU_over_medL'),
                                  [(f'r{r}', median([v(p, b, d, r) for d in G_U]) / median([v(p, b, d, r) for d in G_L])) for r in rs],
                                  'median over d in {8..15} / median over d in {5,6,7}, per round'))
            for d0, d1 in zip(depths, depths[1:]):
                rows.append(ratio_row(dict(base, quantity=f'adjacent_d{d1}_over_d{d0}'), [(f'r{r}', v(p, b, d1, r) / v(p, b, d0, r)) for r in rs], f'prove_r({d1})/prove_r({d0})'))
            for plateau, ds in [('L', G_L), ('U', G_U)]:
                pooled = [(f'r{r}:d{d1}/d{d0}', v(p, b, d1, r) / v(p, b, d0, r)) for d0, d1 in zip(ds, ds[1:]) for r in rs]
                rows.append(ratio_row(dict(base, quantity=f'adjacent_within_{plateau}_pooled'), pooled, f'all adjacent ratios within plateau {plateau}, pooled over pairs and rounds'))
    # structural growth next to the plateau quantities (not measured times)
    st = S['structure']
    zk = lambda b, d: int(T[(pids[0], b, d, pr[0])]['zkey_bytes'])
    struct_rows = []
    for b, lo, hi in [('plonk', 5, 10), ('plonk', 11, 15), ('groth16', 5, 7), ('groth16', 8, 15), ('groth16', 7, 8), ('plonk', 10, 11)]:
        items = [('zkey_bytes', zk(b, lo), zk(b, hi))]
        if st:
            col = 'PLONK' if b == 'plonk' else 'Groth16'
            dom = 'PLONK Domain' if b == 'plonk' else 'G16 Domain'
            items += [('constraints_or_gates', int(st[lo][col]), int(st[hi][col])), ('domain', int(st[lo][dom]), int(st[hi][dom]))]
        for name, a, z in items:
            struct_rows.append(dict(backend=b, profile_id='all', quantity=f'structure_{name}_d{hi}_over_d{lo}', metric=name, rounds='structure',
                                    n=1, median=z / a, min=z / a, max=z / a, values=f'd{lo}={a};d{hi}={z}',
                                    definition=f'{name}(d{hi})/{name}(d{lo}) from ' + ('zkey_bytes recorded in runs.csv' if name == 'zkey_bytes' else STRUCTURE_CSV)))
    out['prover_boundary.csv'] = (['backend', 'profile_id', 'quantity', 'metric', 'rounds', 'n', 'median', 'min', 'max', 'values', 'definition'], rows + struct_rows)

    # ---- cross-backend (rounds 1-5, paired within container)
    rows = []
    for p in pids:
        for m in ('prove_ms', 'wall_ms'):
            meds = []
            for d in depths:
                vals = [(f'r{r}', v(p, 'plonk', d, r, m) / v(p, 'groth16', d, r, m)) for r in pr]
                row = ratio_row(dict(profile_id=p, metric=m, depth=d, quantity='plonk_over_groth16', rounds=rounds_label(pr)), vals, f'PLONK_r(d)/Groth16_r(d), {m}')
                rows.append(row)
                meds.append((f'd{d}', row['median']))
            dd = describe([x for _, x in meds])
            rows.append(dict(profile_id=p, metric=m, depth='all', quantity='range_of_depth_medians', rounds=rounds_label(pr), n=dd['n'],
                             median=dd['median'], min=dd['min'], max=dd['max'], values=';'.join(f'{k}={g(x)}' for k, x in meds),
                             definition='min and max over depths of the per-depth median ratio (median shown for reference)'))
    out['prover_crossbackend.csv'] = (['profile_id', 'metric', 'depth', 'quantity', 'rounds', 'n', 'median', 'min', 'max', 'values', 'definition'], rows)

    # ---- resource scaling (rounds 1-5, paired by round)
    rows = []
    base_p, p4, p8 = pids[0], pids[1], pids[2]
    ratios = [('S4_cpu2_over_cpu4', base_p, p4), ('S8_cpu2_over_cpu8', base_p, p8), ('doubling_cpu4_over_cpu8', p4, p8)]
    for b in ('groth16', 'plonk'):
        for m in STAGES + ['stage_sum_ms']:
            role = 'total' if m == 'wall_ms' else ('diagnostic' if m == 'stage_sum_ms' else 'stage')
            for name, num, den in ratios:
                meds = []
                for d in depths:
                    vals = [(f'r{r}', v(num, b, d, r, m) / v(den, b, d, r, m)) for r in pr]
                    row = ratio_row(dict(backend=b, stage=m, role=role, depth=d, ratio=name, rounds=rounds_label(pr)), vals, f'T_r({num})/T_r({den})')
                    rows.append(row)
                    meds.append((f'd{d}', row['median']))
                dd = describe([x for _, x in meds])
                rows.append(dict(backend=b, stage=m, role=role, depth='all', ratio=name, rounds=rounds_label(pr), n=dd['n'], median=dd['median'],
                                 min=dd['min'], max=dd['max'], values=';'.join(f'{k}={g(x)}' for k, x in meds),
                                 definition='median and min-max over depths of the per-depth median (Figure 5)'))
    out['prover_scaling.csv'] = (['backend', 'stage', 'role', 'depth', 'ratio', 'rounds', 'n', 'median', 'min', 'max', 'values', 'definition'], rows)

    # ---- verification
    rows = []
    for p in pids:
        for b in ('groth16', 'plonk'):
            for rs in ([pr] if b == 'plonk' else [pr, S['g16_rounds']]):
                for d in list(depths) + ['all']:
                    ds = depths if d == 'all' else [d]
                    f = [v(p, b, x, r, 'verify_first_ms') for x in ds for r in rs]
                    s = [v(p, b, x, r, 'verify_steady_ms') for x in ds for r in rs]
                    q = [a / c for a, c in zip(f, s)]
                    rq = describe(q)
                    rows.append(dict(profile_id=p, backend=b, depth=d, rounds=rounds_label(rs), n=len(f), verify_first_median=median(f),
                                     verify_steady_median=median(s), first_over_steady_median=rq['median'],
                                     first_over_steady_min=rq['min'], first_over_steady_max=rq['max']))
    out['prover_verify.csv'] = (['profile_id', 'backend', 'depth', 'rounds', 'n', 'verify_first_median', 'verify_steady_median',
                                 'first_over_steady_median', 'first_over_steady_min', 'first_over_steady_max'], rows)

    # ---- key-loading diagnostic (diagnostic rounds)
    rows = []
    drs = S['diag_rounds']
    dv = lambda p, b, d, r, call, m='prove_ms': float(D[(p, b, d, r, call)][m])
    for p in pids:
        for b, d in S['diag_cfgs']:
            base = dict(profile_id=p, backend=b, depth=d, rounds=rounds_label(drs))
            for q, fn, df in [('path_prove_ms', lambda r: dv(p, b, d, r, 'path'), 'prove_ms of the path call'),
                              ('mem_prove_ms', lambda r: dv(p, b, d, r, 'mem'), 'prove_ms of the mem call'),
                              ('paired_diff_path_minus_mem_ms', lambda r: dv(p, b, d, r, 'path') - dv(p, b, d, r, 'mem'), 'path - mem, same diagnostic round'),
                              ('paired_ratio_mem_over_path', lambda r: dv(p, b, d, r, 'mem') / dv(p, b, d, r, 'path'), 'mem / path, same diagnostic round'),
                              ('zkey_readfile_ms', lambda r: dv(p, b, d, r, 'mem', 'zkey_readfile_ms'), 'fs.readFileSync(zkey) before the mem call')]:
                rows.append(ratio_row(dict(base, quantity=q), [(f'dr{r}', fn(r)) for r in drs], df))
        for b, pairs in [('plonk', [(11, 10, 'A_boundary_d11_over_d10'), (10, 5, 'plateau_end_L_d10_over_d5'), (15, 11, 'plateau_end_U_d15_over_d11')]),
                         ('groth16', [(8, 7, 'B_boundary_d8_over_d7'), (7, 5, 'plateau_end_L_d7_over_d5'), (15, 8, 'plateau_end_U_d15_over_d8')])]:
            for hi, lo, nm in pairs:
                for call in ('path', 'mem'):
                    rows.append(ratio_row(dict(profile_id=p, backend=b, depth=f'{hi}/{lo}', rounds=rounds_label(drs), quantity=f'{nm}_{call}'),
                                          [(f'dr{r}', dv(p, b, hi, r, call) / dv(p, b, lo, r, call)) for r in drs], f'prove({hi})/prove({lo}), {call} calls'))
    out['prover_diagnostic.csv'] = (['profile_id', 'backend', 'depth', 'quantity', 'rounds', 'n', 'median', 'min', 'max', 'values', 'definition'], rows)

    # ---- recorded container facts
    rows = []
    for p in pids:
        cs = [c for c in S['ctn'] if c['profile_id'] == p]
        mp = describe([float(c['memory_peak_bytes']) for c in cs])
        rows.append(dict(profile_id=p, containers=len(cs), ffjs_concurrency=' '.join(sorted({c['ffjs_concurrency'] for c in cs})),
                         cpuset=' '.join(sorted({c['cpuset'] for c in cs})), oom_kill_total=sum(int(c['oom_kill']) for c in cs),
                         nr_throttled_total=sum(int(c['nr_throttled']) for c in cs), memory_peak_bytes_min=int(mp['min']),
                         memory_peak_bytes_median=mp['median'], memory_peak_bytes_max=int(mp['max'])))
    out['prover_containers.csv'] = (['profile_id', 'containers', 'ffjs_concurrency', 'cpuset', 'oom_kill_total', 'nr_throttled_total',
                                     'memory_peak_bytes_min', 'memory_peak_bytes_median', 'memory_peak_bytes_max'], rows)
    return out


# ------------------------------------------------------------------ values.tex
WORD = {'cpu2': 'CpuTwo', 'cpu4': 'CpuFour', 'cpu8': 'CpuEight', 'groth16': 'Groth', 'plonk': 'Plonk'}


def values_tex(S, out):
    lines = ['% Generated by scripts/analysis/derive_prover.py -- do not edit by hand.',
             f"% Campaign {S['cj']['campaign_id']}, commit {S['cj']['repo']['commit']}, protocol v3.",
             '% Ratios: 2 decimals; times: 1 decimal (ms); percentages: integers.', '']
    mac = lambda name, val: lines.append(f'\\newcommand{{\\zp{name}}}{{{val}}}')
    f2 = lambda x: f'{x:.2f}'
    f1 = lambda x: f'{x:.1f}'
    find = lambda f, **kw: [r for r in out[f][1] if all(str(r.get(k)) == str(v) for k, v in kw.items())]

    def one(f, **kw):
        rs = find(f, **kw)
        if len(rs) != 1:
            raise RuntimeError(f'values.tex: {f} {kw} matched {len(rs)} rows')
        return rs[0]
    mac('CampaignId', S['cj']['campaign_id'])
    mac('CampaignCommitShort', S['cj']['repo']['commit'][:7])
    mac('RoundsCompared', rounds_label(S['plonk_rounds']).replace('-', '--'))
    mac('RoundsGrothDepth', rounds_label(S['g16_rounds']).replace('-', '--'))
    for p in S['pids']:
        P = WORD[p]
        for q, nm in [('A_boundary_d11_over_d10', 'PlonkBoundary'), ('S_plateau_medU_over_medL', 'PlonkPlateau'),
                      ('plateau_end_L_d10_over_d5', 'PlonkEndL'), ('plateau_end_U_d15_over_d11', 'PlonkEndU')]:
            r = one('prover_boundary.csv', backend='plonk', profile_id=p, quantity=q)
            mac(f'{nm}{P}Med', f2(r['median'])); mac(f'{nm}{P}Min', f2(r['min'])); mac(f'{nm}{P}Max', f2(r['max']))
        for plat in ('L', 'U'):
            r = one('prover_boundary.csv', backend='plonk', profile_id=p, quantity=f'adjacent_within_{plat}_pooled')
            mac(f'PlonkAdj{plat}{P}Min', f2(r['min'])); mac(f'PlonkAdj{plat}{P}Max', f2(r['max']))
        for rs, suf in [(S['g16_rounds'], ''), (S['plonk_rounds'], 'FirstFive')]:
            for q, nm in [('depth_d15_over_d5', 'GrothDepth'), ('B_boundary_d8_over_d7', 'GrothBoundary'), ('S_plateau_medU_over_medL', 'GrothPlateau')]:
                r = one('prover_boundary.csv', backend='groth16', profile_id=p, quantity=q, rounds=rounds_label(rs))
                mac(f'{nm}{suf}{P}Med', f2(r['median'])); mac(f'{nm}{suf}{P}Min', f2(r['min'])); mac(f'{nm}{suf}{P}Max', f2(r['max']))
        for plat in ('L', 'U'):
            r = one('prover_boundary.csv', backend='groth16', profile_id=p, quantity=f'adjacent_within_{plat}_pooled', rounds=rounds_label(S['g16_rounds']))
            mac(f'GrothAdj{plat}{P}Min', f2(r['min'])); mac(f'GrothAdj{plat}{P}Max', f2(r['max']))
        for m, nm in [('prove_ms', 'Prove'), ('wall_ms', 'Wall')]:
            r = one('prover_crossbackend.csv', profile_id=p, metric=m, depth='all')
            mac(f'Gap{nm}{P}Min', f'{r["min"]:.0f}'); mac(f'Gap{nm}{P}Max', f'{r["max"]:.0f}')
        for b in ('groth16', 'plonk'):
            r = one('prover_verify.csv', profile_id=p, backend=b, depth='all', rounds=rounds_label(S['plonk_rounds']))
            mac(f'{WORD[b]}VerifyFirst{P}', f1(r['verify_first_median'])); mac(f'{WORD[b]}VerifySteady{P}', f1(r['verify_steady_median']))
        for q, nm in [('A_boundary_d11_over_d10_path', 'DiagPlonkBoundaryPath'), ('A_boundary_d11_over_d10_mem', 'DiagPlonkBoundaryMem')]:
            r = one('prover_diagnostic.csv', profile_id=p, backend='plonk', quantity=q)
            mac(f'{nm}{P}Med', f2(r['median']))
        for d, nm in [(10, 'Ten'), (11, 'Eleven')]:
            r = one('prover_diagnostic.csv', profile_id=p, backend='plonk', depth=d, quantity='zkey_readfile_ms')
            mac(f'DiagPlonkReadfile{nm}{P}', f1(r['median']))
    for b in ('groth16', 'plonk'):
        for m, nm in [('prove_ms', 'Prove'), ('wall_ms', 'Wall'), ('input_ms', 'Input'), ('witness_ms', 'Witness'), ('verify_first_ms', 'VerifyFirst')]:
            for ratio, rn in [('S4_cpu2_over_cpu4', 'SFour'), ('S8_cpu2_over_cpu8', 'SEight'), ('doubling_cpu4_over_cpu8', 'DFourEight')]:
                r = one('prover_scaling.csv', backend=b, stage=m, depth='all', ratio=ratio)
                mac(f'{WORD[b]}{rn}{nm}Med', f2(r['median'])); mac(f'{WORD[b]}{rn}{nm}Min', f2(r['min'])); mac(f'{WORD[b]}{rn}{nm}Max', f2(r['max']))
    rat = [r for r in out['prover_diagnostic.csv'][1] if r['quantity'] == 'paired_ratio_mem_over_path']
    mac('DiagMemPathMin', f2(min(r['median'] for r in rat))); mac('DiagMemPathMax', f2(max(r['median'] for r in rat)))
    for b, lo, hi, nm in [('plonk', 5, 10, 'PlonkGatesGrowthL'), ('plonk', 11, 15, 'PlonkGatesGrowthU')]:
        rs = find('prover_boundary.csv', backend=b, quantity=f'structure_constraints_or_gates_d{hi}_over_d{lo}')
        if rs:
            mac(nm + 'Pct', f"{(rs[0]['median'] - 1) * 100:.0f}")
        r = one('prover_boundary.csv', backend=b, quantity=f'structure_zkey_bytes_d{hi}_over_d{lo}')
        mac(nm.replace('Gates', 'Key') + 'Pct', f"{(r['median'] - 1) * 100:.1f}")
    return ('\n'.join(lines) + '\n').encode()


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--campaign', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--repo')
    for k in ('campaign-id', 'commit', 'tag', 'image-id', 'manifest-sha256'):
        ap.add_argument('--expect-' + k)
    args = ap.parse_args()
    try:
        S = load(args)
        out = derive(S)
    except CheckError as e:
        print(f'derive_prover: CHECK FAILED: {e}', file=sys.stderr)
        sys.exit(2)
    os.makedirs(args.out, exist_ok=True)
    outputs = {}
    for name, (cols, rows) in out.items():
        outputs[name] = write_csv(os.path.join(args.out, name), cols, rows)
    tex = values_tex(S, out)
    with open(os.path.join(args.out, 'values.tex'), 'wb') as f:
        f.write(tex)
    outputs['values.tex'] = sha256_bytes(tex)
    meta = {
        'tool': 'scripts/analysis/derive_prover.py', 'tool_sha256': sha256_file(os.path.abspath(__file__)),
        'python': platform.python_version(), 'protocol': 'v3 (sections 3.3-3.6, 8)',
        'campaign_id': S['cj']['campaign_id'], 'campaign_commit': S['cj']['repo']['commit'],
        'image_id': S['cj']['image']['built_image_id'], 'manifest_sha256': S['cj']['manifest_sha256'],
        'round_sets': {'compared_both_backends': rounds_label(S['plonk_rounds']), 'groth16_depth': rounds_label(S['g16_rounds']),
                       'diagnostic': rounds_label(S['diag_rounds'])},
        'rules': ['accepted attempts only (prover/round_ledger.csv)', 'warm-up rows excluded', 'no thresholds, no outlier exclusion',
                  'wall_ms is the pipeline total; stage_sum_ms only as a labelled diagnostic',
                  'doubling ratio cpu2/cpu4 equals S4 and is not repeated'],
        'checks': S['checks'], 'inputs_sha256': S['inputs'], 'outputs_sha256': outputs,
    }
    with open(os.path.join(args.out, 'derivation.json'), 'w') as f:
        json.dump(meta, f, indent=2, sort_keys=True)
        f.write('\n')
    print(f"derive_prover: {S['cj']['campaign_id']}: {len(outputs)} outputs written to {args.out}")


if __name__ == '__main__':
    main()
