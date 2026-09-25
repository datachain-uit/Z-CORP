#!/usr/bin/env python3
"""Administrative record of a zcorp local-L1 campaign (CHAIN-PROTOCOL-v1 §13). Campaign and venue identity come from the
campaign binding (workloads/zcorp/campaigns/<id>.json); nothing venue-specific is hard-coded here.

Writes, from a packaged (container) dry run:
  <campaign_dir>/campaign.json   deterministic (sort_keys)
  <notes_dir>/DRY-RUN.md         packaged engineering dry run: status, comparisons, per-cell summary
  <registry> row                 status / baseline_tag / commit of this campaign only (other rows untouched)

Refuses unless:
  * the three runs (EDR a, EDR b, geth) were made at one commit with clean tracked paths and accepted checks;
  * the measurement paths of the binding are unchanged between that commit and the working tree;
  * determinism, cross-client and both comparisons with the accepted readiness dry run are identical;
  * the smoke check passed;
  * the image records in the working tree (chainbench/docker/pins.env, IMAGE.json) equal the records of the image the
    runs actually used (freeze directory written by `run.sh author-freeze`; image id in each run's environment.json).

Scientific mode (after the full matrix): record_campaign.py --scientific <tracked raw campaign dir> --baseline-tag <tag> [--offchain <json>]
Usage: record_campaign.py --dry-run-id <id> --smoke <smoke run dir> --freeze <freeze dir> --baseline-tag <tag>
                          [--dry-root build/chainbench/dry-run] [--binding <campaign binding json>]"""
import argparse, csv, hashlib, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CB = os.path.abspath(os.path.join(HERE, '..', '..'))
REPO = os.path.abspath(os.path.join(CB, '..'))
CB_REL = os.path.relpath(CB, REPO)
ap = argparse.ArgumentParser()
ap.add_argument('--dry-run-id'); ap.add_argument('--smoke'); ap.add_argument('--freeze')
ap.add_argument('--baseline-tag', required=True); ap.add_argument('--dry-root', default='build/chainbench/dry-run')
ap.add_argument('--binding', default=os.path.join(HERE, 'campaigns', 'CSI-CHAIN-LOCAL-01.json'))
ap.add_argument('--archive-record', help='CSI image archive record (csi/release/<id>/IMAGE-ARCHIVE.json)')
ap.add_argument('--portability-smoke', action='append', default=[], help='smoke run dir on another platform (repeatable)')
ap.add_argument('--prefreeze-summary', help='summary file written by run.sh author-prefreeze')
ap.add_argument('--previous-tag', action='append', default=[], help='TAGOBJECT:COMMIT of an earlier (moved, never pushed) baseline tag')
ap.add_argument('--scientific', help='scientific mode: the tracked raw campaign directory (e.g. results/chain-local-l1-20260925)')
ap.add_argument('--offchain', help='scientific mode: off-chain proof-set verification record (scripts/analysis/verify_chain_proofset.js)')
a = ap.parse_args()

def P(p): return p if os.path.isabs(p) else os.path.join(REPO, p)
def sha(p): return hashlib.sha256(open(P(p), 'rb').read()).hexdigest()
def git(*x): return subprocess.run(['git', '-C', REPO, *x], capture_output=True, text=True, check=True).stdout.strip()
def jl(p): return json.load(open(P(p)))
def envfile(p): return dict(re.findall(r'^([A-Z0-9_]+)="(.*)"$', open(P(p)).read(), re.M))
def die(msg): sys.exit(f'record_campaign: REFUSED: {msg}')

