#!/usr/bin/env python3
"""CSI-CHAIN-PUBLIC-01: validation and dated descriptive summaries of public-network runs (CHAIN-PUBLIC-PROTOCOL-v1
sections 13-15). Standard library only; needs no key and no network.

    derive_chain_public.py --root <out root> --out <dir> [--mode live|dry]

Validation checks the integrity of the record (schema, schedule coverage, state taxonomy, timing arithmetic, fee
arithmetic, frozen send policy, chain ids, observations, hash consistency; in live mode also the frozen public image of
every run, re-verified after the run, and the frozen endpoints). Outcomes (states, deployed-code identity,
balance-based fee consistency) are findings: they are counted and reported, never used to exclude or normalise a row.
Derived summaries are descriptive only (n, min, median, max; per session); no test, no inference. Fees are in wei of
test ether (Sepolia ETH, Era Sepolia ETH), which have no monetary value.

VP11 as amended (CHAIN-PUBLIC-PROTOCOL-v1 section 18, A1): an Era row with a receipt whose recorded receipt carries an L1
batch number is validated at once (available). A row recorded at the `included` stage, before its L2 block was sealed into
an L1 batch, has no batch number yet; that is an observed property of the live run, not a failed record: its batch check is
deferred until a post-hoc section-10 collection (FINALITY/*/finality.json, same mode, frozen Era endpoint, frozen image in
live mode) reports the transaction by hash with a present receipt and an L1 batch number (reconciled). The row itself is
never changed. VP11 passes only when no row is deferred or failed; it fails if a row has no batch number at another stage,
if a collection reports the receipt absent, or if batch numbers disagree. Per-row outcomes: era_vp11_reconciliation.csv.
Exit code: 0 every check passes; 1 a check fails; 3 no check fails but VP11 is deferred (awaiting section-10 evidence).
"""
import argparse, csv, glob, hashlib, json, os, re, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
AD = os.path.join(REPO, 'chainbench', 'adapters', 'public')
BINDING = os.path.join(REPO, 'chainbench', 'workloads', 'zcorp', 'campaigns', 'CSI-CHAIN-PUBLIC-01.json')
IMAGE_RECORD = os.path.join(AD, 'ARCHIVE.json')
IMG_FIELDS = ('image_id', 'manifest_digest', 'config_digest', 'archive_sha256', 'architecture', 'platform')


def js_list(src, name):
    m = re.search(r'const ' + name + r' = \[(.*?)\];', src, re.S)
    return re.findall(r"'([^']+)'", m.group(1))


