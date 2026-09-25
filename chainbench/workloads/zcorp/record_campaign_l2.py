#!/usr/bin/env python3
"""Administrative record of the local-EraVM evidence entry CSI-CHAIN-LOCAL-01-L2 (CHAIN-PROTOCOL-v1 section 16, A6, A7).
Identity comes from the L2 campaign binding (workloads/zcorp/campaigns/CSI-CHAIN-LOCAL-01-L2.json). Deterministic output.

Ready mode (before the scientific run):
    record_campaign_l2.py --ready --baseline-tag chain-l2-baseline-20260925
  writes <evidence_dir>/campaign.json (status ready) and the CSI-CHAIN-LOCAL-01-L2 registry row (status ready, commit =
  measurement-code commit, i.e. the commit of the accepted packaged L2 dry run); other registry rows are untouched.
  Refuses unless the L2 measurement code is unchanged since that commit, the image records agree (IMAGE.json, ARCHIVE.json,
  csi/release/CSI-CHAIN-LOCAL-01-L2/IMAGE-ARCHIVE.json), the readiness dry run was accepted and identical, and PS-01 is intact.
Scientific mode (after the full matrix):
    record_campaign_l2.py --scientific results/chain-local-l2-20260925 --baseline-tag chain-l2-baseline-20260925
  re-validates identities (anti-mixing), runs the committed derivation (scripts/analysis/derive_chain_l2.py) into a
  temporary directory, then writes campaign.json scientific_run (status validated), VALIDATION.md and the registry row.
  The tracked raw campaign directory is the only source of truth; nothing in it is modified."""
import argparse, csv, hashlib, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CB = os.path.abspath(os.path.join(HERE, '..', '..'))
REPO = os.path.abspath(os.path.join(CB, '..'))
ap = argparse.ArgumentParser()
ap.add_argument('--ready', action='store_true'); ap.add_argument('--scientific'); ap.add_argument('--baseline-tag', required=True)
ap.add_argument('--binding', default=os.path.join(HERE, 'campaigns', 'CSI-CHAIN-LOCAL-01-L2.json'))
a = ap.parse_args()

def P(p): return p if os.path.isabs(p) else os.path.join(REPO, p)
def sha(p): return hashlib.sha256(open(P(p), 'rb').read()).hexdigest()
def git(*x): return subprocess.run(['git', '-C', REPO, *x], capture_output=True, text=True, check=True).stdout.strip()
def jl(p): return json.load(open(P(p)))
def die(msg): sys.exit(f'record_campaign_l2: REFUSED: {msg}')
def wjson(p, obj): open(P(p), 'w').write(json.dumps(obj, indent=2, sort_keys=True) + '\n')

B = jl(a.binding); AR = B['admin_record']; ADMIN = AR['admin_id']; EV = B['evidence_dir']; PROTO = B['protocol']; REL = B['release_dir']
MCODE = B['measurement_code_paths']; PSD = B['proofset_dir']
ADAPTER = 'chainbench/adapters/eravm'
READY_DRY = 'dry-l2-3e0f6c8-20260925T125852Z'
ENV_LABEL = ('EraVM execution under protocol v29 (anvil-zksync 0.6.11 built-in v29 system contracts; bootloader and default-account '
             'hashes differ from live Era Sepolia; no EVM emulator; fixed local fee input)')

def registry_row(update):
    reg = P(AR['registry'])
    rows = list(csv.DictReader(open(reg, newline=''))); fields = list(rows[0].keys())
    hit = [x for x in rows if x['admin_id'] == ADMIN]
    if len(hit) > 1: die('registry: more than one L2 row')
    if not hit:
        rows.append({f: '' for f in fields}); hit = [rows[-1]]
    hit[0].update(update)
    with open(reg, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator='\n'); w.writeheader(); w.writerows(rows)