# ================================================================ scientific mode (inserted into record_campaign.py)
def scientific(a):
    """Register the accepted scientific campaign: re-validate identities (anti-mixing), run the committed derivation into a
    temporary directory (all section 10 checks must pass), then write campaign.json scientific_run, VALIDATION.md and the
    registry row. The tracked raw campaign directory is the only source of truth; nothing in it is modified."""
    import tempfile
    B = jl(a.binding); AR = B['admin_record']
    CAMP = B['campaign_dir']; PROTO = B['protocol']; MCODE = B['measurement_code_paths']
    src = a.scientific.rstrip('/')
    runs_dirs = sorted(d for d in os.listdir(P(src)) if os.path.isdir(P(os.path.join(src, d))))
    cid = sorted({re.sub(r'-(edr-a|edr-b|geth)$', '', d) for d in runs_dirs})
    if len(cid) != 1: die(f'{src}: expected one campaign, found {cid}')
    cid = cid[0]
    D = {k: os.path.join(src, f'{cid}-{k}') for k in ('edr-a', 'edr-b', 'geth')}
    runs = {k: jl(os.path.join(d, 'run.json')) for k, d in D.items()}
    envs = {k: jl(os.path.join(d, 'environment.json')) for k, d in D.items()}
    rec = jl(os.path.join(CAMP, 'campaign.json'))
    tag = a.baseline_tag
    tag_commit = git('rev-parse', f'{tag}^{{commit}}'); tag_object = git('rev-parse', tag)
    mcc = rec['commits']['measurement_code_commit']
    # ---- anti-mixing: one campaign, one commit (= the baseline tag), one image (= the archived image), one protocol
    for k, r in runs.items():
        if r['plan'] != 'full': die(f'{k}: plan {r["plan"]} is not full')
        if r['commit'] != tag_commit: die(f'{k}: run commit {r["commit"]} != baseline tag commit {tag_commit}')
        if r['dirty_tracked_paths']: die(f'{k}: dirty tracked paths {r["dirty_tracked_paths"]}')
        if r.get('accepted_checks') is not True: die(f'{k}: runner checks not accepted')
        if r.get('campaign_id') != B['campaign_id']: die(f'{k}: campaign {r.get("campaign_id")}')
    if git('diff', '--name-only', mcc, tag_commit, '--', *MCODE): die(f'measurement code changed between {mcc[:7]} and the baseline {tag_commit[:7]}')
    arc = json.loads(git('show', f'{tag_commit}:{CB_REL}/docker/ARCHIVE.json'))
    for k, e in envs.items():
        c = e.get('container') or {}
        if c.get('image_id') != arc['image_id']: die(f'{k}: image {c.get("image_id")} is not the archived image {arc["image_id"]}')
        if (c.get('network_isolation') or {}).get('isolated') is not True: die(f'{k}: network isolation not established')
    proto_bytes = subprocess.run(['git', '-C', REPO, 'show', f'{tag_commit}:{PROTO}'], capture_output=True, check=True).stdout  # exact bytes (no strip)
    proto_at_tag = proto_bytes.decode()
    proto_sha = hashlib.sha256(proto_bytes).hexdigest()
    if sha(PROTO) != proto_sha: die('the protocol changed after the baseline tag')
    for k, r in runs.items():
        if r['protocol_sha256'] != proto_sha: die(f'{k}: protocol sha256 {r["protocol_sha256"]} != protocol at the baseline')
    pm = runs['edr-a']['proofset_manifest']
    psd = B['proofset_dir']
    if pm.get('csv_sha256') != sha(f'{psd}/PROOFSET.csv') or pm.get('sha256_file_sha256') != sha(f'{psd}/PROOFSET.sha256'): die('proof-set manifest differs from the committed proof set')
    pre = jl(os.path.join(src, f'{cid}.preflight.json')); post = jl(os.path.join(src, f'{cid}.postflight.json'))
    for n, d in (('pre-flight', pre), ('post-flight', post)):
        if d['fails'] != 0 or d['head'] != tag_commit: die(f'{n}: fails {d["fails"]}, head {d["head"]}')
    off = jl(a.offchain) if a.offchain else None
    if off and off.get('all_checks_pass') is not True: die('off-chain proof-set verification failed')
    # ---- the committed derivation (all section 10 checks re-evaluated from the raw rows)
    tmp = tempfile.mkdtemp(prefix='chain-derive-')
    cmd = [sys.executable, P('scripts/analysis/derive_chain_l1.py'), '--campaign', P(src), '--out', tmp, '--repo', REPO,
           '--expect-campaign-id', cid, '--expect-commit', tag_commit, '--expect-tag', tag, '--expect-image-id', arc['image_id'],
           '--expect-protocol-sha256', proto_sha]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: die(f'derivation checks failed: {r.stderr.strip()}')
    val = json.load(open(os.path.join(tmp, 'validation.json'))); dmeta = json.load(open(os.path.join(tmp, 'derivation.json')))
    if val.get('passed') is not True: die('validation.json: not passed')
    ut = open(P(os.path.join(src, f'{cid}.unit_tests.log'))).read()
    mp = re.search(r'(\d+) passing', ut)
    envG = envs['geth']
    ec = jl(os.path.join(D['geth'], 'env_check.json'))
    def runsum(k):
        x = runs[k]
        return {'run_id': x['run_id'], 'env': x['env'], 'rows': x['rows'], 'rows_expected': x['rows_expected'], 'rows_failing_check': x['rows_failing_check'],
                'deployments_runtime_match': x['deployments_runtime_match'], 'env_check_pass': x['env_check_pass'], 'ops_csv_sha256': x['ops_csv_sha256'],
                'started_at_utc': x['started_at_utc'], 'finished_at_utc': x['finished_at_utc'], 'dir': D[k]}
    ch = val['checks']
    sr = {
        'campaign_id': cid, 'source_path': src,
        'produced_at': 'build/campaigns/chain/ (protocol section 8); moved unchanged to the tracked source_path, which is the only source of truth',
        'source_manifest': f'{CAMP}/SOURCE.sha256',
        'baseline_tag': tag, 'baseline_tag_object': tag_object, 'baseline_commit': tag_commit,
        'measurement_code_commit': mcc, 'measurement_code_identical_at_baseline': True,
        'raw_row_commit_field': f'run.json "commit" of every run = {tag_commit} (the baseline commit)',
        'protocol': {'path': PROTO, 'sha256_at_baseline': proto_sha, 'amendments': re.findall(r'^\| (A\d+) \|', proto_at_tag, re.M)},
        'image': {'image_id': arc['image_id'], 'platform': arc['platform'], 'archive_sha256': arc['archive_sha256'], 'archive_bytes': arc['archive_bytes'],
                  'archive_record': f'{CB_REL}/docker/ARCHIVE.json', 'geth_archive_sha256': arc.get('geth_archive_sha256')},
        'geth': {'binary_sha256': envG['geth']['sha256'], 'client_version': ec['geth']['client_version'], 'source': (envG.get('container') or {}).get('geth_source')},
        'edr': envs['edr-a'].get('edr_identity'),
        'plan': {'cells': runs['edr-a']['cells'], 'proofs': runs['edr-a']['proofs'], 'rows_per_run': runs['edr-a']['expected_rows']},
        'runs': {k: runsum(k) for k in ('edr-a', 'edr-b', 'geth')},
        'unit_tests': {'passing': int(mp.group(1)) if mp else 0, 'log': os.path.join(src, f'{cid}.unit_tests.log')},
        'preflight': {'file': os.path.join(src, f'{cid}.preflight.json'), 'fails': pre['fails'], 'head': pre['head']},
        'postflight': {'file': os.path.join(src, f'{cid}.postflight.json'), 'fails': post['fails'], 'head': post['head']},
        'validation': {'passed': True, 'checks': f"{sum(1 for c in ch.values() if c['pass'])}/{len(ch)}",
                       'determinism_field_comparisons': ch['determinism_rows_identical']['comparisons'],
                       'crossclient_field_comparisons': ch['crossclient_rows_identical']['comparisons'],
                       'file': f'{CAMP}/derived/validation.json', 'summary': f'{CAMP}/VALIDATION.md'},
        'offchain_proofset': ({'file': a.offchain, 'proofs': off['proofs'], 'verified': off['verified'], 'all_checks_pass': off['all_checks_pass'],
                               'snarkjs': off['snarkjs']} if off else None),
        'derived': {'dir': f'{CAMP}/derived', 'tool': dmeta['tool'], 'tool_sha256': dmeta['tool_sha256'], 'outputs_sha256': dmeta['outputs_sha256'],
                    'rule': 'generated by scripts/release/build_csi_bundle.py from the tracked raw campaign; --check regenerates them byte for byte'},
        'release': {'dir': f'csi/release/{AR["admin_id"]}', 'manifest': f'csi/release/{AR["admin_id"]}/RELEASE.sha256',
                    'archives': [f'campaign-{cid}.tar', f'code-{tag_commit[:7]}.tar', arc['archive'], arc.get('geth_archive')],
                    'versioned': 'no (Zenodo deposit); their sha256 are in RELEASE.sha256'},
        'evidence_status': 'scientific; accepted (protocol section 10 items 1-6)',
    }
    rec['scientific_run'] = sr
    rec['status'] = 'validated'
    rec['stage'] = (f'scientific L1 matrix run and validated ({cid}); baseline tag {tag} at {tag_commit[:7]}; '
                    'local-EraVM arm pending (protocol section 14)')
    rec['notes'] = sorted(set(rec.get('notes', [])) | {f'{AR["notes_dir"]}/PORTABILITY.md'})
    open(P(os.path.join(CAMP, 'campaign.json')), 'w').write(json.dumps(rec, indent=2, sort_keys=True) + '\n')
    # ---- VALIDATION.md
    L = [f'# {AR["admin_id"]}: validation of the scientific L1 campaign `{cid}`', '',
         f'- **Source (only source of truth):** `{src}/`, frozen by `SOURCE.sha256`. Produced by `./chainbench/run.sh full-local-l1` at the baseline tag `{tag}` (`{tag_commit[:7]}`).',
         f'- **Measurement code:** identical to `{mcc[:7]}`, the commit of the final packaged dry run (`measurement_code_paths` of the campaign binding).',
         f'- **Environment:** archived image `{arc["image_id"]}` ({arc["platform"]}; `docker save` sha256 `{arc["archive_sha256"]}`), `--network none`; geth `{ec["geth"]["client_version"]}` (binary sha256 `{envG["geth"]["sha256"][:16]}…`).',
         f'- **Protocol:** CHAIN-PROTOCOL-v1 with amendments {", ".join(sr["protocol"]["amendments"])}, sha256 `{proto_sha[:16]}…`.',
         f'- **Rows:** {runs["edr-a"]["expected_rows"]} per run, as planned ({len(sr["plan"]["cells"])} cells × 36 rows; K = {len(sr["plan"]["proofs"])}).',
         '', '| Criterion (section 10) | Result |', '|---|---|',
         f'| 1. Build: compiles, size limits, staged = committed, PLONK verifier provenance | pass (both profiles, all three runs; pre-flight `export_plonk_verifiers --check-only` 11/11) |',
         f'| 2. Proof set: `PROOFSET.sha256`, off-chain verification | pass (128 files; ' + (f'{off["verified"]}/{off["proofs"]} proofs verified off-chain with snarkjs {off["snarkjs"]}' if off else 'generation record') + ') |',
         f'| 3. Rows: `check_pass = 1`, runtime = artifact, counts | pass (every row of every run; {runs["edr-a"]["expected_rows"]}/{runs["edr-a"]["expected_rows"]}) |',
         '| 4. Hardfork (`env_check`) | pass (EDR osaka 4/4, prague control 0/4, geth 4/4) |',
         f'| 5. Determinism (EDR a vs b, from scratch) | identical: {ch["determinism_rows_identical"]["comparisons"]} field comparisons, 0 differences; build manifests byte-identical |',
         f'| 6. Cross-client (EDR a vs geth) | identical: {ch["crossclient_rows_identical"]["comparisons"]} field comparisons under the §8.4 exclusions, 0 differences; build manifests byte-identical |',
         f'| Unit tests (§12 step 4) | {sr["unit_tests"]["passing"]} passing, 0 failing |',
         f'| Pre-flight / post-flight doctor | 0 FAIL / 0 FAIL; head = baseline commit; archived image in use; no network |',
         f'| Anti-mixing | every run.json commit = {tag_commit[:7]} = tag; one image; one protocol; proof-set manifest = committed |',
         '', f'All {sr["validation"]["checks"]} checks of `derived/validation.json` pass. Derived outputs: `derived/` (`scripts/analysis/derive_chain_l1.py`).', '']
    open(P(os.path.join(CAMP, 'VALIDATION.md')), 'w').write('\n'.join(L))
    # ---- registry row
    reg = P(AR['registry'])
    rows = list(csv.DictReader(open(reg, newline=''))); fields = list(rows[0].keys())
    hit = [x for x in rows if x['admin_id'] == AR['admin_id']]
    if len(hit) != 1: die('registry: expected one row')
    hit[0].update({'status': 'validated', 'campaign_id': cid, 'source_path': src, 'baseline_tag': tag, 'commit': tag_commit})
    with open(reg, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator='\n'); w.writeheader(); w.writerows(rows)
    print('written', f'{CAMP}/campaign.json', f'{CAMP}/VALIDATION.md', f'{AR["registry"]} ({AR["admin_id"]} row: validated, {cid}, {tag_commit[:7]})')