def sha_file(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


def num(x):
    return None if x in ('', None) else float(x)


def stats(vals):
    v = sorted(x for x in vals if x is not None)
    if not v:
        return {'n': 0, 'min': '', 'median': '', 'max': ''}
    return {'n': len(v), 'min': v[0], 'median': statistics.median(v), 'max': v[-1]}


def fmt(x):
    if isinstance(x, float):
        return ('%.3f' % x).rstrip('0').rstrip('.') if x != int(x) else str(int(x))
    return '' if x is None else str(x)


def wcsv(path, rows, cols):
    with open(path, 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(cols)
        for r in rows:
            w.writerow([fmt(r.get(c, '')) for c in cols])


def image_record(path=IMAGE_RECORD):
    """The frozen public image record with its index -> manifest -> config chain verified (None if absent or broken)."""
    if not os.path.isfile(path):
        return None
    r = json.load(open(path))
    h = lambda s: 'sha256:' + hashlib.sha256(s.encode()).hexdigest()
    try:
        idx, man, cfg = json.loads(r['index_blob']), json.loads(r['manifest_blob']), json.loads(r['config_blob'])
        ok = (h(r['index_blob']) == r['image_id'] and any(m['digest'] == r['manifest_digest'] and m.get('platform', {}).get('architecture') == r['architecture'] for m in idx['manifests'])
              and h(r['manifest_blob']) == r['manifest_digest'] and man['config']['digest'] == r['config_digest'] and h(r['config_blob']) == r['config_digest']
              and cfg['architecture'] == r['architecture'])
    except (KeyError, ValueError, TypeError):
        ok = False
    return r if ok else None


def live_image_check(run, rid, rec, ledger):
    """VP12: run.json carries the wrapper-verified frozen image and the wrapper's post-flight check of the same image passed."""
    img = run.get('image') or {}
    bad = []
    if rec is None:
        bad.append('no valid frozen image record')
    else:
        bad += [k for k in IMG_FIELDS if img.get(k) != rec[k]]
    if img.get('verified_by_wrapper') != 'pass':
        bad.append('not verified by the wrapper')
    post = [e for e in ledger if e.get('phase') == 'post' and rid in (e.get('run_ids') or [])]
    if not post:
        bad.append('no post-flight image check in IMAGE-LEDGER.jsonl')
    elif not all(e.get('result') == 'pass' and e.get('image_id') == img.get('image_id') for e in post):
        bad.append('post-flight image check failed')
    return not bad, bad


def finality_admissible(fj, mode, B, rec):
    """A section-10 collection may reconcile VP11 only if it was taken in the same mode and, in live mode, through the frozen
    Era primary (or the validated secondary under a recorded deviation) in the frozen public image."""
    if fj.get('mode') != mode:
        return False, 'mode'
    if mode != 'live':
        return True, ''
    ep, ident = B.get('endpoints') or {}, fj.get('endpoint') or {}
    role = ident.get('role', '')
    exp = (ep.get('frozen') or {}).get('era-sepolia') if role == 'primary' else ((ep.get('secondary') or {}).get('era-sepolia') if role.startswith('secondary') and fj.get('deviation') else None)
    if not exp or any(ident.get(k) != exp.get(k) for k in ('label', 'host', 'url_sha256')):
        return False, 'endpoint not frozen'
    img = fj.get('image') or {}
    if rec is None or img.get('verified_by_wrapper') != 'pass' or any(img.get(k) != rec[k] for k in IMG_FIELDS):
        return False, 'image not the verified frozen image'
    return True, ''


def vp11_row(r, rid, fin_all, mode, B, rec):
    """Amendment A1: the VP11 state of one Era row with a receipt. Reads the row and the collections; changes nothing."""
    o = {'run_id': rid, 'schedule_id': r['schedule_id'], 'tx_hash': r['tx_hash'], 'recorded_l1_batch_number': r['l1_batch_number'],
         'recorded_era_details_status': r['era_details_status'], 'vp11': '', 'finality_collection': '', 'finality_l1_batch_number': '',
         'finality_receipt_now': '', 'reason': ''}
    hits, skipped = [], []
    for fp, fj in fin_all:
        adm, why = finality_admissible(fj, mode, B, rec)
        for t in fj.get('transactions') or []:
            if t.get('tx_hash') == r['tx_hash'] and t.get('run_id') == rid and t.get('schedule_id') == r['schedule_id']:
                (hits if adm else skipped).append((fj.get('collection_id') or os.path.basename(os.path.dirname(fp)), t, why))
    bns = sorted({str(t.get('l1_batch_number')) for _, t, _ in hits if t.get('receipt_now') == 'present' and str(t.get('l1_batch_number', '')) != ''})
    if r['l1_batch_number'] != '':
        bad = [b for b in bns if b != r['l1_batch_number']]
        o.update(vp11='failed' if bad else 'available', finality_l1_batch_number=';'.join(bns),
                 reason='a post-hoc collection reports another L1 batch number' if bad else 'L1 batch number in the recorded receipt')
        return o
    if r['era_details_status'] != 'included':
        o.update(vp11='failed', reason=f"no L1 batch number in the recorded receipt at stage '{r['era_details_status'] or 'unknown'}' (only the included stage defers the check)")
        return o
    absent = [c for c, t, _ in hits if t.get('receipt_now') == 'absent']
    if absent:
        o.update(vp11='failed', finality_collection=absent[-1], finality_receipt_now='absent', reason='a post-hoc collection no longer finds the receipt')
    elif len(bns) > 1:
        o.update(vp11='failed', finality_l1_batch_number=';'.join(bns), reason='post-hoc collections report different L1 batch numbers')
    elif bns:
        c, t, _ = [h for h in hits if str(h[1].get('l1_batch_number', '')) == bns[0]][-1]
        o.update(vp11='reconciled', finality_collection=c, finality_l1_batch_number=bns[0], finality_receipt_now='present',
                 reason='recorded at the included stage; L1 batch number reconciled by transaction hash from a section-10 collection')
    else:
        o.update(vp11='deferred_pending', finality_receipt_now=';'.join(sorted({t.get('receipt_now', '') for _, t, _ in hits})),
                 reason='recorded at the included stage (no L1 batch yet); awaiting a section-10 collection that reports its L1 batch'
                        + (f"; {len(skipped)} record(s) in non-admissible collections ({', '.join(sorted({w for _, _, w in skipped}))}) not used" if skipped else ''))
    return o


def live_endpoint_check(run, rr, B):
    """VP13: each network's endpoint is the frozen primary, or the validated secondary under a recorded deviation, and every
    row carries the label, host and URL sha256 of the endpoint that run used."""
    ep = B.get('endpoints') or {}
    bad = []
    for net, ident in (run.get('endpoints') or {}).items():
        role = ident.get('role', '')
        exp = (ep.get('frozen') or {}).get(net) if role == 'primary' else ((ep.get('secondary') or {}).get(net) if role.startswith('secondary') and run.get('deviation') else None)
        if not exp or any(ident.get(k) != exp.get(k) for k in ('label', 'host', 'url_sha256')):
            bad.append(f'{net}: endpoint not frozen ({role or "no role"})')
            continue
        if any((r['provider_label'], r['endpoint_host'], r['endpoint_url_sha256']) != (ident['label'], ident['host'], ident['url_sha256']) for r in rr if r['network'] == net):
            bad.append(f'{net}: a row does not carry the endpoint used')
    return not bad, bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True); ap.add_argument('--out', required=True); ap.add_argument('--mode', default='live')
    a = ap.parse_args()
    src = open(os.path.join(AD, 'lib', 'schema.js')).read()
    COLUMNS, STATES = js_list(src, 'COLUMNS'), js_list(src, 'STATES')
    B = json.load(open(BINDING))
    P = int(B['fee_policy']['sepolia']['max_priority_fee_per_gas_wei'])
    GL = B['fee_policy']['sepolia']['gas_limit']
    root = os.path.abspath(a.root)
    rec_img = image_record() if a.mode == 'live' else None
    lp = os.path.join(root, 'IMAGE-LEDGER.jsonl')
    ledger = [json.loads(l) for l in open(lp) if l.strip()] if a.mode == 'live' and os.path.isfile(lp) else []
    images = set()
    runs = sorted(d for d in glob.glob(os.path.join(root, '*')) if os.path.isfile(os.path.join(d, 'run.json')) and os.path.isfile(os.path.join(d, 'tx.csv')))
    fin_all = [(fp, json.load(open(fp))) for fp in sorted(glob.glob(os.path.join(root, 'FINALITY', '*', 'finality.json')))]
    vp11_all = []
    checks = []

    def check(name, ok, detail=None):
        checks.append({'check': name, 'pass': bool(ok), 'detail': detail})

    rows = []
    for d in runs:
        rid = os.path.basename(d)
        run = json.load(open(os.path.join(d, 'run.json')))
        with open(os.path.join(d, 'tx.csv'), newline='') as f:
            rd = csv.DictReader(f); hdr = rd.fieldnames; rr = list(rd)
        jl = [json.loads(l) for l in open(os.path.join(d, 'tx.jsonl')) if l.strip()]
        check(f'{rid}: VP1 schema (tx.csv header = schema.js COLUMNS)', hdr == COLUMNS)
        check(f'{rid}: VP1 tx.csv and tx.jsonl hold the same rows', len(jl) == len(rr) and all(str(j.get('schedule_id')) == r['schedule_id'] and str(j.get('state')) == r['state'] for j, r in zip(jl, rr)))
        sched = [o['schedule_id'] for b in run['schedule'] for o in b['ops']]
        check(f'{rid}: VP2 one row per scheduled operation, in schedule order', [r['schedule_id'] for r in rr] == sched, {'rows': len(rr), 'scheduled': len(sched)})
        check(f'{rid}: VP2 run mode = {a.mode}', run['mode'] == a.mode and all(r['mode'] == a.mode for r in rr))
        check(f'{rid}: VP3 states from the frozen taxonomy; every non-success has an error class',
              all(r['state'] in STATES for r in rr) and all(r['error_class'] for r in rr if r['state'] != 'confirmed_success')
              and all(r['error_class'] in ('', 'send_error_tx_known') for r in rr if r['state'] == 'confirmed_success'))
        tbad = []
        for r in rr:
            h = r['tx_hash'] != ''
            if r['state'].startswith('unsent'):
                if h: tbad.append((r['schedule_id'], 'unsent with hash'))
                continue
            t0, th, tr = num(r['t0_mono_ms']), num(r['t_hash_mono_ms']), num(r['t_receipt_mono_ms'])
            if not h or t0 is None: tbad.append((r['schedule_id'], 'no hash or t0')); continue
            if th is None and r['error_class'] != 'send_error_tx_known': tbad.append((r['schedule_id'], 't_hash missing'))
            if th is not None and (th < t0 or abs(num(r['send_to_hash_ms']) - (th - t0)) > 0.002): tbad.append((r['schedule_id'], 'send_to_hash'))
            if r['state'] == 'submitted_no_receipt':
                if tr is not None: tbad.append((r['schedule_id'], 'receipt time on a no-receipt row'))
                continue
            if tr is None: tbad.append((r['schedule_id'], 'no t_receipt')); continue
            if abs(num(r['request_to_receipt_ms']) - (tr - t0)) > 0.002: tbad.append((r['schedule_id'], 'request_to_receipt'))
            if th is not None and (tr < th or abs(num(r['hash_to_receipt_ms']) - (tr - th)) > 0.002): tbad.append((r['schedule_id'], 'hash_to_receipt'))
            if int(r['polls'] or 0) < 1: tbad.append((r['schedule_id'], 'polls'))
        check(f'{rid}: VP4 timing (t0 <= t_hash <= t_receipt; derived latencies = clock differences)', not tbad, tbad[:5])
        fbad = [r['schedule_id'] for r in rr if r['receipt_status'] != '' and r['effective_gas_price'] != '' and int(r['receipt_fee_wei']) != int(r['gas_used']) * int(r['effective_gas_price'])]
        check(f'{rid}: VP5 receipt fee = gasUsed x effectiveGasPrice', not fbad, fbad[:5])
        pbad = []
        for r in rr:
            if r['gas_limit'] == '':
                continue
            if r['network'] == 'sepolia':
                if not (r['tx_type'] == '2' and int(r['max_priority_fee_per_gas']) == P and int(r['max_fee_per_gas']) == 2 * int(r['prep_base_fee_per_gas']) + P and int(r['gas_limit']) == GL[r['op']]):
                    pbad.append(r['schedule_id'])
            elif not (r['tx_type'] == '113' and r['gas_limit'] == r['est_gas_limit'] and r['max_fee_per_gas'] == r['est_max_fee_per_gas']
                      and r['max_priority_fee_per_gas'] == r['est_max_priority_fee_per_gas'] and r['gas_per_pubdata_limit'] == r['est_gas_per_pubdata_limit']):
                pbad.append(r['schedule_id'])
        check(f'{rid}: VP6 frozen send policy (Sepolia: type 2, maxFee = 2*base + P, fixed limits; Era: type 113, estimate unchanged)', not pbad, pbad[:5])
        check(f'{rid}: VP7 chain ids and networks as in the binding', all(r['network'] in B['networks'] and int(r['chain_id']) == B['networks'][r['network']]['chain_id'] for r in rr))
        obad = []
        for b in run.get('blocks', []):
            p = os.path.join(d, 'observations', f"{b['block_id']}-pre.json")
            if not os.path.isfile(p): obad.append(b['block_id']); continue
            o = json.load(open(p))
            if any(r['observation_id'] != o['observation_id'] for r in rr if r['block_id'] == b['block_id'] and r['observation_id']): obad.append(b['block_id'])
        check(f'{rid}: VP8 read-only observation before every block, linked from its rows', not obad, obad)
        check(f'{rid}: VP9 RPC-returned hash = locally computed hash', all(r['tx_hash_matches'] == '1' for r in rr if r['tx_hash'] and r['tx_hash_local']))
        check(f'{rid}: VP10 signer recorded as an address only', re.fullmatch(r'0x[0-9a-fA-F]{40}', run.get('signer_address', '')) is not None
              and all(r['signer_address'] == run['signer_address'] for r in rr) and not any('key' in c.lower() and 'key_source' not in c for c in COLUMNS))
        vr = [vp11_row(r, rid, fin_all, a.mode, B, rec_img) for r in rr if r['network'] == 'era-sepolia' and r['receipt_status'] != '']
        vp11_all += vr
        st = 'fail' if any(x['vp11'] == 'failed' for x in vr) else ('deferred' if any(x['vp11'] == 'deferred_pending' for x in vr) else 'pass')
        checks.append({'check': f'{rid}: VP11 Era L1 batch number in the recorded receipt, or reconciled by transaction hash from a section-10 collection (amendment A1)',
                       'pass': {'pass': True, 'fail': False, 'deferred': None}[st], 'status': st,
                       'detail': {k: sum(1 for x in vr if x['vp11'] == k) for k in ('available', 'reconciled', 'deferred_pending', 'failed')}})
        if a.mode == 'live':
            ok, det = live_image_check(run, rid, rec_img, ledger)
            check(f'{rid}: VP12 frozen public image (index, manifest, config, archive, architecture) verified before and after the run', ok, det)
            images.add((run.get('image') or {}).get('image_id'))
            ok, det = live_endpoint_check(run, rr, B)
            check(f'{rid}: VP13 frozen endpoints (secondary only under a recorded deviation); rows carry the endpoint used', ok, det)
        for r in rr:
            r['_run'] = rid
        rows += rr
    check('VP0 at least one run', len(runs) > 0, len(runs))
    if a.mode == 'live':
        check('VP12 one frozen public image for every live run', len(images) == 1 and rec_img is not None and images == {rec_img['image_id']}, sorted(str(x) for x in images))

    # ---------------- findings and descriptive summaries (EVM and EraVM values are never compared with each other)
    os.makedirs(a.out, exist_ok=True)
    inputs = json.load(open(os.path.join(REPO, B['inputs_dir'], 'proofs', 'd11.json')))
    ref_verify = {p['proof_id']: p['controlled_reference'] for p in inputs['proofs']}
    ref_setup = inputs['controlled_reference_setup']
    ok = [r for r in rows if r['state'] == 'confirmed_success']
    OPS = ['schedule_id', '_run', 'session_id', 'phase', 'block_id', 'pair_id', 'network', 'backend', 'op', 'proof_id', 'state', 'error_class', 'tx_hash',
           'gas_used', 'effective_gas_price', 'receipt_fee_wei', 'fee_consistency_ok', 'send_to_hash_ms', 'hash_to_receipt_ms', 'request_to_receipt_ms',
           'polls', 'inclusion_block', 'inclusion_block_time_utc', 'block_at_hash', 'l1_batch_number', 'runtime_matches_artifact', 't0_utc']
    wcsv(os.path.join(a.out, 'public_ops.csv'), sorted(rows, key=lambda r: (r['t_prepare_utc'], r['schedule_id'])), OPS)
    groups = {}
    for r in rows:
        groups.setdefault((r['phase'], r['network'], r['backend'], r['op']), []).append(r)
    summ = []
    for (ph, net, be, op), g in sorted(groups.items()):
        s = [r for r in g if r['state'] == 'confirmed_success']
        row = {'phase': ph, 'network': net, 'backend': be, 'op': op, 'planned': len(g), **{st: sum(1 for r in g if r['state'] == st) for st in STATES}}
        for k in ('gas_used', 'effective_gas_price', 'receipt_fee_wei', 'send_to_hash_ms', 'hash_to_receipt_ms', 'request_to_receipt_ms'):
            st = stats([num(r[k]) for r in s])
            for q in ('min', 'median', 'max'):
                row[f'{k}_{q}'] = st[q]
        summ.append(row)
    scols = ['phase', 'network', 'backend', 'op', 'planned'] + STATES + [f'{k}_{q}' for k in ('gas_used', 'effective_gas_price', 'receipt_fee_wei', 'send_to_hash_ms', 'hash_to_receipt_ms', 'request_to_receipt_ms') for q in ('min', 'median', 'max')]
    wcsv(os.path.join(a.out, 'public_summary.csv'), summ, scols)
    sess = {}
    for r in rows:
        if r['phase'] == 'verification':
            sess.setdefault((r['session_id'], r['network'], r['backend']), []).append(r)
    srows = []
    for (sid, net, be), g in sorted(sess.items()):
        s = [r for r in g if r['state'] == 'confirmed_success']
        srows.append({'session_id': sid, 'network': net, 'backend': be, 'planned': len(g), 'confirmed_success': len(s),
                      'session_first_t0_utc': min((r['t0_utc'] for r in g if r['t0_utc']), default=''),
                      'gas_used_median': stats([num(r['gas_used']) for r in s])['median'], 'receipt_fee_wei_median': stats([num(r['receipt_fee_wei']) for r in s])['median'],
                      'effective_gas_price_median': stats([num(r['effective_gas_price']) for r in s])['median'],
                      'request_to_receipt_ms_median': stats([num(r['request_to_receipt_ms']) for r in s])['median'],
                      'request_to_receipt_ms_min': stats([num(r['request_to_receipt_ms']) for r in s])['min'], 'request_to_receipt_ms_max': stats([num(r['request_to_receipt_ms']) for r in s])['max']})
    wcsv(os.path.join(a.out, 'public_sessions.csv'), srows, list(srows[0].keys()) if srows else ['session_id'])
    gv = []
    for r in ok:
        if r['network'] != 'sepolia':
            continue
        refg = ref_verify[r['proof_id']]['l1_gas_used'] if r['op'] == 'verify_credential' else ref_setup[r['backend']][r['op']]['l1_gas_used']
        gv.append({'schedule_id': r['schedule_id'], 'backend': r['backend'], 'op': r['op'], 'proof_id': r['proof_id'], 'public_gas_used': int(r['gas_used']),
                   'controlled_l1_gas_used': refg, 'difference': int(r['gas_used']) - refg,
                   'note': 'same calldata as the controlled study' if r['op'] in ('verify_credential', 'add_root') else 'calldata contains the public signer or verifier address'})
    wcsv(os.path.join(a.out, 'public_gas_vs_controlled_l1.csv'), gv, ['schedule_id', 'backend', 'op', 'proof_id', 'public_gas_used', 'controlled_l1_gas_used', 'difference', 'note'])
    fins = sorted(glob.glob(os.path.join(root, 'FINALITY', '*', 'finality.json')))
    fin_rows = []
    if fins:
        fj = json.load(open(fins[-1]))
        for t in fj['transactions']:
            fin_rows.append({k: t[k] for k in ('schedule_id', 'op', 'backend', 'proof_id', 'row_state', 'l1_batch_number', 'batch_status', 'committed_at', 'proven_at', 'executed_at',
                                               'commit_chain_id', 'receipt_to_commit_s', 'receipt_to_prove_s', 'receipt_to_execute_s')})
    V11 = ['run_id', 'schedule_id', 'tx_hash', 'recorded_l1_batch_number', 'recorded_era_details_status', 'vp11', 'finality_collection', 'finality_l1_batch_number', 'finality_receipt_now', 'reason']
    wcsv(os.path.join(a.out, 'era_vp11_reconciliation.csv'), vp11_all, V11)
    wcsv(os.path.join(a.out, 'era_batch_lifecycle.csv'), fin_rows, ['schedule_id', 'op', 'backend', 'proof_id', 'row_state', 'l1_batch_number', 'batch_status', 'committed_at',
                                                                 'proven_at', 'executed_at', 'commit_chain_id', 'receipt_to_commit_s', 'receipt_to_prove_s', 'receipt_to_execute_s'])
    findings = {
        'rows': len(rows), 'states': {s: sum(1 for r in rows if r['state'] == s) for s in STATES},
        'deployed_code_matches_artifact': {'confirmed_deployments': sum(1 for r in ok if r['op'].startswith('deploy')), 'matches': sum(1 for r in ok if r['op'].startswith('deploy') and r['runtime_matches_artifact'] == '1')},
        'balance_fee_consistency': {'equal': sum(1 for r in rows if r['fee_consistency_ok'] == '1'), 'different': sum(1 for r in rows if r['fee_consistency_ok'] == '0'),
                                    'not_available': sum(1 for r in rows if r['receipt_status'] != '' and r['fee_consistency_ok'] == '')},
        'sepolia_gas_equal_to_controlled_l1': {'rows': len(gv), 'equal': sum(1 for x in gv if x['difference'] == 0)},
        'era_finality_collection': os.path.relpath(fins[-1], REPO) if fins else None,
        'era_l1_batch_at_recording': {'with_batch_number': sum(1 for x in vp11_all if x['recorded_l1_batch_number'] != ''),
                                      'without_batch_number_included_stage': sum(1 for x in vp11_all if x['recorded_l1_batch_number'] == '' and x['recorded_era_details_status'] == 'included'),
                                      'without_batch_number_other_stage': sum(1 for x in vp11_all if x['recorded_l1_batch_number'] == '' and x['recorded_era_details_status'] != 'included')},
        'vp11_rows': {k: sum(1 for x in vp11_all if x['vp11'] == k) for k in ('available', 'reconciled', 'deferred_pending', 'failed')},
    }
    npass, nfail, ndef = sum(1 for c in checks if c['pass'] is True), sum(1 for c in checks if c['pass'] is False), sum(1 for c in checks if c['pass'] is None)
    val = {'mode': a.mode, 'runs': [os.path.basename(d) for d in runs], 'checks': checks, 'checks_passed': npass, 'checks_deferred': ndef, 'checks_total': len(checks),
           'passed': npass == len(checks), 'status': 'FAIL' if nfail else ('DEFERRED' if ndef else 'PASS'), 'findings': findings}
    json.dump(val, open(os.path.join(a.out, 'validation.json'), 'w'), indent=2, sort_keys=True); open(os.path.join(a.out, 'validation.json'), 'a').write('\n')
    outs = {f: sha_file(os.path.join(a.out, f)) for f in sorted(os.listdir(a.out)) if f != 'derivation.json'}
    ins = {os.path.relpath(p, REPO): sha_file(p) for d in runs for p in sorted(glob.glob(os.path.join(d, '**', '*'), recursive=True)) if os.path.isfile(p)}
    json.dump({'tool': os.path.relpath(os.path.abspath(__file__), REPO), 'tool_sha256': sha_file(os.path.abspath(__file__)), 'mode': a.mode, 'inputs_sha256': ins, 'outputs_sha256': outs,
               'units': 'gas; wei of test ether (no monetary value); ms; s', 'boundary': 'descriptive, dated; no significance test; no EVM-vs-EraVM comparison; receipt latency is not finality'},
              open(os.path.join(a.out, 'derivation.json'), 'w'), indent=2, sort_keys=True)
    print(f"derive_chain_public: {len(runs)} runs, {len(rows)} rows; validation {val['checks_passed']}/{val['checks_total']} {val['status']}"
          f"{f' ({ndef} deferred: VP11 awaiting section-10 evidence)' if ndef else ''}; states {findings['states']}")
    for c in checks:
        if c['pass'] is not True:
            print(f"{'DEFERRED' if c['pass'] is None else 'FAIL'} {c['check']}: {c['detail']}", file=sys.stderr)
    sys.exit(0 if val['passed'] else (1 if nfail else 3))


if __name__ == '__main__':
    main()