def identities():
    """Shared identity block: protocol, image, toolchain, proof set, classification, readiness evidence."""
    img = jl(f'{ADAPTER}/IMAGE.json'); arc = jl(f'{ADAPTER}/ARCHIVE.json'); rel = jl(f'{REL}/IMAGE-ARCHIVE.json')
    pins = dict(re.findall(r'^([A-Z0-9_]+)="(.*)"$', open(P(f'{ADAPTER}/pins.env')).read(), re.M))
    ent = rel['images'][0]
    if not rel['checks_pass'] or ent['image_id'] != arc['image_id'] or ent['archive']['sha256'] != arc['archive_sha256']: die('release IMAGE-ARCHIVE.json disagrees with ARCHIVE.json')
    if img['container']['image_id'] != arc['image_id']: die('IMAGE.json was not recorded in the archived image')
    for k, pin in (('anvil_zksync', 'ANVIL_ZKSYNC_BIN_SHA256_ARM64'), ('zksolc', 'ZKSOLC_SHA256_ARM64'), ('era_solc', 'ERA_SOLC_SHA256_ARM64')):
        if not (ent['binaries_sha256'][k] == pins[pin] == img['toolchain'][k]['sha256']): die(f'{k}: archived binary != pin != IMAGE.json')
    obs = B['live_observation']
    proto_txt = open(P(PROTO)).read()
    return {
        'environment_label': ENV_LABEL,
        'classification': {'class': 'B (bounded)', 'record': f'{EV}/observation/CLASSIFICATION.md', 'record_sha256': sha(f'{EV}/observation/CLASSIFICATION.md'),
                           'live_observation': {'dir': obs, 'sha256sums_sha256': sha(f'{obs}/SHA256SUMS'), 'utc': '2026-09-25T12:11:16Z..12:11:25Z',
                                                'endpoint': 'https://sepolia.era.zksync.dev (ZKsync Era Sepolia official public RPC)', 'method': '12 read-only JSON-RPC calls; no transaction, key or account',
                                                'live_protocol': jl(f'{obs}/protocolVersion.json')['result']['minorVersion'],
                                                'live_base_system_contracts': jl(f'{obs}/protocolVersion.json')['result']['base_system_contracts']},
                           'local': {'protocol_version': 29, 'node': 'anvil-zksync 0.6.11 (offline, built-in v29 system contracts)',
                                     'bootloader': '0x0100092f045c41c21bd08a9c6fa909fa6a8b446e3f6cd9f08356352a3195a40c',
                                     'default_aa': '0x010005f74935e95e527d18ea9bfc82906fb20903a5683c528ee7af404e9bd531', 'evm_emulator': None}},
        'protocol': {'path': PROTO, 'version': 'v1', 'sha256': sha(PROTO), 'amendments': re.findall(r'^\| (A\d+) \|', proto_txt, re.M),
                     'l2_sections': '15.1 (A6), 16 (16.9: A7)', 'l1_prefix_rule': 'the protocol of the L1 campaign commit is a byte prefix of this file'},
        'image': {'image_id': arc['image_id'], 'platform': arc['platform'], 'role': arc['role'], 'archive': ent['archive']['file'],
                  'archive_sha256': arc['archive_sha256'], 'archive_bytes': arc['archive_bytes'], 'archive_record': f'{REL}/IMAGE-ARCHIVE.json',
                  'archive_record_sha256': sha(f'{REL}/IMAGE-ARCHIVE.json'), 'host_record': f'{ADAPTER}/ARCHIVE.json', 'host_record_sha256': sha(f'{ADAPTER}/ARCHIVE.json'),
                  'identity_record': f'{ADAPTER}/IMAGE.json', 'identity_record_sha256': sha(f'{ADAPTER}/IMAGE.json'), 'base_image': arc['base_image'],
                  'binaries_sha256_in_archive': ent['binaries_sha256'], 'versions': ent['versions'], 'rebuilt': False,
                  'lockfile': f'{ADAPTER}/package-lock.json', 'lockfile_sha256': sha(f'{ADAPTER}/package-lock.json'), 'pins': f'{ADAPTER}/pins.env', 'pins_sha256': sha(f'{ADAPTER}/pins.env'),
                  'rule': 'full-local-l2 runs only in this archived linux/arm64 image (host check + pre/post-flight doctor --require-archived-image)'},
        'proofset': {'id': 'PS-01', 'dir': PSD, 'csv_sha256': sha(f'{PSD}/PROOFSET.csv'), 'sha256_file_sha256': sha(f'{PSD}/PROOFSET.sha256'),
                     'json_sha256': sha(f'{PSD}/PROOFSET.json'), 'files': len(open(P(f'{PSD}/PROOFSET.sha256')).read().split('\n')) - 1,
                     'k_per_cell': 8, 'owner': 'CSI-CHAIN-LOCAL-01 (reused unchanged; never regenerated)'},
        'plan': {'cells': [f'primary-{b}-d{d}' for b in ('groth16', 'plonk') for d in (5, 10, 11, 15)], 'proofs': list(range(8)), 'rows_per_run': 288, 'tx_per_run': 200,
                 'runs': 'a and b, each from scratch in a fresh container, a fresh EraVM node per cell, --network none'},
        'fee_input': {'base_fee': 45250000, 'fair_l2_gas_price': 45250000, 'fair_pubdata_price': 3784558330, 'gas_per_pubdata': 84,
                      'origin': 'fixed by anvil-zksync 0.6.11 without a fork (protocol 16.2)'},
        'derivation': {'tool': 'scripts/analysis/derive_chain_l2.py', 'tool_sha256': sha('scripts/analysis/derive_chain_l2.py'),
                       'fixed_before_the_scientific_run': True, 'tested_on': f'readiness dry run {READY_DRY} (not scientific data)'},
    }