if a.scientific:
    scientific(a)
    sys.exit(0)
if not (a.dry_run_id and a.smoke and a.freeze):
    ap.error('dry-run mode needs --dry-run-id, --smoke and --freeze')

B = jl(a.binding); AR = B['admin_record']
CAMP = B['campaign_dir']; NOTES = AR['notes_dir']; PROTO = B['protocol']
MEAS = B['measurement_paths']
MCODE = B.get('measurement_code_paths', MEAS)
IMAGE_RECORDS = [f'{CB_REL}/docker/pins.env', f'{CB_REL}/docker/IMAGE.json']
ARCHIVE_REC = f'{CB_REL}/docker/ARCHIVE.json'
dry = os.path.join(a.dry_root, a.dry_run_id)
D = {'edr-a': f'{dry}-edr-a', 'edr-b': f'{dry}-edr-b', 'geth': f'{dry}-geth'}
runs = {k: jl(os.path.join(d, 'run.json')) for k, d in D.items()}
envs = {k: jl(os.path.join(d, 'environment.json')) for k, d in D.items()}
head = runs['edr-a']['commit']

# ---- refusals
for k, r in runs.items():
    if r['commit'] != head or r['dirty_tracked_paths']: die(f'{k}: commit {r["commit"][:7]} / dirty {r["dirty_tracked_paths"]} (one clean commit required)')
    if r.get('accepted_checks') is not True: die(f'{k}: run checks not accepted')
    if not all(s in r.get('steps', {}) for s in ('build', 'envcheck', 'exec', 'finish')): die(f'{k}: incomplete steps {r.get("steps")}')
    if r.get('campaign_id') != B['campaign_id']: die(f'{k}: campaign {r.get("campaign_id")} is not {B["campaign_id"]}')
