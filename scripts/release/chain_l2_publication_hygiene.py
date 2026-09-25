#!/usr/bin/env python3
"""Publication hygiene of CSI-CHAIN-LOCAL-01-L2 (post-acceptance; not a measurement step; no rerun).

Two provenance layers of the accepted local-EraVM campaign full-l2-e97b69f-20260925T132901Z:
  acquisition raw       the exact files the accepted campaign emitted (70 files); kept as a deterministic archive that
                        is not versioned and not distributed through git, because 18 anvil-zksync start-up logs display the
                        standard public development credentials of the local node; recorded (hashes only) in
                        csi/campaigns/chain/CSI-CHAIN-LOCAL-01-L2/ACQUISITION-RAW.json
  public artifact raw   the tracked results/chain-local-l2-20260925/: scientifically identical; only the documented
                        banner lines were replaced by scripts/release/sanitize_chain_l2_devcreds.py; frozen by SOURCE.sha256;
                        the source of every public reproduction script

    chain_l2_publication_hygiene.py acquire              archive the current (acquisition) source; write ACQUISITION-RAW.json
    chain_l2_publication_hygiene.py snapshot --out DIR   rerun parsing, validation and derivation on the tracked source (outputs to DIR)
    chain_l2_publication_hygiene.py compare --pre DIR --post DIR   scientific-neutrality proof -> NEUTRALITY.json (exit 1 on any difference)
    chain_l2_publication_hygiene.py restore              put the acquisition raw back from its archive (hash-verified)
    chain_l2_publication_hygiene.py record               public SOURCE.sha256, campaign.json provenance_layers, VALIDATION.md
Deterministic; standard library (plus node for the adapter's own fee-trace parser in `snapshot`); prints no credential value.
"""
import argparse, csv, hashlib, io, json, os, re, subprocess, sys, tarfile, tempfile

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'scripts', 'release'))
import build_csi_bundle as BB  # noqa: E402  (source_manifest, det_tar: one definition of the frozen manifest and tar format)

ADMIN = 'CSI-CHAIN-LOCAL-01-L2'
CID = 'full-l2-e97b69f-20260925T132901Z'
SRC = 'results/chain-local-l2-20260925'
EV = f'csi/campaigns/chain/{ADMIN}'
TAG = 'chain-l2-baseline-20260925'
ACQ_TAR = f'csi/release/{ADMIN}-acquisition/acquisition-raw-{CID}.tar'
REL_TAR = f'csi/release/{ADMIN}/campaign-{CID}.tar'
ACQ_JSON, SAN_JSON, NEU_JSON = f'{EV}/ACQUISITION-RAW.json', f'{EV}/SANITATION.json', f'{EV}/NEUTRALITY.json'
SANITIZER = 'scripts/release/sanitize_chain_l2_devcreds.py'
ADAPTER = 'chainbench/adapters/eravm'
PS01 = 'csi/campaigns/chain/CSI-CHAIN-LOCAL-01/inputs/proofset'
PROTO = 'csi/protocols/chain/CHAIN-PROTOCOL-v1.md'
DERIVED_SCIENTIFIC = ['l2_backend_comparison.csv', 'l2_cells.csv', 'l2_compile_sizes.csv', 'l2_negatives.csv', 'l2_ops.csv',
                      'l2_proofs.csv', 'l2_ranges.csv', 'values.tex']


def P(rel): return os.path.join(REPO, rel)
def sha(b): return hashlib.sha256(b).hexdigest()
def shaf(p): return sha(open(p, 'rb').read())
def jdump(o): return json.dumps(o, indent=2, sort_keys=True) + '\n'
def die(m): sys.exit(f'chain_l2_publication_hygiene: REFUSED: {m}')
def git(*a): return subprocess.run(['git', '-C', REPO, *a], capture_output=True, text=True, check=True).stdout.strip()


def inventory():
    files = []
    for ln in BB.source_manifest(SRC).decode().splitlines():
        h, rel = ln.split('  ', 1)
        files.append({'path': rel, 'sha256': h, 'bytes': os.path.getsize(P(rel))})
    return files