def readiness():
    R = f'{EV}/readiness'
    ra = jl(f'{R}/{READY_DRY}/run-a/run.json'); rb = jl(f'{R}/{READY_DRY}/run-b/run.json')
    va = jl(f'{R}/{READY_DRY}/run-a/validation.json'); vb = jl(f'{R}/{READY_DRY}/run-b/validation.json')
    cmp_ = jl(f'{R}/{READY_DRY}/run-b/compare_determinism.json')
    if not (ra['accepted_checks'] and rb['accepted_checks'] and va['pass'] and vb['pass'] and cmp_['identical']): die('readiness dry run not accepted/identical')
    smokes = {}
    for d in sorted(os.listdir(P(f'{R}/smoke'))):
        s = jl(f'{R}/smoke/{d}/smoke_check.json'); r = jl(f'{R}/smoke/{d}/run.json'); e = jl(f'{R}/smoke/{d}/environment.json')
        smokes[d] = {'pass': s['pass'], 'reference_present': s['reference_present'], 'arch': e['host']['arch'], 'image_id': (e.get('container') or {}).get('image_id'),
                     'rows': r['rows'], 'accepted_checks': r['accepted_checks']}
    return {'measurement_code_commit': ra['commit'], 'dry_run': {'id': READY_DRY, 'plan': 'dry (Groth16 d5, d11; PLONK d10, d11; p0, p1; all negative controls)',
            'rows_per_run': ra['rows'], 'tx_per_run': ra['tx_rows'], 'validation_rules': [va['rules'], vb['rules']], 'identical': cmp_['identical'],
            'field_value_comparisons': cmp_['field_value_comparisons'], 'build_manifest_sha256': cmp_['build_manifest']['sha256_a'],
            'image_id': jl(f'{R}/{READY_DRY}/run-a/environment.json')['container']['image_id'], 'records': f'{R}/{READY_DRY}', 'evidence_status': 'engineering; not scientific data'},
            'smoke': smokes, 'smoke_reference': 'chainbench/workloads/zcorp/smoke-reference-l2.csv', 'smoke_reference_sha256': sha('chainbench/workloads/zcorp/smoke-reference-l2.csv'),
            'portability': {'linux/amd64': 'emulated doctor-l2 and smoke-l2 equal to the reference (not scientific data)',
                            'identity': f'{R}/image/identity-amd64.json'}, 'notes': f'{EV}/notes/READINESS-L2.md'}