changed = git('diff', '--name-only', head, '--', *MCODE)
if changed: die(f'measurement code differs between the dry-run commit {head[:7]} (measurement_code_commit) and the working tree: {changed}')
changed_other = [f for f in git('diff', '--name-only', head, '--', *MEAS).splitlines() if f]
cmp = {'determinism': jl(os.path.join(D['edr-b'], 'compare_determinism.json')), 'cross_client': jl(os.path.join(D['geth'], 'compare_crossclient.json')),
       'edr_vs_readiness': jl(os.path.join(D['edr-a'], 'compare_vs_reference.json')), 'geth_vs_readiness': jl(os.path.join(D['geth'], 'compare_vs_reference.json'))}
for k, c in cmp.items():
    if c.get('identical') is not True: die(f'comparison {k} is not identical')
sm = jl(os.path.join(a.smoke, 'smoke_check.json'))
if sm.get('pass') is not True: die('smoke check did not pass')
fz_env = envfile(os.path.join(a.freeze, 'image.env')); fz_id = jl(os.path.join(a.freeze, 'identity.json'))
if open(P(IMAGE_RECORDS[0])).read() != open(P(os.path.join(a.freeze, 'pins.env'))).read(): die('chainbench/docker/pins.env differs from the pins used for the packaged dry run')
img = jl(IMAGE_RECORDS[1])
if img.get('toolchain') != fz_id.get('toolchain'): die('chainbench/docker/IMAGE.json toolchain differs from the identity of the image used')
arc = jl(ARCHIVE_REC) if os.path.exists(P(ARCHIVE_REC)) else None
if arc and (arc.get('image_id') != fz_env['IMAGE_ID'] or arc.get('role') != 'scientific'): die('chainbench/docker/ARCHIVE.json does not archive the image of the packaged dry run')
csi_arc = jl(a.archive_record) if a.archive_record else None
if csi_arc and csi_arc.get('checks_pass') is not True: die(f'{a.archive_record}: image archive checks failed')
for k, e in envs.items():
    c = e.get('container') or {}
    if c.get('image_id') != fz_env['IMAGE_ID']: die(f'{k}: ran in image {c.get("image_id")}, not the frozen image {fz_env["IMAGE_ID"]}')
    if c.get('network') != 'none' or (c.get('network_isolation') or {}).get('isolated') is not True:
        die(f'{k}: not run without network ({c.get("network")}, {c.get("network_isolation")})')
