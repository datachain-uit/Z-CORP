#!/usr/bin/env python3
"""Per-cell summary of a local-EraVM run (EraVM units only; never comparable with EVM gas) and the compile-size table.
Usage: summarize_l2.py <run dir> --out <summary.csv> [--sizes <compile_sizes.csv>]"""
import csv, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from l2common import load_run
run_dir = sys.argv[1]
out = sys.argv[sys.argv.index('--out') + 1]
sizes = sys.argv[sys.argv.index('--sizes') + 1] if '--sizes' in sys.argv else None
rows, _, run = load_run(run_dir)
groups = {}
for r in rows:
    if r['kind'] != 'tx':
        continue
    groups.setdefault((r['cell_id'], r['backend'], r['depth'], r['op']), []).append(r)
cols = ['cell_id', 'backend', 'depth', 'op', 'n', 'status', 'computational_gas_min', 'computational_gas_max', 'pubdata_bytes_min', 'pubdata_bytes_max',
        'gas_used_min', 'gas_used_max', 'calldata_bytes', 'bytecode_bytes']
with open(out, 'w', newline='') as f:
    w = csv.writer(f, lineterminator='\n'); w.writerow(cols)
    for (cid, b, d, op), g in groups.items():
        num = lambda c: [int(x[c]) for x in g]
        w.writerow([cid, b, d, op, len(g), '/'.join(sorted({x['status'] for x in g})), min(num('computational_gas')), max(num('computational_gas')),
                    min(num('pubdata_bytes')), max(num('pubdata_bytes')), min(num('gas_used')), max(num('gas_used')),
                    '/'.join(sorted({x['calldata_bytes'] for x in g})), '/'.join(sorted({x['bytecode_bytes'] for x in g if x['bytecode_bytes']}))])
print(f'summary: {out} ({len(groups)} groups from {run["run_id"]})')
if sizes:
    bm = json.load(open(os.path.join(run_dir, 'build_manifest.eravm.json')))
    with open(sizes, 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n'); w.writerow(['source', 'contract', 'bytecode_bytes', 'bytecode_words', 'bytecode_hash', 'bytecode_sha256'])
        for c in bm['contracts'].values():
            w.writerow([c['source'], c['name'], c['bytecode_bytes'], c['bytecode_words'], c['bytecode_hash'], c['bytecode_sha256']])
    print(f'compile sizes: {sizes} ({len(bm["contracts"])} contracts)')