def ready():
    rd = readiness(); mcc = rd['measurement_code_commit']
    if git('diff', '--name-only', mcc, '--', *MCODE) or git('status', '--porcelain', '--', *MCODE): die(f'measurement code changed since {mcc[:7]}')
    changed = sorted(set(git('diff', '--name-only', mcc, '--', *B['measurement_paths']).split('\n')) - {''})
    rec = {'admin_id': ADMIN, 'venue': B['venue'], 'experiment': AR['experiment'], 'status': 'ready', 'used_in_manuscript': 'no',
           'arm': B['arm'], 'study': B['campaign_id'], 'parent_entry': {'admin_id': 'CSI-CHAIN-LOCAL-01', 'status': 'validated (L1 arm; unchanged)',
                                                                        'baseline_tag': 'chain-l1-baseline-20260925'},
           'stage': f'ready: final freeze of the local-EraVM arm; scientific L2 run not started; baseline tag {a.baseline_tag} (to be created on the commit that adds this record)',
           'harness': {'commit': mcc, 'path': ADAPTER, 'binding': os.path.relpath(P(a.binding), CB), 'reviewer_entry_point': 'chainbench/run.sh doctor-l2 | smoke-l2 | full-local-l2',
                       'reviewer_readme': f'{ADAPTER}/README.md'},
           'baseline': {'tag': a.baseline_tag, 'tagged_commit': 'the commit that adds this record (git rev-parse chain-l2-baseline-20260925^{commit}); scientific run.json commit must equal it',
                        'measurement_paths': B['measurement_paths'], 'image_records': B['image_records']},
           'commits': {'measurement_code_commit': mcc, 'measurement_code_paths': MCODE, 'measurement_code_unchanged_in_record_worktree': True,
                       'measurement_code_commit_meaning': B['commit_semantics']['measurement_code_commit'], 'baseline_commit_meaning': B['commit_semantics']['baseline_commit'],
                       'changed_after_measurement_code_commit_outside_measurement_code': changed,
                       'why_outside': 'protocol amendment A7 (administrative), records, host orchestration (run-l2.sh image refusal, doctor record fields), release and analysis tooling; none is on the per-row measurement path'},
           'readiness': rd, 'records': {'dir': EV, 'release_dir': REL, 'results_dir': B['results_dir'], 'code_manifest': f'csi/code/chain/{ADMIN}.KIT.sha256'},
           **identities()}
    wjson(f'{EV}/campaign.json', rec)
    registry_row({'venue': B['venue'], 'admin_id': ADMIN, 'experiment': AR['experiment'], 'status': 'ready', 'used_in_manuscript': 'no', 'campaign_id': '-',
                  'source_path': '-', 'baseline_tag': a.baseline_tag, 'commit': mcc, 'protocol_version': 'v1', 'protocol_path': PROTO})
    print('written', f'{EV}/campaign.json', f'{AR["registry"]} ({ADMIN}: ready, commit {mcc[:7]}, tag {a.baseline_tag})')