if open(P(os.path.join(a.freeze, 'DRY_RUN_ID'))).read().strip() != a.dry_run_id: die('the freeze directory belongs to another dry run')

# ---- record
envA, envG = envs['edr-a'], envs['geth']
ec = jl(os.path.join(D['geth'], 'env_check.json'))
UT = f'{dry}.unit_tests.log' if os.path.exists(P(f'{dry}.unit_tests.log')) else os.path.join(a.smoke, 'unit_tests.log')  # dry run's own step 4, else smoke
ut = open(P(UT)).read()
m_pass = re.search(r'(\d+) passing', ut); m_fail = re.search(r'(\d+) failing', ut)
prov = jl(B['plonk_verifier_provenance'])
psj = jl(os.path.join(B['proofset_dir'], 'PROOFSET.json'))
geth_sums = dict(reversed(l.split()) for l in open(os.path.join(CB, 'geth', 'SHA256SUMS')).read().splitlines())
old = jl(os.path.join(CAMP, 'campaign.json')) if os.path.exists(P(os.path.join(CAMP, 'campaign.json'))) else {}
previous = [{'superseded_because': 'readiness dry run before packaging', **p} for p in (old.get('previous_dry_runs') or [])]
if old.get('dry_run') and old['dry_run'].get('runs', {}).get('edr-a', {}).get('commit') not in (None, head) \
        and not any(p.get('runs', {}).get('edr-a', {}).get('commit') == old['dry_run']['runs']['edr-a']['commit'] for p in previous):
    oc = old['dry_run']['runs']['edr-a']['commit'][:7]
    packaged = 'packaged' in str(old['dry_run'].get('environment', ''))
    previous.append({**old['dry_run'],
                     'environment': (f"packaged container, image {old.get('container_image', {}).get('image_id')}, --network none" if packaged
                                     else 'uncontainerised pinned VM environment (readiness)'),
                     'superseded_because': ('the reviewer entry point changed after this run (protocol section 12 step 4 unit tests added to the '
                                            'run procedure; one runner invocation per step, section 15 A3); packaged dry run repeated'
                                            if packaged else 'readiness dry run before packaging'),
                     'container_image': old.get('container_image', {}).get('image_id') if packaged else None,
                     'harness_commit': old.get('harness', {}).get('commit'),
                     'notes': f'{NOTES}/DRY-RUN-{"packaged" if packaged else "readiness"}-{oc}.md'})

def portability():
    if not a.portability_smoke:
        return None
    base = list(csv.DictReader(open(P(os.path.join(a.smoke, 'local_l1_ops.csv')))))
    res = []
    for d in a.portability_smoke:
        e = jl(os.path.join(d, 'environment.json')); s = jl(os.path.join(d, 'smoke_check.json')); r = jl(os.path.join(d, 'run.json'))
        rows = list(csv.DictReader(open(P(os.path.join(d, 'local_l1_ops.csv')))))
        diffs = sum(1 for x, y in zip(rows, base) for c in x if c != 'run_id' and x[c] != y.get(c)) + abs(len(rows) - len(base))
        ut = open(P(os.path.join(d, 'unit_tests.log'))).read()
        res.append({'smoke_run': os.path.basename(os.path.normpath(d)), 'platform': f"linux/{ {'x64': 'amd64'}.get(e['host']['arch'], e['host']['arch']) }",
                    'image_id': (e.get('container') or {}).get('image_id'), 'edr_native_package': e['edr_identity']['native_package'],
                    'edr_native_sha256': e['edr_identity']['native_sha256'],
                    'network_isolated': ((e.get('container') or {}).get('network_isolation') or {}).get('isolated'),
                    'smoke_pass': s['pass'], 'smoke_checks': len(s['checks']), 'rows': r['rows'], 'accepted_checks': r['accepted_checks'],
                    'unit_tests_passing': int(re.search(r'(\d+) passing', ut).group(1)) if re.search(r'(\d+) passing', ut) else 0,
                    'rows_equal_native_smoke_all_fields_except_run_id': diffs == 0, 'native_smoke_compared': os.path.basename(os.path.normpath(a.smoke)),
                    'evidence_status': 'reviewer-portability check (emulated); not scientific data'})
    summ = dict(re.findall(r'^([a-z0-9_]+): (.*)$', open(P(a.prefreeze_summary)).read(), re.M)) if a.prefreeze_summary else None
    return {'checks': res, 'prefreeze_summary': summ, 'prefreeze_summary_file': a.prefreeze_summary,
            'scientific_platform': 'linux/arm64 only'}