def acquire(a):
    man = BB.source_manifest(SRC)
    sm = P(f'{EV}/SOURCE.sha256')
    if open(sm, 'rb').read() != man:
        die(f'{SRC} does not match {EV}/SOURCE.sha256 as accepted; the acquisition raw cannot be recorded from it')
    files = inventory()
    os.makedirs(os.path.dirname(P(ACQ_TAR)), exist_ok=True)
    tmp = os.path.join(tempfile.mkdtemp(prefix='l2-acq-'), 'acquisition.tar')
    BB.det_tar(tmp, SRC)
    tar_sha = shaf(tmp)
    if os.path.exists(P(ACQ_TAR)) and shaf(P(ACQ_TAR)) != tar_sha:
        die(f'{ACQ_TAR} exists with different content; the acquisition archive is immutable')
    if not os.path.exists(P(ACQ_TAR)):
        with open(tmp, 'rb') as s, open(P(ACQ_TAR), 'wb') as d:
            d.write(s.read())
    os.remove(tmp)
    with tarfile.open(P(ACQ_TAR)) as t:
        members = [(m.name, m.size) for m in t.getmembers()]
    if [m[0] for m in members] != sorted(f['path'] for f in files) or len(members) != len(files):
        die('archive members differ from the source manifest')
    prev = P(REL_TAR)
    prev_sha = shaf(prev) if os.path.exists(prev) else None
    rec = {'admin_id': ADMIN, 'campaign_id': CID, 'layer': 'acquisition raw',
           'definition': ('the exact files emitted by the accepted scientific campaign (runs a and b, pre-flight and post-flight records, '
                          'console log), moved byte-identically from build/campaigns/chain-l2/ to the tracked source path and accepted '
                          '(V1-V13, 82/82 derivation checks) before publication hygiene'),
           'baseline_tag': TAG, 'baseline_commit': git('rev-parse', f'{TAG}^{{commit}}'), 'source_path': SRC,
           'manifest': {'format': "sha256sum lines '<sha256>  <repo-relative path>', sorted by path (the SOURCE.sha256 of the accepted record)",
                        'files': len(files), 'bytes': sum(f['bytes'] for f in files), 'aggregate_sha256': sha(man),
                        'aggregate_rule': 'sha256 of the manifest bytes'},
           'files': files,
           'archive': {'file': ACQ_TAR, 'sha256': shaf(P(ACQ_TAR)), 'bytes': os.path.getsize(P(ACQ_TAR)), 'members': len(members),
                       'format': 'deterministic USTAR: sorted repo-relative paths, mtime 0, mode 0644, uid/gid 0 (build_csi_bundle.det_tar)',
                       'identical_to_first_release_campaign_tar': prev_sha == shaf(P(ACQ_TAR)) if prev_sha else None,
                       'first_release_campaign_tar_sha256': prev_sha,
                       'versioned': False, 'distributed_through_git': False,
                       'reason': ('18 anvil-zksync start-up logs (anvil.stdout) display the standard public development credentials of the '
                                  'local node (the two account private keys and the mnemonic of its banner); see SANITATION.json')},
           'contains_credential_values': False,
           'note': 'metadata and sha256 only; the scientific baseline tag is unchanged'}
    if os.path.exists(P(ACQ_JSON)):
        old = json.load(open(P(ACQ_JSON)))
        if old != rec:
            die(f'{ACQ_JSON} exists and differs from the current acquisition raw')
    open(P(ACQ_JSON), 'w').write(jdump(rec))
    print(f'acquisition raw: {len(files)} files, aggregate {sha(man)[:16]}..., archive {ACQ_TAR} sha256 {rec["archive"]["sha256"]}')


def restore(a):
    rec = json.load(open(P(ACQ_JSON)))
    if shaf(P(rec['archive']['file'])) != rec['archive']['sha256']:
        die('acquisition archive hash mismatch')
    want = {f['path']: f['sha256'] for f in rec['files']}
    with tarfile.open(P(rec['archive']['file'])) as t:
        for m in t.getmembers():
            data = t.extractfile(m).read()
            if sha(data) != want[m.name]:
                die(f'archive member {m.name} does not match the acquisition manifest')
            if not os.path.exists(P(m.name)) or shaf(P(m.name)) != want[m.name]:
                open(P(m.name), 'wb').write(data)
                print(f'restored {m.name}')
    if sha(BB.source_manifest(SRC)) != rec['manifest']['aggregate_sha256']:
        die('restore incomplete: source manifest != acquisition manifest')
    print('acquisition raw restored and verified')


