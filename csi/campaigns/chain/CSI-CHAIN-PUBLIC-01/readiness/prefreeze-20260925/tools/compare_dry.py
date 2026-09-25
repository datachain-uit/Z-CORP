#!/usr/bin/env python3
"""Compare two dry-run-public records (native vs container). Values that depend on the ephemeral key, the wall clock
or the harness commit are listed, not hidden: the output reports, per file, every column/key whose values differ and
how, so each difference can be classified.   python3 compare_dry.py NATIVE_ROOT CONTAINER_ROOT OUT.json"""
import csv, json, os, re, sys, collections
A, B, OUT = sys.argv[1:4]
TS = re.compile(r'\d{8}T\d{6}Z'); ISO = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z')
def norm_path(p): return re.sub(r'-[0-9a-f]{7}-', '-<C>-', TS.sub('<T>', p))
def files(root):
    # refusal-case run directories are named to the second, so which cases survive on disk is timing-dependent; they are
    # paired by (target, refusal code) from their run.json instead of by name
    m = {}
    for d, _, fs in os.walk(root):
        key_dir = None
        rel_d = os.path.relpath(d, root)
        if rel_d.startswith('refusals' + os.sep) and os.path.isfile(os.path.join(d, 'run.json')) and rel_d.count(os.sep) == 1:
            run = json.load(open(os.path.join(d, 'run.json')))
            key_dir = 'refusals/' + run['target'] + '-' + '+'.join(str(b.get('refusal')) for b in run.get('blocks', []))
        for f in fs:
            rel = os.path.relpath(os.path.join(d, f), root)
            m[key_dir + '/' + f if key_dir else norm_path(rel)] = rel
        if key_dir is None and rel_d.startswith('refusals' + os.sep) and rel_d.count(os.sep) >= 2:
            parent = os.path.join(root, *rel_d.split(os.sep)[:2])
            if os.path.isfile(os.path.join(parent, 'run.json')):
                run = json.load(open(os.path.join(parent, 'run.json')))
                kd = 'refusals/' + run['target'] + '-' + '+'.join(str(b.get('refusal')) for b in run.get('blocks', []))
                for f in fs:
                    rel = os.path.relpath(os.path.join(d, f), root)
                    m.pop(norm_path(rel), None); m[kd + '/' + os.sep.join(rel_d.split(os.sep)[2:]) + '/' + f] = rel
    return m
FA, FB = files(A), files(B)
R = {'native_root': A, 'container_root': B, 'files_native': len(FA), 'files_container': len(FB),
     'only_native': sorted(set(FA) - set(FB)), 'only_container': sorted(set(FB) - set(FA)), 'files': {}}
def classify(v):
    if v is None or v == '': return 'empty'
    s = str(v)
    if ISO.fullmatch(s): return 'iso-time'
    if re.fullmatch(r'0x[0-9a-fA-F]{40}', s): return 'address'
    if re.fullmatch(r'(0x)?[0-9a-fA-F]{64}', s): return 'hash32'
    if re.fullmatch(r'-?\d+(\.\d+)?', s): return 'number'
    return 'text'
def cmp_csv(pa, pb):
    ra = list(csv.DictReader(open(pa))); rb = list(csv.DictReader(open(pb)))
    ha = open(pa).readline().strip(); hb = open(pb).readline().strip()
    out = {'header_equal': ha == hb, 'rows_native': len(ra), 'rows_container': len(rb), 'differing_columns': {}}
    for i, (x, y) in enumerate(zip(ra, rb)):
        for k in x:
            if x.get(k) != y.get(k):
                d = out['differing_columns'].setdefault(k, {'rows': 0, 'kinds': collections.Counter(), 'example': None})
                d['rows'] += 1; d['kinds'][f'{classify(x.get(k))}->{classify(y.get(k))}'] += 1
                if d['example'] is None: d['example'] = [str(x.get(k))[:90], str(y.get(k))[:90], {kk: x.get(kk) for kk in ('op', 'backend', 'proof_id', 'state', 'check', 'network') if kk in x}]
    for d in out['differing_columns'].values(): d['kinds'] = dict(d['kinds'])
    return out
def flat(o, pre=''):
    if isinstance(o, dict):
        for k, v in o.items(): yield from flat(v, f'{pre}.{k}' if pre else k)
    elif isinstance(o, list):
        for i, v in enumerate(o): yield from flat(v, f'{pre}[{i}]')
    else: yield pre, o
def keypat(k): return re.sub(r'\[\d+\]', '[]', k)
def cmp_json(pa, pb, jsonl=False):
    if jsonl:
        la = [json.loads(l) for l in open(pa) if l.strip()]; lb = [json.loads(l) for l in open(pb) if l.strip()]
        a, b = {'lines': la}, {'lines': lb}
    else: a, b = json.load(open(pa)), json.load(open(pb))
    fa, fb = dict(flat(a)), dict(flat(b))
    out = {'keys_only_native': sorted({keypat(k) for k in set(fa) - set(fb)})[:20], 'keys_only_container': sorted({keypat(k) for k in set(fb) - set(fa)})[:20], 'differing_keys': {}}
    for k in set(fa) & set(fb):
        if fa[k] != fb[k]:
            p = keypat(k); d = out['differing_keys'].setdefault(p, {'n': 0, 'kinds': collections.Counter(), 'example': None})
            d['n'] += 1; d['kinds'][f'{classify(fa[k])}->{classify(fb[k])}'] += 1
            if d['example'] is None: d['example'] = [str(fa[k])[:90], str(fb[k])[:90]]
    for d in out['differing_keys'].values(): d['kinds'] = dict(d['kinds'])
    return out
for k in sorted(set(FA) & set(FB)):
    pa, pb = os.path.join(A, FA[k]), os.path.join(B, FB[k])
    try:
        if k.endswith('.csv'): R['files'][k] = cmp_csv(pa, pb)
        elif k.endswith('.jsonl'): R['files'][k] = cmp_json(pa, pb, True)
        elif k.endswith('.json'): R['files'][k] = cmp_json(pa, pb)
    except Exception as e: R['files'][k] = {'error': repr(e)}
# summary by column/key pattern across all files
agg = collections.defaultdict(lambda: {'files': 0, 'kinds': collections.Counter(), 'example': None})
for f, r in R['files'].items():
    for col, d in list(r.get('differing_columns', {}).items()) + list(r.get('differing_keys', {}).items()):
        g = agg[(f.split('/')[-1], col)]; g['files'] += 1; g['kinds'].update(d['kinds'])
        if g['example'] is None: g['example'] = d['example']
R['aggregate'] = [{'file': f, 'field': c, 'files': g['files'], 'kinds': dict(g['kinds']), 'example': g['example']} for (f, c), g in sorted(agg.items())]
# structural equality: headers, row counts, key sets
R['structural'] = {'csv_headers_equal': all(r.get('header_equal', True) for r in R['files'].values()),
                   'csv_row_counts_equal': all(r.get('rows_native') == r.get('rows_container') for r in R['files'].values() if 'rows_native' in r),
                   'json_key_sets_equal': all(not r.get('keys_only_native') and not r.get('keys_only_container') for r in R['files'].values() if 'differing_keys' in r),
                   'file_sets_equal': not R['only_native'] and not R['only_container']}
json.dump(R, open(OUT, 'w'), indent=1, default=str)
print(json.dumps(R['structural']), 'files', R['files_native'], R['files_container'], 'aggregate fields', len(R['aggregate']))