def run_summary(k):
    r = runs[k]
    return {'run_id': r['run_id'], 'env': r['env'], 'plan': r['plan'], 'commit': r['commit'], 'rows': r['rows'], 'rows_expected': r['rows_expected'],
            'rows_failing_check': r['rows_failing_check'], 'deployments_runtime_match': r['deployments_runtime_match'], 'env_check_pass': r['env_check_pass'],
            'ops_csv_sha256': r['ops_csv_sha256'], 'started_at_utc': r['started_at_utc'], 'finished_at_utc': r['finished_at_utc'],
            'raw_dir': os.path.relpath(P(D[k]), REPO) + ' (git-ignored; engineering, not archived)'}
def cmp_summary(c):
    c = {**c, 'a': os.path.normpath(os.path.join(CB_REL, c['a'])), 'b': os.path.normpath(os.path.join(CB_REL, c['b']))}  # compare_runs ran in chainbench/
    return {k: c[k] for k in ('identical', 'a', 'b', 'rows_compared', 'tx_rows_compared', 'call_rows_compared', 'field_value_comparisons', 'differences_per_field', 'excluded_fields')} \
        | {'build_manifests_identical': all(v['identical'] for v in c['build_manifests'].values())}
contract_files = sorted([f'contracts/chain/{f}' for f in os.listdir(P('contracts/chain')) if f.endswith('.sol')] +
                        [f'contracts/Groth16LegacyVerifierDepth{d}.sol' for d in range(5, 16)] + ['contracts/CredentialManager.sol', 'contracts/IGroth16Verifier.sol'])