# ---- snapshot: rerun parsing, validation and derivation on the tracked source -------------------------------------------
FEE_JS = r"""
const A = require(process.argv[1]); const fs = require('fs'); const out = {};
for (const f of process.argv.slice(2)) {
  const o = {}; for (const [h, rs] of [...A.parseFeeTrace(fs.readFileSync(f, 'utf8')).entries()].sort()) o[h] = rs; out[f] = o;
}
process.stdout.write(JSON.stringify(out));
"""


def run(cmd, what):
    r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    return r.returncode, (r.stdout.strip().splitlines() or [''])[-1], r.stderr.strip()


def snapshot(a):
    out = os.path.abspath(a.out)
    if os.path.commonpath([out, REPO]) == REPO:
        die('snapshot outputs must be written outside the repository')
    os.makedirs(os.path.join(out, 'derived'), exist_ok=True)
    sys.path.insert(0, P(f'{ADAPTER}/scripts'))
    from l2common import constants, derived_gas_used, load_run
    K = constants()
    tag_commit = git('rev-parse', f'{TAG}^{{commit}}')
    arc = json.loads(git('show', f'{tag_commit}:{ADAPTER}/ARCHIVE.json'))
    proto_sha = sha(subprocess.run(['git', '-C', REPO, 'show', f'{tag_commit}:{PROTO}'], capture_output=True, check=True).stdout)
    D = {k: f'{SRC}/{CID}-{k}' for k in ('a', 'b')}
    snap = {'files': inventory()}
    # derivation (the committed derive_chain_l2.py, with the identity expectations of build_csi_bundle.py)
    rc, last, err = run([sys.executable, P('scripts/analysis/derive_chain_l2.py'), '--campaign', P(SRC), '--out', os.path.join(out, 'derived'),
                         '--repo', REPO, '--plan', 'full', '--expect-campaign-id', CID, '--expect-commit', tag_commit, '--expect-tag', TAG,
                         '--expect-image-id', arc['image_id'], '--expect-protocol-sha256', proto_sha], 'derive')
    dd = os.path.join(out, 'derived')
    val = json.load(open(os.path.join(dd, 'validation.json'))) if rc == 0 else {}
    snap['derive'] = {'returncode': rc, 'stderr': err[-400:], 'outputs_sha256': {f: shaf(os.path.join(dd, f)) for f in sorted(os.listdir(dd))},
                      'checks_passed': sum(1 for c in val.get('checks', {}).values() if c['pass']), 'checks': len(val.get('checks', {})),
                      'passed': val.get('passed'),
                      'determinism_comparisons': (val.get('checks', {}).get('determinism_rows_identical') or {}).get('comparisons'),
                      'csv_rows': {f: sum(1 for _ in csv.DictReader(open(os.path.join(dd, f), newline=''))) for f in sorted(os.listdir(dd)) if f.endswith('.csv')}}
    # runner-independent validator (V1-V13) and determinism comparison of the adapter
    snap['validate'] = {}
    for k, d in D.items():
        o = os.path.join(out, f'validate_{k}.json')
        rc, last, err = run([sys.executable, P(f'{ADAPTER}/scripts/validate_l2.py'), d, '--out', o], 'validate')
        v = json.load(open(o))
        snap['validate'][k] = {'returncode': rc, 'summary': last, 'pass': v['pass'], 'rules': v['rules'], 'counts': v['counts'], 'sha256': shaf(o)}
    o = os.path.join(out, 'compare.json')
    rc, last, err = run([sys.executable, P(f'{ADAPTER}/scripts/compare_l2.py'), '--a', D['a'], '--b', D['b'], '--out', o], 'compare')
    snap['compare'] = {'returncode': rc, 'summary': last, 'sha256': shaf(o)}
    # fee accounting re-parsed from the node logs with the adapter's own parser (anvil.js parseFeeTrace)
    logs = []
    for k, d in D.items():
        for c in sorted(os.listdir(P(f'{d}/nodes'))):
            logs += [f'{d}/nodes/{c}/anvil.log', f'{d}/nodes/{c}/anvil.stdout']
        logs += [f'{d}/envcheck/anvil.log', f'{d}/envcheck/anvil.stdout']
    r = subprocess.run(['node', '-e', FEE_JS, P(f'{ADAPTER}/lib/anvil.js'), *logs], cwd=REPO, capture_output=True, text=True)
    if r.returncode:
        die(f'fee-trace parser failed: {r.stderr.strip()[-300:]}')
    traces = json.loads(r.stdout)
    fee = {'records_sha256': sha(json.dumps(traces, sort_keys=True).encode()), 'records_per_file': {f: sum(len(v) for v in traces[f].values()) for f in logs}}
    stats = {}
    for k, d in D.items():
        rows, header, runj = load_run(P(d))
        tx = [x for x in rows if x['kind'] == 'tx']
        match = one = 0
        for x in tx:
            recs = traces[f"{d}/nodes/{x['cell_id']}/anvil.log"].get(x['tx_hash'], [])
            one += len(recs) == 1
            match += len(recs) == 1 and all(str(recs[0][f]) == x[f] for f in ('fee_trace_gas_limit', 'computational_gas', 'pubdata_gas', 'pubdata_bytes'))
        same = all(traces[f"{d}/nodes/{c}/anvil.log"] == traces[f"{d}/nodes/{c}/anvil.stdout"] for c in os.listdir(P(f'{d}/nodes')))
        recon = sum(derived_gas_used(int(x['gas_limit']), int(x['computational_gas']), int(x['pubdata_bytes']), K) == int(x['gas_used']) for x in tx)
        stats[k] = {'rows': len(rows), 'tx': len(tx), 'calls': sum(x['kind'] == 'call' for x in rows), 'check_pass': sum(x['check_pass'] == '1' for x in rows),
                    'fee_records_exactly_one': one, 'fee_records_equal_csv': match, 'stdout_trace_equals_log_trace': same,
                    'receipt_gas_reconstructed': recon, 'header': header}
    ra, _, _ = load_run(P(D['a'])); rb, hb, _ = load_run(P(D['b']))
    A = {(x['cell_id'], int(x['op_seq'])): x for x in ra}; B = {(x['cell_id'], int(x['op_seq'])): x for x in rb}
    fields = [f for f in hb if f != 'run_id']
    comps = diffs = 0
    for key in sorted(set(A) | set(B)):
        for f in fields:
            comps += 1
            diffs += A.get(key, {}).get(f) != B.get(key, {}).get(f)
    stats['determinism'] = {'field_comparisons': comps, 'identical': comps - diffs, 'differences': diffs, 'excluded': ['run_id']}
    snap['fee_trace'] = fee
    snap['stats'] = stats
    # identities (proof set, bytecode, contracts, image, protocol, baseline)
    ident = {'baseline_tag_object': git('rev-parse', TAG), 'baseline_commit': tag_commit, 'protocol_sha256_at_tag': proto_sha,
             'protocol_sha256_worktree': shaf(P(PROTO)), 'archive_record_at_tag': {k: arc[k] for k in ('image_id', 'archive_sha256', 'platform')},
             'contracts_tree': git('rev-parse', 'HEAD:contracts'), 'contracts_worktree_clean': subprocess.run(['git', '-C', REPO, 'diff', '--quiet', 'HEAD', '--', 'contracts']).returncode == 0,
             'proofset': {f: shaf(P(f'{PS01}/{f}')) for f in ('PROOFSET.csv', 'PROOFSET.json', 'PROOFSET.sha256')}}
    img = P(f'csi/release/{ADMIN}/image/chainbench-l2-arm64.oci.tar')
    ident['image_archive_sha256'] = shaf(img) if os.path.exists(img) else None
    for k, d in D.items():
        rj = json.load(open(P(f'{d}/run.json'))); ej = json.load(open(P(f'{d}/environment.json'))); bm = json.load(open(P(f'{d}/build_manifest.eravm.json')))
        ident[f'run_{k}'] = {'commit': rj['commit'], 'protocol_sha256': rj['protocol_sha256'], 'proofset_manifest': rj.get('proofset_manifest'),
                             'campaign_id': rj.get('campaign_id'), 'arm': rj.get('arm'), 'build_output_sha256': rj.get('build_output_sha256'),
                             'image_id': ej['container']['image_id'], 'toolchain_sha256': {t: ej['toolchain'][t].get('sha256') for t in ('anvil_zksync', 'zksolc', 'era_solc')},
                             'build_manifest_sha256': shaf(P(f'{d}/build_manifest.eravm.json')),
                             'bytecode_hashes': {c['name']: c['bytecode_hash'] for c in bm['contracts'].values()}}
    snap['identities'] = ident
    open(os.path.join(out, 'snapshot.json'), 'w').write(jdump(snap))
    print(f"snapshot: {len(snap['files'])} files; derive rc {snap['derive']['returncode']} ({snap['derive']['checks_passed']}/{snap['derive']['checks']}); "
          f"validate {snap['validate']['a']['summary']} / {snap['validate']['b']['summary']}; compare rc {snap['compare']['returncode']}; "
          f"determinism {stats['determinism']['identical']}/{stats['determinism']['field_comparisons']}; "
          f"receipts {stats['a']['receipt_gas_reconstructed']}/{stats['a']['tx']}, {stats['b']['receipt_gas_reconstructed']}/{stats['b']['tx']}")