def scientific():
    src = a.scientific.rstrip('/')
    dirs = sorted(d for d in os.listdir(P(src)) if os.path.isdir(P(os.path.join(src, d))))
    cid = sorted({re.sub(r'-(a|b)$', '', d) for d in dirs})
    if len(cid) != 1 or set(dirs) != {f'{cid[0]}-a', f'{cid[0]}-b'}: die(f'{src}: expected one campaign with runs a and b, found {dirs}')
    cid = cid[0]
    D = {k: os.path.join(src, f'{cid}-{k}') for k in ('a', 'b')}
    runs = {k: jl(os.path.join(d, 'run.json')) for k, d in D.items()}; envs = {k: jl(os.path.join(d, 'environment.json')) for k, d in D.items()}
    rec = jl(f'{EV}/campaign.json')
    tag = a.baseline_tag; tag_commit = git('rev-parse', f'{tag}^{{commit}}'); tag_object = git('rev-parse', tag)
    if git('cat-file', '-t', tag) != 'tag': die(f'{tag} is not an annotated tag')
    mcc = rec['commits']['measurement_code_commit']
    for k, r in runs.items():
        if r['plan'] != 'full' or not r.get('scientific'): die(f'{k}: plan {r["plan"]} is not the scientific plan')
        if r['commit'] != tag_commit: die(f'{k}: run commit {r["commit"]} != baseline tag commit {tag_commit}')
        if r['dirty_tracked_paths']: die(f'{k}: dirty tracked paths {r["dirty_tracked_paths"]}')
        if r.get('accepted_checks') is not True: die(f'{k}: runner checks not accepted')
        if r.get('campaign_id') != B['campaign_id'] or r.get('arm') != B['arm']: die(f'{k}: campaign {r.get("campaign_id")} arm {r.get("arm")}')
    if git('diff', '--name-only', mcc, tag_commit, '--', *MCODE): die(f'measurement code changed between {mcc[:7]} and the baseline {tag_commit[:7]}')
    for f in ('scripts/analysis/derive_chain_l2.py', f'{ADAPTER}/ARCHIVE.json', f'{ADAPTER}/IMAGE.json', PROTO):
        if git('diff', '--name-only', tag_commit, '--', f): die(f'{f} changed after the baseline tag')
    arc = json.loads(git('show', f'{tag_commit}:{ADAPTER}/ARCHIVE.json'))
    for k, e in envs.items():
        c = e.get('container') or {}
        if c.get('image_id') != arc['image_id']: die(f'{k}: image {c.get("image_id")} is not the archived image {arc["image_id"]}')
        if (c.get('network_isolation') or {}).get('isolated') is not True or c.get('network') != 'none': die(f'{k}: network isolation not established')
    proto_sha = hashlib.sha256(subprocess.run(['git', '-C', REPO, 'show', f'{tag_commit}:{PROTO}'], capture_output=True, check=True).stdout).hexdigest()
    if sha(PROTO) != proto_sha: die('the protocol changed after the baseline tag')
    for k, r in runs.items():
        if r['protocol_sha256'] != proto_sha: die(f'{k}: protocol sha256 {r["protocol_sha256"]} != protocol at the baseline')
    pre = jl(os.path.join(src, f'{cid}.preflight.json')); post = jl(os.path.join(src, f'{cid}.postflight.json'))
    for n, d in (('pre-flight', pre), ('post-flight', post)):
        if d['fails'] != 0 or d.get('head') != tag_commit: die(f'{n}: fails {d["fails"]}, head {d.get("head")}')
    tmp = tempfile.mkdtemp(prefix='chain-l2-derive-')
    cmd = [sys.executable, P('scripts/analysis/derive_chain_l2.py'), '--campaign', P(src), '--out', tmp, '--repo', REPO, '--plan', 'full',
           '--expect-campaign-id', cid, '--expect-commit', tag_commit, '--expect-tag', tag, '--expect-image-id', arc['image_id'], '--expect-protocol-sha256', proto_sha]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: die(f'derivation checks failed: {r.stderr.strip()}')
    val = json.load(open(os.path.join(tmp, 'validation.json'))); dmeta = json.load(open(os.path.join(tmp, 'derivation.json')))
    if val.get('passed') is not True: die('validation.json: not passed')
    ch = val['checks']
    vrules = sorted({re.sub(r'^[ab]_', '', k) for k in ch if re.match(r'^[ab]_V\d+_', k)}, key=lambda s: int(re.match(r'V(\d+)', s).group(1)))
    def runsum(k):
        x = runs[k]
        return {'run_id': x['run_id'], 'rows': x['rows'], 'rows_expected': x['rows_expected'], 'tx_rows': x['tx_rows'], 'tx_expected': x['tx_expected'],
                'rows_failing_check': x['rows_failing_check'], 'tx_failing_accounting': x['tx_failing_accounting'], 'deployments_bytecode_match': x['deployments_bytecode_match'],
                'env_check_pass': x['env_check_pass'], 'ops_csv_sha256': x['ops_csv_sha256'], 'build_output_sha256': x['build_output_sha256'],
                'started_at_utc': x['started_at_utc'], 'finished_at_utc': x['finished_at_utc'], 'dir': D[k]}
    sr = {'campaign_id': cid, 'source_path': src, 'source_manifest': f'{EV}/SOURCE.sha256',
          'produced_at': 'build/campaigns/chain-l2/ (protocol 16.5); moved unchanged to the tracked source_path, which is the only source of truth',
          'baseline_tag': tag, 'baseline_tag_object': tag_object, 'baseline_commit': tag_commit, 'measurement_code_commit': mcc,
          'measurement_code_identical_at_baseline': True, 'raw_row_commit_field': f'run.json "commit" of both runs = {tag_commit} (the baseline commit)',
          'protocol_sha256_at_baseline': proto_sha, 'image_id': arc['image_id'], 'image_archive_sha256': arc['archive_sha256'], 'environment_label': ENV_LABEL,
          'runs': {k: runsum(k) for k in ('a', 'b')},
          'preflight': {'file': os.path.join(src, f'{cid}.preflight.json'), 'fails': pre['fails'], 'head': pre['head']},
          'postflight': {'file': os.path.join(src, f'{cid}.postflight.json'), 'fails': post['fails'], 'head': post['head']},
          'validation': {'passed': True, 'checks': f"{sum(1 for c in ch.values() if c['pass'])}/{len(ch)}", 'rules_per_run': vrules,
                         'determinism_field_comparisons': ch['determinism_rows_identical']['comparisons'], 'file': f'{EV}/derived/validation.json', 'summary': f'{EV}/VALIDATION.md'},
          'derived': {'dir': f'{EV}/derived', 'tool': dmeta['tool'], 'tool_sha256': dmeta['tool_sha256'], 'outputs_sha256': dmeta['outputs_sha256'],
                      'rule': 'generated by scripts/release/build_csi_bundle.py from the tracked raw campaign; --check regenerates them byte for byte'},
          'release': {'dir': REL, 'manifest': f'{REL}/RELEASE.sha256', 'archives': [f'campaign-{cid}.tar', f'code-{tag_commit[:7]}.tar', 'image/chainbench-l2-arm64.oci.tar'],
                      'versioned': 'no (Zenodo deposit); their sha256 are in RELEASE.sha256'},
          'evidence_status': 'scientific; accepted (protocol 16.6)'}
    rec['scientific_run'] = sr; rec['status'] = 'validated'
    rec['stage'] = f'scientific L2 matrix run and validated ({cid}); baseline tag {tag} at {tag_commit[:7]}'
    wjson(f'{EV}/campaign.json', rec)
    R0 = runs['a']
    L = [f'# {ADMIN}: validation of the scientific local-EraVM campaign `{cid}`', '',
         f'- **Arm:** the local-EraVM arm of CSI-CHAIN-LOCAL-01 (CHAIN-PROTOCOL-v1 §16, A6, A7). Environment label: *{ENV_LABEL}*.',
         f'- **Source (only source of truth):** `{src}/`, frozen by `SOURCE.sha256`. Produced by `./chainbench/run.sh full-local-l2` at the baseline tag `{tag}` (`{tag_commit[:7]}`).',
         f'- **Measurement code:** identical to `{mcc[:7]}`, the commit of the accepted packaged L2 dry run (`measurement_code_paths` of the L2 binding).',
         f'- **Environment:** archived image `{arc["image_id"]}` ({arc["platform"]}; `docker save` sha256 `{arc["archive_sha256"]}`), `--network none`; anvil-zksync 0.6.11, zksolc 1.5.15, era-solc 0.8.20-1.0.2 (sha256-pinned).',
         f'- **Protocol:** CHAIN-PROTOCOL-v1 with amendments {", ".join(rec["protocol"]["amendments"])}, sha256 `{proto_sha[:16]}…`.',
         f'- **Rows:** {R0["expected_rows"]} per run ({R0["expected_tx"]} transactions), as planned (8 cells × 36 rows; K = 8).', '',
         '| Criterion (§16.6) | Result |', '|---|---|',
         f'| V1–V13 (re-evaluated by `derive_chain_l2.py` for runs a and b) | pass: {", ".join(vrules)} |',
         f'| Runner acceptance | both runs accepted; 0 failing rows; 0 transactions failing fee accounting; deployments = compiled bytecode |',
         f'| Fee accounting | every transaction has exactly one node fee record; receipt `gasUsed` reproduced exactly from computational gas, pubdata bytes and the fixed fee input |',
         f'| Determinism (run a vs b, from scratch) | identical: {ch["determinism_rows_identical"]["comparisons"]} field comparisons, 0 differences; build manifests byte-identical; environment probes identical |',
         '| Pre-flight / post-flight doctor-l2 | 0 FAIL / 0 FAIL; head = baseline commit; archived image in use; L2 baseline tag; no network; PS-01 intact |',
         f'| Anti-mixing | both run.json commits = {tag_commit[:7]} = tag; one image; one protocol; proof-set manifest = committed PS-01 |',
         '', f'All {sr["validation"]["checks"]} checks of `derived/validation.json` pass. Derived outputs: `derived/` (`scripts/analysis/derive_chain_l2.py`), in EraVM units only.', '']
    open(P(f'{EV}/VALIDATION.md'), 'w').write('\n'.join(L))
    registry_row({'status': 'validated', 'campaign_id': cid, 'source_path': src, 'baseline_tag': tag, 'commit': tag_commit})
    print('written', f'{EV}/campaign.json', f'{EV}/VALIDATION.md', f'{AR["registry"]} ({ADMIN} row: validated, {cid}, {tag_commit[:7]})')


if a.scientific:
    scientific()
elif a.ready:
    ready()
else:
    die('use --ready or --scientific <dir>')