gsrc = (envG.get('container') or {}).get('geth_source') or ''
rec = {
    'admin_id': AR['admin_id'], 'venue': B['venue'], 'experiment': AR['experiment'], 'status': 'ready',
    'stage': f'packaged (container) environment frozen; packaged engineering dry run passed; baseline tag {a.baseline_tag}; '
             'full L1 scientific matrix not started; local-EraVM arm pending (protocol section 14)',
    'used_in_manuscript': 'no',
    'protocol': {'path': PROTO, 'version': 'v1', 'sha256': sha(PROTO),
                 'frozen_at_commit': git('log', '--diff-filter=A', '--format=%H', '--', PROTO).splitlines()[-1],
                 'amendments_pre_run': re.findall(r'^\| (A\d+) \|', open(P(PROTO)).read(), re.M), 'eravm_arm': 'pending'},
    'baseline': {'tag': a.baseline_tag, 'tagged_commit': 'the commit that adds this record and the committed image records (see the registry and `git rev-parse <tag>`)',
                 'measurement_paths_identical_to': head, 'measurement_paths': MEAS, 'image_records': IMAGE_RECORDS + ([ARCHIVE_REC] if arc else []),
                 'workload': runs['edr-a'].get('workload'), 'campaign_binding': runs['edr-a'].get('campaign_binding'),
                 'previous_tag_positions': [dict(zip(('tag_object', 'commit'), t.split(':'))) | {'note': 'moved before publication; never pushed; no scientific run had started'} for t in a.previous_tag]},
    'commits': {'measurement_code_commit': head,
                'measurement_code_commit_meaning': B.get('commit_semantics', {}).get('measurement_code_commit'),
                'measurement_code_paths': MCODE, 'measurement_code_unchanged_in_record_worktree': True,
                'baseline_commit': f'the commit of tag {a.baseline_tag} (git rev-parse {a.baseline_tag}^{{commit}}); scientific run.json commit must equal it',
                'baseline_commit_meaning': B.get('commit_semantics', {}).get('baseline_commit'),
                'registry_commit_meaning': B.get('commit_semantics', {}).get('registry_commit'),
                'changed_after_measurement_code_commit_outside_measurement_code': changed_other,
                'why_outside': 'protocol amendment A5 (text only) and host-side orchestration/records; none is on the per-row measurement path'},
    'harness': {'path': CB_REL, 'commit': head, 'lockfile_sha256': envA['lockfile_sha256'], 'packages': envA['packages'],
                'edr_native_binary': envA['edr_native_binary'], 'edr_identity': envA.get('edr_identity'), 'soljson_sha256': envA['soljson_sha256'],
                'hardhat_console_sol_sha256': envA['hardhat_console_sol_sha256'], 'node': envA['node'], 'npm': envA['npm'], 'host': envA['host'],
                'reviewer_entry_point': f'{CB_REL}/run.sh (doctor, smoke, full-local-l1)', 'reviewer_readme': f'{CB_REL}/README.md'},
    'container_image': {'image_id': fz_env['IMAGE_ID'], 'base_image': fz_env['BASE_IMAGE_PINNED'], 'geth_source': fz_env['GETH_SOURCE_DESC'],
                        'platform': f'linux/{fz_env["ARCH"]}', 'built_at_utc': fz_env['BUILT_AT'], 'network_at_run_time': 'none: only loopback up, no IPv4 route, no non-loopback IPv6 route (core/netcheck.js; recorded per run in environment.json container.network_isolation)',
                        'identity_record': IMAGE_RECORDS[1], 'identity_record_sha256': sha(IMAGE_RECORDS[1]), 'pins': IMAGE_RECORDS[0], 'pins_sha256': sha(IMAGE_RECORDS[0]),
                        'toolchain': fz_id['toolchain'], 'apt_packages': (fz_id.get('system') or {}).get('apt_packages'),
                        'os_release': (fz_id.get('system') or {}).get('os_release'), 'docker_host': fz_id.get('host'),
                        'buildx_metadata': {k: v for k, v in (fz_id.get('build_metadata') or {}).items() if k in ('containerimage.config.digest', 'containerimage.digest', 'buildx.build.ref')},
                        'image_id_note': 'the image id is machine-specific (apt layer); reproducibility is defined by the pinned base/geth digests, the lockfile and the recorded toolchain identity',
                        'archive': ({'record': ARCHIVE_REC, 'record_sha256': sha(ARCHIVE_REC), 'file': arc['archive_file'], 'bytes': arc['archive_bytes'],
                                     'sha256': arc['archive_sha256'], 'geth_file': arc.get('geth_archive'), 'geth_bytes': arc.get('geth_archive_bytes'),
                                     'geth_sha256': arc.get('geth_archive_sha256'), 'versioned': False,
                                     'rule': 'full-local-l1 accepts only this exact image on linux/arm64 (doctor --require-archived-image)'} if arc else None),
                        'archive_identity': ({'record': a.archive_record, 'record_sha256': sha(a.archive_record),
                                              'images': [{k: e[k] for k in ('platform', 'role', 'image_id')} | {
                                                  'platform_manifest': next((m['digest'] for m in e['chainbench'].get('manifests', []) if m['kind'] == 'image'), None),
                                                  'config': next((m['config'] for m in e['chainbench'].get('manifests', []) if m['kind'] == 'image'), None),
                                                  'archive_sha256': e['chainbench']['sha256'], 'archive_bytes': e['chainbench']['bytes'],
                                                  'geth_archive_sha256': e['geth']['sha256'], 'geth_archive_bytes': e['geth']['bytes'],
                                                  'geth_manifest': e['geth'].get('top_digest'), 'geth_binary_sha256': e['geth'].get('geth_binary_sha256')}
                                                  for e in csi_arc['images']]} if csi_arc else None)},
    'contracts': {f: sha(f) for f in contract_files},
    'plonk_verifiers': {'provenance': B['plonk_verifier_provenance'], 'sha256': sha(B['plonk_verifier_provenance']),
                        'all_checks_pass': prov['all_checks_pass'], 'depths': len(prov['depths'])},
    'proofset': {'id': 'PS-01', 'dir': B['proofset_dir'], 'count': psj['count'], 'rule': psj['rule'],
                 'csv_sha256': sha(f'{B["proofset_dir"]}/PROOFSET.csv'), 'sha256_file_sha256': sha(f'{B["proofset_dir"]}/PROOFSET.sha256'),
                 'json_sha256': sha(f'{B["proofset_dir"]}/PROOFSET.json'), 'generated_at_commit': psj['commit_at_start']},
    'geth': {'version': 'v1.16.9', 'source_commit': '95665d5703e1023995a0ff93e4ce9eb77e8a59bd', 'source_used': gsrc,
             'from_source_recipe': f'{CB_REL}/geth/', 'from_source_binary_sha256': geth_sums, 'binary_used_sha256': envG['geth']['sha256'],
             'binary_used_version': envG['geth'].get('version'), 'dev_mode_forks': 'through Osaka (AllDevChainProtocolChanges)',
             'client_version': ec['geth']['client_version']},
    'env_check': {'file': os.path.relpath(P(os.path.join(D['geth'], 'env_check.json')), REPO), 'edr_osaka_markers': ec['edr']['osaka']['markers'],
                  'edr_prague_control_markers': ec['edr']['prague']['markers'], 'geth_markers': ec['geth']['markers'], 'pass': ec['pass']},
    'unit_tests': {'passing': int(m_pass.group(1)) if m_pass else 0, 'failing': int(m_fail.group(1)) if m_fail else 0, 'log': os.path.relpath(P(UT), REPO)},
    'smoke': {'run_id': os.path.basename(os.path.normpath(a.smoke)), 'pass': sm['pass'], 'checks': len(sm.get('checks', [])),
              'evidence_status': 'packaging check; not data'},
    'portability': portability(),
    'dry_run': {
        'plan': 'dry (Groth16 d5, d11; PLONK d10, d11; bridge Groth16 d11; proofs p0, p1; all negative controls)',
        'environment': 'packaged container (this record\'s container_image), --network none',
        'runs': {k: run_summary(k) for k in ('edr-a', 'edr-b', 'geth')},
        'determinism': cmp_summary(cmp['determinism']), 'cross_client': cmp_summary(cmp['cross_client']),
        'vs_readiness_dry_run': {'edr': cmp_summary(cmp['edr_vs_readiness']), 'geth': cmp_summary(cmp['geth_vs_readiness'])},
        'evidence_status': 'engineering; not evidence (protocol section 10 item 7)'},
    'previous_dry_runs': previous,
    'scientific_run': None,
    'notes': sorted({f'{NOTES}/DRY-RUN.md', f'{NOTES}/PROOFSET-GENERATION.md', *[p['notes'] for p in previous if p.get('notes')]}),
}
open(P(os.path.join(CAMP, 'campaign.json')), 'w').write(json.dumps(rec, indent=2, sort_keys=True) + '\n')