# ---- compare: scientific-neutrality proof ------------------------------------------------------------------------------------
def compare(a):
    import sanitize_chain_l2_devcreds as S
    pre = json.load(open(os.path.join(a.pre, 'snapshot.json'))); post = json.load(open(os.path.join(a.post, 'snapshot.json')))
    acq = json.load(open(P(ACQ_JSON)))
    req = []
    def need(name, ok, detail=None): req.append({'requirement': name, 'pass': bool(ok), **({'detail': detail} if detail is not None else {})})
    pf = {f['path']: f['sha256'] for f in pre['files']}; qf = {f['path']: f['sha256'] for f in post['files']}
    af = {f['path']: f['sha256'] for f in acq['files']}
    need('pre-sanitation source = acquisition raw (70-file manifest)', pf == af, f"{len(pf)} files")
    need('raw file count unchanged', len(pf) == len(qf) == acq['manifest']['files'], f'{len(pf)} -> {len(qf)}')
    need('raw path set unchanged', set(pf) == set(qf))
    changed = sorted(p for p in pf if pf[p] != qf.get(p))
    need('only the allowlisted anvil-zksync start-up logs differ', changed == sorted(S.ALLOW), f'{len(changed)} files changed')
    lines = {}
    with tarfile.open(P(acq['archive']['file'])) as t:
        for p in changed:
            old = t.extractfile(p).read().decode('utf-8').split('\n'); new = open(P(p), encoding='utf-8').read().split('\n')
            dl = [i + 1 for i, (x, y) in enumerate(zip(old, new)) if x != y] if len(old) == len(new) else None
            lines[p] = {'lines_before': len(old), 'lines_after': len(new), 'differing_lines': dl,
                        'all_differing_lines_are_the_marker': dl is not None and all(new[i - 1] == S.MARKER for i in dl)}
    need('in each changed file only the documented banner lines differ (same line count; lines 25, 26, 32 -> marker)',
         all(v['differing_lines'] == S.BANNER_LINES and v['all_differing_lines_are_the_marker'] for v in lines.values()),
         {'banner_lines': S.BANNER_LINES, 'marker': S.MARKER})
    need('no file read by a scientific script changed (derive_chain_l2.py, validate_l2.py, compare_l2.py read run.json, environment.json, '
         'env_check.json, build_manifest.eravm.json, local_l2_ops.csv, validation.json, compare_determinism.json, pre/post-flight; the fee '
         'trace is parsed from anvil.log)', all(os.path.basename(p) == 'anvil.stdout' for p in changed))
    ps, qs = pre['stats'], post['stats']
    for k in ('a', 'b'):
        need(f'run {k}: row counts unchanged (rows, tx, calls)', (ps[k]['rows'], ps[k]['tx'], ps[k]['calls']) == (qs[k]['rows'], qs[k]['tx'], qs[k]['calls']) == (288, 200, 88),
             {'rows': qs[k]['rows'], 'tx': qs[k]['tx'], 'calls': qs[k]['calls']})
        need(f'run {k}: V1-V13 pass (validate_l2.py)', pre['validate'][k]['pass'] and post['validate'][k]['pass'] and post['validate'][k]['returncode'] == 0,
             post['validate'][k]['summary'])
        need(f'run {k}: validate_l2.py output byte-identical', pre['validate'][k]['sha256'] == post['validate'][k]['sha256'])
        need(f'run {k}: receipt gasUsed reconstructed exactly', ps[k]['receipt_gas_reconstructed'] == qs[k]['receipt_gas_reconstructed'] == qs[k]['tx'] == 200,
             f"{qs[k]['receipt_gas_reconstructed']}/{qs[k]['tx']}")
        need(f'run {k}: fee trace re-parsed from anvil.log: exactly one record per tx, equal to the CSV',
             ps[k]['fee_records_equal_csv'] == qs[k]['fee_records_equal_csv'] == qs[k]['fee_records_exactly_one'] == 200, f"{qs[k]['fee_records_equal_csv']}/200")
        need(f'run {k}: check_pass rows unchanged', ps[k]['check_pass'] == qs[k]['check_pass'] == 288, f"{qs[k]['check_pass']}/288")
    need('fee-trace records of every node log identical (adapter parser)', pre['fee_trace'] == post['fee_trace'], post['fee_trace']['records_sha256'])
    d0, d1 = ps['determinism'], qs['determinism']
    need('determinism run a = run b (except run_id)', d0 == d1 and d1['differences'] == 0 and d1['field_comparisons'] == 15840,
         f"{d1['identical']}/{d1['field_comparisons']}")
    need('compare_l2.py output byte-identical and passing', pre['compare']['sha256'] == post['compare']['sha256'] and post['compare']['returncode'] == 0, post['compare']['summary'])
    need('derivation passes 82/82', post['derive']['returncode'] == 0 and post['derive']['passed'] is True and post['derive']['checks_passed'] == post['derive']['checks'] == 82,
         f"{post['derive']['checks_passed']}/{post['derive']['checks']}")
    need('derivation determinism comparisons unchanged', pre['derive']['determinism_comparisons'] == post['derive']['determinism_comparisons'] == 15840)
    po, qo = pre['derive']['outputs_sha256'], post['derive']['outputs_sha256']
    need('same derived file set', sorted(po) == sorted(qo), sorted(qo))
    for f in DERIVED_SCIENTIFIC:
        need(f'derived {f} byte-identical', po.get(f) is not None and po.get(f) == qo.get(f), qo.get(f))
    need('derived validation.json byte-identical', po.get('validation.json') == qo.get('validation.json'), qo.get('validation.json'))
    dp = json.load(open(os.path.join(a.pre, 'derived', 'derivation.json'))); dq = json.load(open(os.path.join(a.post, 'derived', 'derivation.json')))
    ip, iq = dp.pop('inputs_sha256'), dq.pop('inputs_sha256')
    diff_in = sorted(k for k in set(ip) | set(iq) if ip.get(k) != iq.get(k))
    need('derived derivation.json: identical except its input fingerprint (inputs_sha256) of exactly the sanitised files, which now '
         'records the public-source hashes (derivation identity rebuilt; outputs_sha256, checks, identities and rules unchanged)',
         dp == dq and diff_in == sorted(S.ALLOW) and all(ip[k] == af[k] and iq[k] == qf[k] for k in diff_in),
         {'fields_other_than_inputs_identical': dp == dq, 'inputs_changed': len(diff_in), 'inputs_total': len(iq)})
    need('derived CSV row counts unchanged', pre['derive']['csv_rows'] == post['derive']['csv_rows'], post['derive']['csv_rows'])
    committed = {f: shaf(P(f'{EV}/derived/{f}')) for f in DERIVED_SCIENTIFIC + ['validation.json']}
    need('derived scientific outputs and validation.json = the committed validated derived/ record', committed == {f: qo.get(f) for f in committed})
    need('proof, bytecode, contract, image, protocol and baseline identities unchanged', pre['identities'] == post['identities'],
         {'baseline_commit': post['identities']['baseline_commit'], 'protocol_sha256_at_tag': post['identities']['protocol_sha256_at_tag'],
          'image_id': post['identities']['archive_record_at_tag']['image_id'], 'image_archive_sha256': post['identities']['image_archive_sha256'],
          'proofset': post['identities']['proofset']})
    def sci(s):
        x = json.loads(json.dumps({k: v for k, v in s.items() if k != 'files'}))
        x['derive']['outputs_sha256'].pop('derivation.json', None)
        return sha(json.dumps(x, sort_keys=True).encode())
    need('complete scientific snapshot identical (everything except the raw file inventory and the derivation input fingerprint)',
         sci(pre) == sci(post), sci(post))
    rec = {'admin_id': ADMIN, 'campaign_id': CID, 'purpose': 'proof that publication hygiene (SANITATION.json) is scientifically neutral',
           'pre': 'acquisition raw (tracked source before sanitation; = ACQUISITION-RAW.json)', 'post': 'public artifact raw (tracked source after sanitation)',
           'method': ('chain_l2_publication_hygiene.py snapshot on each state: derive_chain_l2.py --plan full with the build_csi_bundle.py identity '
                      'expectations, validate_l2.py (runs a, b), compare_l2.py, the adapter fee-trace parser (anvil.js parseFeeTrace) on every node log, '
                      'receipt gasUsed reconstruction, a/b field comparison, identities; nothing normalised or excluded'),
           'changed_files': {p: lines[p] for p in changed}, 'requirements': req}
    rec['passed'] = all(r['pass'] for r in req)
    open(P(NEU_JSON), 'w').write(jdump(rec))
    for r in req:
        if not r['pass']:
            print(f"FAIL: {r['requirement']}: {r.get('detail')}")
    print(f"neutrality: {sum(r['pass'] for r in req)}/{len(req)} requirements pass -> {NEU_JSON}")
    sys.exit(0 if rec['passed'] else 1)


