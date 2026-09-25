#!/usr/bin/env python3
"""Compare the ad hoc numbers of the CSI-PROVER-01 completion report with the committed derivations.

The report values below are transcribed verbatim from J2-CSI-PROVER-01-completion-report.md
(items 8 and 13). The scripted values are read from the outputs of scripts/analysis/derive_prover.py.
A value "matches" when the scripted value, rounded to the precision printed in the report, equals it.
Nothing is adjusted to make the two agree; every difference is listed.

    python3 scripts/analysis/compare_completion_report.py --derived <derive_prover output dir>
Prints Markdown on stdout.
"""
import argparse
import csv
import json
import os

P = ['cpu2', 'cpu4', 'cpu8']


def load(d, name):
    with open(os.path.join(d, name), newline='') as f:
        return list(csv.DictReader(f))


def pick(rows, **kw):
    out = [r for r in rows if all(r[k] == str(v) for k, v in kw.items())]
    if len(out) != 1:
        raise SystemExit(f'expected one row for {kw}, found {len(out)}')
    return out[0]


def rnd(x, nd):
    return f'{float(x):.{nd}f}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--derived', required=True)
    a = ap.parse_args()
    B, X, S, V, Dg, St = (load(a.derived, f) for f in ('prover_boundary.csv', 'prover_crossbackend.csv', 'prover_scaling.csv',
                                                     'prover_verify.csv', 'prover_diagnostic.csv', 'prover_stage_summary.csv'))
    meta = json.load(open(os.path.join(a.derived, 'derivation.json')))
    rows = []

    def add(item, statement, report, scripted, basis, status=None):
        if status is None:
            status = 'match' if report == scripted else '**DIFFERS**'
        rows.append((item, statement, report, scripted, basis, status))

    def rng(vals, nd):
        return f'{rnd(min(vals), nd)}–{rnd(max(vals), nd)}'

    # ---- item 8: counts
    c = meta['checks']['expected_counts']
    add('8', 'measured primary rows / warm-up rows / diagnostic calls / containers', '495 / 162 / 240 / 48',
        f"{c['measured_primary_rows']} / {c['warmup_rows_in_accepted_attempts_excluded']} / {c['diagnostic_rows']} / {c['containers']}",
        'derivation checks')
    # ---- depth (Groth16, rounds 1-10)
    rep = {'cpu2': '1.79', 'cpu4': '1.85', 'cpu8': '1.88'}
    for p in P:
        r = pick(B, backend='groth16', profile_id=p, quantity='depth_d15_over_d5', rounds='1-10')
        add('13 depth', f'Groth16 prove d15/d5, {p}', rep[p], rnd(r['median'], 2), 'prover_boundary, rounds 1-10')
    rep = {'cpu2': '2.12', 'cpu4': '2.46', 'cpu8': '2.69'}
    for p in P:
        lo = float(pick(St, profile_id=p, backend='groth16', depth=5, stage='wall_ms', rounds='1-10')['median'])
        hi = float(pick(St, profile_id=p, backend='groth16', depth=15, stage='wall_ms', rounds='1-10')['median'])
        add('13 depth', f'Groth16 wall d15/d5, {p}', rep[p], f'(ratio of medians {hi / lo:.2f})',
            'not a protocol quantity: no scripted counterpart; the report used the median of per-round ratios', 'no counterpart')
    for d, rv, nd in [(5, '0.8', 1), (10, '3', 0), (14, '51–56', 0), (15, '116–121', 0)]:
        vals = [float(pick(St, profile_id=p, backend='groth16', depth=d, stage='input_ms', rounds='1-10')['median']) for p in P]
        sv = rnd(vals[0], nd) if '–' not in rv and len({rnd(v, nd) for v in vals}) == 1 else rng(vals, nd)
        add('13 depth', f'Groth16 input_ms median at d{d} ("about", all profiles)', rv, sv, 'prover_stage_summary, rounds 1-10')
    adj = []
    for p in P:
        for d0, d1 in [(5, 6), (6, 7), (7, 8), (8, 9), (9, 10), (11, 12), (12, 13), (13, 14), (14, 15)]:
            adj.append(float(pick(B, backend='plonk', profile_id=p, quantity=f'adjacent_d{d1}_over_d{d0}')['median']))
    add('13 depth', 'PLONK neighbouring-depth ratios within d5-10 and d11-15 (per-pair medians, all profiles)', '0.99–1.02', rng(adj, 2),
        'prover_boundary, rounds 1-5')
    # ---- cross-backend
    rep = {('prove_ms', 'cpu2'): '33–62', ('prove_ms', 'cpu4'): '47–86', ('prove_ms', 'cpu8'): '62–116',
           ('wall_ms', 'cpu2'): '30–55', ('wall_ms', 'cpu4'): '42–76', ('wall_ms', 'cpu8'): '54–100'}
    for (m, p), rv in rep.items():
        r = pick(X, profile_id=p, metric=m, depth='all')
        add('13 cross-backend', f'PLONK/Groth16 {m}, {p} (range of per-depth medians)', rv, f"{rnd(r['min'], 0)}–{rnd(r['max'], 0)}",
            'prover_crossbackend, rounds 1-5')
    # ---- scaling
    rep = [('groth16', 'prove_ms', 'S4_cpu2_over_cpu4', '1.63–1.84'), ('groth16', 'prove_ms', 'S8_cpu2_over_cpu8', '2.35–2.62'),
           ('groth16', 'prove_ms', 'doubling_cpu4_over_cpu8', '1.36–1.43'), ('groth16', 'wall_ms', 'S4_cpu2_over_cpu4', '1.60–1.82'),
           ('groth16', 'wall_ms', 'S8_cpu2_over_cpu8', '2.01–2.50'), ('plonk', 'prove_ms', 'S4_cpu2_over_cpu4', '1.17–1.19'),
           ('plonk', 'prove_ms', 'S8_cpu2_over_cpu8', '1.24–1.28'), ('plonk', 'prove_ms', 'doubling_cpu4_over_cpu8', '1.04–1.08'),
           ('plonk', 'wall_ms', 'S4_cpu2_over_cpu4', '1.17–1.19'), ('plonk', 'wall_ms', 'S8_cpu2_over_cpu8', '1.24–1.28'),
           ('plonk', 'wall_ms', 'doubling_cpu4_over_cpu8', '1.04–1.08'), ('groth16', 'witness_ms', 'S8_cpu2_over_cpu8', '1.43–1.96')]
    for b, m, ratio, rv in rep:
        r = pick(S, backend=b, stage=m, depth='all', ratio=ratio)
        add('13 scaling', f'{b} {m} {ratio} (min–max over depths of per-depth medians)', rv, f"{rnd(r['min'], 2)}–{rnd(r['max'], 2)}",
            'prover_scaling, rounds 1-5')
    vals = [float(pick(S, backend='groth16', stage='input_ms', depth='all', ratio=q)[k]) for q in ('S4_cpu2_over_cpu4', 'S8_cpu2_over_cpu8') for k in ('min', 'max')]
    add('13 scaling', 'Groth16 input_ms S (S4 and S8 together)', '0.85–1.09', rng(vals, 2), 'prover_scaling, rounds 1-5')
    r = pick(S, backend='plonk', stage='witness_ms', depth='all', ratio='S8_cpu2_over_cpu8')
    add('13 scaling', '(reference) PLONK witness_ms S8', '—', f"{rnd(r['min'], 2)}–{rnd(r['max'], 2)}", 'prover_scaling, rounds 1-5', 'reference only')
    # ---- PLONK d10 -> d11 and Groth16 d7 -> d8
    rep = {'cpu2': ('1.93', '1.92–1.95'), 'cpu4': ('1.93', '1.91–1.95'), 'cpu8': ('1.96', '1.95–2.01')}
    for p in P:
        r = pick(B, backend='plonk', profile_id=p, quantity='A_boundary_d11_over_d10')
        add('13 PLONK d10→d11', f'prove d11/d10, {p}: median (min–max over rounds)', f'{rep[p][0]} ({rep[p][1]})',
            f"{rnd(r['median'], 2)} ({rnd(r['min'], 2)}–{rnd(r['max'], 2)})", 'prover_boundary, rounds 1-5')
    rep = {'cpu2': ('1.14', '1.00–1.31'), 'cpu4': ('1.16', '1.09–1.23'), 'cpu8': ('1.18', '1.06–1.23')}
    for p in P:
        r = pick(B, backend='groth16', profile_id=p, quantity='B_boundary_d8_over_d7', rounds='1-10')
        add('13 Groth16 d7→d8', f'prove d8/d7, {p}: median (min–max over rounds)', f'{rep[p][0]} ({rep[p][1]})',
            f"{rnd(r['median'], 2)} ({rnd(r['min'], 2)}–{rnd(r['max'], 2)})", 'prover_boundary, rounds 1-10')
    adj = [float(pick(B, backend='groth16', profile_id=p, quantity=f'adjacent_d{d + 1}_over_d{d}', rounds='1-10')['median'])
           for p in P for d in range(5, 15) if d != 7]
    add('13 Groth16 d7→d8', 'other Groth16 neighbouring steps (per-pair medians, all profiles)', '1.01–1.12', rng(adj, 2), 'prover_boundary, rounds 1-10')
    for q, rv, nd, sc in [('structure_zkey_bytes_d11_over_d10', '51.7→101.2 MB', 1, 1e6), ('structure_zkey_bytes_d8_over_d7', '1.37→1.63 MB', 2, 1e6),
                          ('structure_constraints_or_gates_d8_over_d7', '1,998→2,241', None, None)]:
        r = pick(B, quantity=q, profile_id='all')
        a0, a1 = [int(x.split('=')[1]) for x in r['values'].split(';')]
        sv = f'{a0 / sc:.{nd}f}→{a1 / sc:.{nd}f} MB' if sc else f'{a0:,}→{a1:,}'
        add('13 structure', q.replace('structure_', ''), rv, sv, 'prover_boundary structure rows')
    # ---- diagnostic
    ratios = [float(r['median']) for r in Dg if r['quantity'] == 'paired_ratio_mem_over_path']
    add('13 diagnostic', 'median mem/path prove ratio, all 24 profile × configuration cells', '0.95–1.02', rng(ratios, 2), 'prover_diagnostic')
    rf = lambda b, ds: [float(r['median']) for r in Dg if r['quantity'] == 'zkey_readfile_ms' and r['backend'] == b and int(r['depth']) in ds]
    add('13 diagnostic', 'zkey_readfile_ms Groth16 ("about")', '1–2', rng(rf('groth16', (5, 7, 8, 15)), 0), 'prover_diagnostic (per-cell medians)')
    add('13 diagnostic', 'zkey_readfile_ms PLONK d5/d10 ("about")', '18–21', rng(rf('plonk', (5, 10)), 0), 'prover_diagnostic (per-cell medians)')
    add('13 diagnostic', 'zkey_readfile_ms PLONK d11/d15 ("about")', '37–40', rng(rf('plonk', (11, 15)), 0), 'prover_diagnostic (per-cell medians)')
    share = []
    for p in P:
        for d in (5, 10, 11, 15):
            rfm = float(pick(Dg, profile_id=p, backend='plonk', depth=d, quantity='zkey_readfile_ms')['median'])
            pm = float(pick(Dg, profile_id=p, backend='plonk', depth=d, quantity='path_prove_ms')['median'])
            share.append(100 * rfm / pm)
    add('13 diagnostic', 'readfile as % of PLONK path prove (max)', '≤0.2%', f'{max(share):.2f}%', 'prover_diagnostic',
        'match' if round(max(share), 1) <= 0.2 else '**DIFFERS**')
    # ---- verification
    rep = [('groth16', 'verify_first_median', {'cpu2': '10.9–12.7', 'cpu4': '7.0–7.9', 'cpu8': '5.9–6.4'}),
           ('plonk', 'verify_first_median', {'cpu2': '9.5–11.3', 'cpu4': '7.8–9.3', 'cpu8': '7.6–7.8'}),
           ('plonk', 'verify_steady_median', {'cpu2': '7.2–7.8', 'cpu4': '7.2–7.3', 'cpu8': '7.2–7.4'})]
    for b, col, rv in rep:
        for p in P:
            for rs in (['1-10', '1-5'] if b == 'groth16' else ['1-5']):
                vals = [float(r[col]) for r in V if r['profile_id'] == p and r['backend'] == b and r['rounds'] == rs and r['depth'] != 'all']
                note = 'prover_verify, per-depth medians, rounds ' + rs + (' (report basis; protocol cross-profile basis is 1-5)' if rs == '1-10' else '')
                add('13 verification', f'{b} {col.replace("_median", "")}, {p} (range over depths)', rv[p], rng(vals, 1), note)

    print('# Completion report vs committed derivations (CSI-PROVER-01)\n')
    print('Generated by `scripts/analysis/compare_completion_report.py` from the outputs of `scripts/analysis/derive_prover.py`.')
    print('Report values are transcribed from `J2-CSI-PROVER-01-completion-report.md`. "match" means the scripted value,')
    print('rounded to the precision printed in the report, is identical. Nothing was adjusted.\n')
    print('| Item | Statement | Report | Scripted | Basis | Status |')
    print('|---|---|---|---|---|---|')
    for r in rows:
        print('| ' + ' | '.join(r) + ' |')
    n = {s: sum(1 for r in rows if r[5] == s) for s in {r[5] for r in rows}}
    print('\nSummary: ' + ', '.join(f'{k}: {v}' for k, v in sorted(n.items())))


if __name__ == '__main__':
    main()