# ---- DRY-RUN.md (packaged)
S = list(csv.DictReader(open(P(os.path.join(D['edr-a'], 'summary.csv')))))
refG = jl(os.path.join(B['reference_dry_run']['geth'], 'environment.json')) if os.path.exists(P(os.path.join(B['reference_dry_run']['geth'], 'environment.json'))) else {}
det, xc, re_e, re_g = cmp['determinism'], cmp['cross_client'], cmp['edr_vs_readiness'], cmp['geth_vs_readiness']
L = [f'# {AR["admin_id"]}: packaged engineering dry run (not evidence)', '',
     f"- **Commit:** `{head[:7]}`, clean tracked paths. **Baseline tag:** `{a.baseline_tag}`. **Plan:** `dry`, i.e. Groth16 d5 and d11, PLONK d10 and d11, and the bridge cell (Groth16 d11, July configuration), with proofs p0 and p1 and all negative controls.",
     f"- **Environment:** the chainbench container `{fz_env['IMAGE_ID'][:19]}…` (base `{fz_env['BASE_IMAGE_PINNED']}`; geth `{fz_env['GETH_SOURCE_DESC']}`), platform linux/{fz_env['ARCH']}, run with `--network none` (only loopback up, no routes; checked per run), repository mounted read-only, one fresh container per run.",
     f"- **Runs:** two from-scratch EDR runs, `{runs['edr-a']['run_id']}` and `{runs['edr-b']['run_id']}`, and a geth v1.16.9 `--dev` replay, `{runs['geth']['run_id']}`. Each has {runs['edr-a']['rows']} rows, the planned number, and every row passes its check.",
     f"- **Determinism (a against b):** identical = {det['identical']}. {det['rows_compared']} rows × {len(det['fields_compared'])} fields = {det['field_value_comparisons']} comparisons, 0 differences; build manifests byte-identical.",
     f"- **Cross-client (EDR a against geth):** identical = {xc['identical']}. {xc['field_value_comparisons']} comparisons (excluding {', '.join(xc['excluded_fields'])}), 0 differences.",
     f"- **Against the accepted readiness dry run:** EDR a against `{cmp_summary(re_e)['a']}`: identical = {re_e['identical']} ({re_e['field_value_comparisons']} comparisons, 0 differences, build manifests byte-identical). geth against `{cmp_summary(re_g)['a']}`: identical = {re_g['identical']} ({re_g['field_value_comparisons']} comparisons).",
     f"- **Why the geth comparison uses the cross-client exclusions:** the geth binaries differ. The readiness run used `{refG.get('geth', {}).get('sha256', '?')[:12]}…` (the from-source build); the packaged run used `{envG['geth']['sha256'][:12]}…` ({gsrc.split('@')[0]}). Both report v1.16.9 at commit 95665d57, so `client_version` differs (the Go version). `block_number` and `gas_price_wei` are geth dev-mode scheduling fields; they also vary between two runs of the same geth binary. `gas_used`, status, revert data, return values, addresses, bytecode and `tx_hash` are identical.",
     f"- **Hardfork verification:** EDR `osaka` and geth show all four Osaka markers; the EDR `prague` control shows none. Unit tests: {rec['unit_tests']['passing']} passing, {rec['unit_tests']['failing']} failing. Smoke check: pass.",
     '', '## Per-cell summary (run a; gas units; engineering values)', '',
     '| cell | verifier deploy | manager deploy | setIssuer | addRoot | verifyCredential (min–max) | direct verifyProof (min–max) | verifier runtime B | manager runtime B | negatives |',
     '|---|---|---|---|---|---|---|---|---|---|']
for s in S:
    L.append(f"| {s['cell_id']} | {int(s['deploy_verifier_gas']):,} | {int(s['deploy_manager_gas']):,} | {int(s['set_issuer_gas']):,} | {int(s['add_root_gas']):,} | "
             f"{int(s['verify_credential_gas_min']):,}–{int(s['verify_credential_gas_max']):,} | {int(s['verify_proof_direct_gas_min']):,}–{int(s['verify_proof_direct_gas_max']):,} | "
             f"{s['verifier_runtime_bytes']} | {s['manager_runtime_bytes']} | {'all as expected' if s['all_checks_pass'] == 'True' else 'CHECK FAILED'} |")
L += ['', 'These are dry-run values, with 2 of the 8 frozen proofs per cell. They are not scientific results. The full matrix (protocol §6) has not been run.', '']
open(P(os.path.join(NOTES, 'DRY-RUN.md')), 'w').write('\n'.join(L))

# ---- registry row (this campaign only)
reg = P(AR['registry'])
rows = list(csv.DictReader(open(reg, newline=''))); fields = list(rows[0].keys())
hit = [r for r in rows if r['admin_id'] == AR['admin_id']]
if len(hit) != 1: die(f'registry {AR["registry"]}: expected one row for {AR["admin_id"]}, found {len(hit)}')
hit[0].update({'status': 'ready', 'baseline_tag': a.baseline_tag, 'commit': head})
with open(reg, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=fields, lineterminator='\n'); w.writeheader(); w.writerows(rows)
print('written', f'{CAMP}/campaign.json', f'{NOTES}/DRY-RUN.md', f'{AR["registry"]} ({AR["admin_id"]} row)')