# ---- record: public source manifest and the two provenance layers ------------------------------------------------------------
LAYER_HEAD = '## Provenance layers (publication hygiene, after acceptance)'


def record(a):
    acq = json.load(open(P(ACQ_JSON))); san = json.load(open(P(SAN_JSON))); neu = json.load(open(P(NEU_JSON)))
    if neu.get('passed') is not True:
        die('NEUTRALITY.json did not pass')
    r = subprocess.run([sys.executable, P(SANITIZER), '--check'], cwd=REPO, capture_output=True, text=True)
    if r.returncode:
        die(f'sanitizer --check failed: {r.stdout.strip()[-300:]} {r.stderr.strip()[-300:]}')
    man = BB.source_manifest(SRC)
    pub = {ln.split('  ', 1)[1]: ln.split('  ', 1)[0] for ln in man.decode().splitlines()}
    af = {f['path']: f['sha256'] for f in acq['files']}
    sf = {f['path']: f['sha256_after'] for f in san['files']}
    if set(pub) != set(af) or any(pub[p] != (sf[p] if p in sf else af[p]) for p in pub):
        die('public source != acquisition raw with the recorded sanitation applied')
    open(P(f'{EV}/SOURCE.sha256'), 'wb').write(man)
    cj = json.load(open(P(f'{EV}/campaign.json'))); sr = cj['scientific_run']
    sr['produced_at'] = ('build/campaigns/chain-l2/ (protocol 16.5); moved byte-identically to the tracked source_path and accepted there as the '
                         'acquisition raw (ACQUISITION-RAW.json); after acceptance, publication hygiene replaced only the documented development-'
                         'credential banner lines (SANITATION.json); the tracked source_path is the public artifact raw, frozen by SOURCE.sha256')
    sr['derived']['rule'] = ('generated by scripts/release/build_csi_bundle.py from the tracked public artifact raw; --check regenerates them byte for '
                             'byte; identical to the derivation from the acquisition raw (NEUTRALITY.json)')
    sr['release']['campaign_archive_layer'] = f'campaign-{CID}.tar = the public artifact raw (the acquisition raw archive is recorded in ACQUISITION-RAW.json and not released)'
    sr['provenance_layers'] = {
        'acquisition_raw': {'record': ACQ_JSON, 'definition': acq['definition'], 'files': acq['manifest']['files'],
                            'manifest_aggregate_sha256': acq['manifest']['aggregate_sha256'], 'archive': acq['archive']['file'],
                            'archive_sha256': acq['archive']['sha256'], 'versioned': False, 'distributed_through_git': False,
                            'reason': acq['archive']['reason']},
        'public_artifact_raw': {'source_path': SRC, 'source_manifest': f'{EV}/SOURCE.sha256', 'source_manifest_sha256': sha(man), 'files': len(pub),
                                'relation_to_acquisition_raw': (f"not byte-identical: {san['summary']['files_changed']} anvil-zksync start-up logs (anvil.stdout) "
                                                                f"differ, {san['summary']['lines_changed']} banner lines in total (the two displayed development "
                                                                f"private keys and the mnemonic line of each), each replaced by the marker {san['marker']}; "
                                                                f"every other line and the other {len(pub) - san['summary']['files_changed']} files are byte-identical"),
                                'sanitation_record': SAN_JSON, 'sanitation_tool': SANITIZER, 'sanitation_tool_sha256': shaf(P(SANITIZER)),
                                'used_by': 'every public reproduction and check script (build_csi_bundle.py, derive_chain_l2.py, validate_l2.py, compare_l2.py)'},
        'timing': 'the sanitation was applied after the acceptance of the campaign; it changes no measurement field and no accepted run',
        'neutrality': {'record': NEU_JSON, 'passed': True, 'requirements': f"{sum(x['pass'] for x in neu['requirements'])}/{len(neu['requirements'])}"},
        'retained_configuration': san['retained_configuration_note'],
        'tool': 'scripts/release/chain_l2_publication_hygiene.py', 'tool_sha256': shaf(P('scripts/release/chain_l2_publication_hygiene.py'))}
    open(P(f'{EV}/campaign.json'), 'w').write(jdump(cj))
    vm = open(P(f'{EV}/VALIDATION.md')).read()
    vm = vm.split('\n' + LAYER_HEAD)[0].rstrip('\n') + '\n'
    vm = re.sub(r'^- \*\*Source \(only source of truth\):\*\* .*$',
                f'- **Source:** `{SRC}/` (the public artifact raw; see *Provenance layers* below), frozen by `SOURCE.sha256`. Produced by '
                f'`./chainbench/run.sh full-local-l2` at the baseline tag `{TAG}` (`{sr["baseline_commit"][:7]}`).', vm, count=1, flags=re.M)
    vm += '\n'.join(['', LAYER_HEAD, '',
                     f"- **Acquisition raw:** the exact {acq['manifest']['files']} files emitted by the accepted campaign, validated above. Kept as the "
                     f"deterministic archive `{os.path.basename(acq['archive']['file'])}` (sha256 `{acq['archive']['sha256']}`; manifest aggregate "
                     f"`{acq['manifest']['aggregate_sha256']}`), recorded in `ACQUISITION-RAW.json` (hashes only). It is not versioned and not distributed "
                     f"through git, because 18 anvil-zksync start-up logs display the standard public development credentials of the local node.",
                     f"- **Public artifact raw:** the tracked `{SRC}/` ({len(pub)} files, `SOURCE.sha256` sha256 `{sha(man)}`). It is not byte-identical "
                     f"to the acquisition raw: in {san['summary']['files_changed']} `anvil.stdout` files, {san['summary']['lines_changed']} start-up-banner "
                     f"lines (the two displayed development private keys and the mnemonic line of each) were replaced by `{san['marker']}` "
                     f"(`SANITATION.json`, `{SANITIZER}`). Every other line and file is byte-identical. No scientific script reads `anvil.stdout`.",
                     f"- **Timing and effect:** the sanitation was applied after acceptance and changes no measurement field. Rerunning parsing, "
                     f"validation and derivation on both layers gives identical results ({sum(x['pass'] for x in neu['requirements'])}/{len(neu['requirements'])} "
                     f"requirements, `NEUTRALITY.json`): V1-V13, 82/82, 15,840/15,840, 200/200 receipt reconstructions per run, the fee trace re-parsed "
                     f"identically, byte-identical derived CSVs, `values.tex` and `validation.json`, unchanged identities. `derived/derivation.json` "
                     f"differs only in its input fingerprint (`inputs_sha256`) of the 18 sanitised files.",
                     f"- **Retained configuration:** {san['retained_configuration_note']}.", ''])
    open(P(f'{EV}/VALIDATION.md'), 'w').write(vm)
    print(f'recorded: {EV}/SOURCE.sha256 ({len(pub)} files, {sha(man)[:16]}...), campaign.json provenance_layers, VALIDATION.md')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('acquire'); sub.add_parser('restore'); sub.add_parser('record')
    s = sub.add_parser('snapshot'); s.add_argument('--out', required=True)
    c = sub.add_parser('compare'); c.add_argument('--pre', required=True); c.add_argument('--post', required=True)
    a = ap.parse_args()
    {'acquire': acquire, 'restore': restore, 'record': record, 'snapshot': snapshot, 'compare': compare}[a.cmd](a)


if __name__ == '__main__':
    main()
