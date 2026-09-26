#!/usr/bin/env python3
"""Administrative record of the evidence entry CSI-CHAIN-PUBLIC-01 (CHAIN-PUBLIC-PROTOCOL-v1 section 16).
Deterministic output; identity from the campaign binding.

    record_campaign_public.py --planned --harness-commit <sha> --dry-run <readiness dir>
                              [--measurement-code-commit <sha>] [--record NAME=PATH ...]
    record_campaign_public.py --ready --harness-commit <sha> --dry-run <readiness dir> --measurement-code-commit <sha>
                              --results-label <D> --funded-doctor <doctor-public report> [--record NAME=PATH ...]
    record_campaign_public.py --check-funded-doctor <doctor-public report>     (the --ready funding gate alone; writes nothing)
writes csi/campaigns/chain/CSI-CHAIN-PUBLIC-01/campaign.json (status planned) and the CSI-CHAIN-PUBLIC-01 row of
csi/campaign-index.csv (status planned, commit = the harness commit); other registry rows are untouched. Refuses unless
the harness commit contains the adapter, binding, protocol and frozen inputs exactly as in the working tree, the inputs
verify, and the engineering dry run recorded under --dry-run passed every expectation. With --measurement-code-commit it
also refuses unless the measurement code (MEASUREMENT_CODE_PATHS) is byte-identical between that commit and the harness
commit, and records the frozen public image (adapters/public/ARCHIVE.json, chain re-verified), the frozen endpoints, the
author inputs still open and the listed engineering records (--record NAME=PATH, sha256 only), and the dedicated signer's
public address (binding key.signer_address; never a key). A dry run made at an earlier commit is accepted only if the
measurement code, the image record and the binding (apart from key.signer_address, key.signer_note and results_dir) are identical there.
--ready (the baseline commit, before the annotated tag chain-public-baseline-<D> is created on it) also requires every
author input: results_dir = results/chain-public-<D>, the signer address, and a live read-only doctor-public report run
with the key that passes the funding gate below, and writes status ready. The scientific stage is added when it is reached.
Funding gate (D5; --ready and --check-funded-doctor): a live report (not --offline) with no FAIL, run in the frozen image by
the wrapper with the tracked paths clean; its signer is exactly the binding's key.signer_address; for each network the
observation used the frozen primary endpoint (label, scheme, host, URL sha256; no URL recorded for a non-public endpoint),
the chain id of the profile, and read the signer's balance and nonces successfully: balance >= FUNDING_TARGET_WEI (the
author-approved targets) and latest = pending nonce = 0 (the signer has sent nothing before setup)."""
import argparse, csv, hashlib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
BIND = 'chainbench/workloads/zcorp/campaigns/CSI-CHAIN-PUBLIC-01.json'
ap = argparse.ArgumentParser()
st = ap.add_mutually_exclusive_group(required=True)
st.add_argument('--planned', action='store_true'); st.add_argument('--ready', action='store_true')
st.add_argument('--check-funded-doctor', metavar='REPORT')
ap.add_argument('--harness-commit'); ap.add_argument('--dry-run')
ap.add_argument('--measurement-code-commit'); ap.add_argument('--record', action='append', default=[])
ap.add_argument('--results-label'); ap.add_argument('--funded-doctor')
a = ap.parse_args()
if not a.check_funded_doctor and not (a.harness_commit and a.dry_run):
    ap.error('--planned and --ready need --harness-commit and --dry-run')


def P(p): return p if os.path.isabs(p) else os.path.join(REPO, p)
def sha(p): return hashlib.sha256(open(P(p), 'rb').read()).hexdigest()
def git(*x): return subprocess.run(['git', '-C', REPO, *x], capture_output=True, text=True, check=True).stdout.strip()
def die(m): sys.exit(f'record_campaign_public: REFUSED: {m}')


# the code that measures (runs, signs, sends, records, validates) and makes the image and the key; outside it: the binding's
# author fields, the image record, this registration script, the engineering tests and the read-only probe, READMEs, records
_S = 'chainbench/adapters/public/scripts/'
MEASUREMENT_CODE_PATHS = ['contracts', 'chainbench/core', 'chainbench/lib/constants.js', 'chainbench/adapters/eravm/lib/constants.js',
                          'chainbench/adapters/public/lib', *[_S + f for f in ('run_public.js', 'doctor_public.js', 'collect_era_finality.js', 'dry_run_public.js',
                                                                               'mock_rpc.js', 'check_public_inputs.py', 'build_public_inputs.js')],
                          *['chainbench/adapters/public/tools/' + f for f in ('new_public_key.sh', 'verify_public_key.sh', 'image_record.py')],
                          'chainbench/adapters/public/run-public.sh', 'chainbench/adapters/public/Dockerfile', 'chainbench/adapters/public/package.json',
                          'chainbench/adapters/public/package-lock.json', 'chainbench/adapters/public/pins.env', 'chainbench/workloads/zcorp/public',
                          'chainbench/run.sh', 'csi/protocols/chain/CHAIN-PUBLIC-PROTOCOL-v1.md', 'csi/campaigns/chain/CSI-CHAIN-PUBLIC-01/inputs',
                          'csi/campaigns/chain/CSI-CHAIN-LOCAL-01/inputs/proofset', 'scripts/analysis/derive_chain_public.py']
B = json.load(open(P(BIND)))
AR = B['admin_record']; EV = B['evidence_dir']
# D5: the author-approved funding targets (final pre-flight decisions, 2026-09-25), in wei of test ether
FUNDING_TARGET_WEI = {'sepolia': 200000000000000000, 'era-sepolia': 10000000000000000}


def frozen_image_id():
    r = subprocess.run(['node', '-e', "const I=require('./adapters/public/lib/imageid');const r=I.loadRecord();console.log(JSON.stringify(r))"], cwd=P('chainbench'), capture_output=True, text=True)
    if r.returncode:
        die(f'the frozen image record does not verify: {r.stderr.strip()[:200]}')
    return json.loads(r.stdout)


def funded_doctor_gate(path, SG, image_id):
    """The --ready funding gate (D5). Returns the funded state per network or refuses."""
    if not SG:
        die('the binding has no key.signer_address')
    doc = json.load(open(P(path)))
    res = doc.get('results') or []
    if doc.get('offline') is not False or not res:
        die('the funded doctor report is not a live doctor-public report (offline, or mode unknown)')
    fails = [x.get('check') for x in res if x.get('status') == 'FAIL']
    if fails:
        die(f'the funded doctor report has {len(fails)} FAIL: {fails[:3]}')
    if doc.get('signer_address') != SG:
        die(f"the funded doctor's signer is {doc.get('signer_address')}, not exactly the frozen {SG}")
    for chk in ('tracked paths clean', 'image used by this doctor = the frozen public image'):
        if not any(x.get('check') == chk and x.get('status') == 'PASS' for x in res):
            die(f'the funded doctor report does not show PASS for "{chk}"')
    im = doc.get('image') or {}
    if im.get('image_id') != image_id or im.get('verified_by_wrapper') != 'pass':
        die('the funded doctor did not run in the frozen public image verified by the wrapper')
    obs = doc.get('observations') or {}
    state = {}
    for n in B['networks']:
        o = obs.get(n)
        fz = B['endpoints']['frozen'][n]
        if not o:
            die(f'the funded doctor has no observation of {n}')
        ep = o.get('endpoint') or {}
        if any(ep.get(k) != fz[k] for k in ('label', 'scheme', 'host', 'url_sha256')):
            die(f'{n}: the funded doctor did not use the frozen primary endpoint ({ep.get("label")}, {ep.get("host")}, {str(ep.get("url_sha256"))[:12]}…)')
        if fz.get('url') is None and ep.get('url') is not None:
            die(f'{n}: the report records the URL of a non-public endpoint')
        if o.get('signer_address') != SG:
            die(f'{n}: the observation is not of the frozen signer')
        calls = {c.get('name'): c for c in o.get('calls') or []}

        def val(name, params=None):
            c = calls.get(name)
            if not c or not c.get('ok'):
                die(f'{n}: the funded doctor has no successful {name} call')
            if params is not None and [str(x).lower() for x in c.get('params') or []] != [str(x).lower() for x in params]:
                die(f'{n}: {name} was not queried for the frozen signer ({c.get("params")})')
            return int(json.loads(c['response_raw'])['result'], 16)
        cid = val('chainId')
        if cid != B['networks'][n]['chain_id']:
            die(f'{n}: chain id {cid}, expected {B["networks"][n]["chain_id"]}')
        wei, nl, npd = val('balance', [SG, 'latest']), val('nonceLatest', [SG, 'latest']), val('noncePending', [SG, 'pending'])
        if wei < FUNDING_TARGET_WEI[n]:
            die(f'{n}: signer balance {wei} wei is below the approved target {FUNDING_TARGET_WEI[n]} wei')
        if nl != 0 or npd != 0:
            die(f'{n}: signer nonce latest {nl}, pending {npd}; the signer must not have sent any transaction before setup (nonce 0 required)')
        state[n] = {'chain_id': cid, 'balance_wei': str(wei), 'target_wei': str(FUNDING_TARGET_WEI[n]), 'nonce_latest': nl, 'nonce_pending': npd,
                    'endpoint': {k: ep.get(k) for k in ('label', 'scheme', 'host', 'url_sha256')}, 'observation_id': o.get('observation_id'),
                    'observed_utc': [o.get('started_utc'), o.get('finished_utc')]}
    return state


if a.check_funded_doctor:
    st_ = funded_doctor_gate(a.check_funded_doctor, B['key'].get('signer_address'), frozen_image_id()['image_id'])
    print(json.dumps({'funded_doctor': os.path.relpath(P(a.check_funded_doctor), REPO), 'sha256': sha(a.check_funded_doctor),
                      'signer_address': B['key']['signer_address'], 'gate': 'PASS', 'networks': st_}, indent=1, sort_keys=True))
    sys.exit(0)
hc = git('rev-parse', a.harness_commit + '^{commit}')
paths = ['chainbench/adapters/public', 'chainbench/workloads/zcorp/public', BIND, B['protocol'], B['inputs_dir'], 'scripts/analysis/derive_chain_public.py', 'chainbench/run.sh']
changed = git('diff', '--name-only', hc, '--', *paths) + git('ls-files', '--others', '--exclude-standard', '--', *paths)
if changed:
    die(f'the harness commit {hc[:7]} does not contain the working-tree harness: {changed.splitlines()[:5]}')
man = open(P(os.path.join(B['inputs_dir'], 'INPUTS.sha256'))).read()
for l in man.strip().split('\n'):
    h, f = l.split()
    if sha(os.path.join(B['inputs_dir'], f)) != h:
        die(f'frozen input changed: {f}')
idn = json.load(open(P(os.path.join(B['inputs_dir'], 'IDENTITY.json'))))
if not idn['all_pass']:
    die('IDENTITY.json reports a failed identity check')
dry = P(a.dry_run)
S = json.load(open(os.path.join(dry, 'SUMMARY.json')))
if not S['all_pass']:
    die(f"dry run {S['dry_id']}: not every expectation passed")
AUTHOR_ONLY = (('key', 'signer_address'), ('key', 'signer_note'), ('results_dir',))


def binding_without_author_only(commit):
    b = json.loads(git('show', f'{commit}:{BIND}'))
    for path in AUTHOR_ONLY:
        o = b
        for k in path[:-1]:
            o = o.get(k, {})
        o.pop(path[-1], None)
    return b


dry_reuse = None
if S['commit'] != hc:
    dc = git('rev-parse', S['commit'] + '^{commit}')
    d = git('diff', '--name-only', dc, hc, '--', *MEASUREMENT_CODE_PATHS, 'chainbench/adapters/public/ARCHIVE.json')
    if d or binding_without_author_only(dc) != binding_without_author_only(hc):
        die(f"dry run {S['dry_id']} was made at {dc[:7]}: measurement code, image record or binding (apart from key.signer_address, key.signer_note, results_dir) differ from the harness commit {hc[:7]}")
    dry_reuse = {'dry_run_commit': dc, 'harness_commit': hc,
                 'rule': 'accepted: the measurement code, the image record and the binding apart from key.signer_address, key.signer_note and results_dir are identical at both commits'}
steps = sorted({r['step'] for r in S['results']})
if steps != ['faults', 'normal', 'refusals', 'units']:
    die(f'dry run incomplete: steps {steps}')
sched = json.loads(subprocess.run(['node', '-e', "const P=require('./adapters/public/lib/plan');const b=require('./workloads/zcorp/campaigns/CSI-CHAIN-PUBLIC-01.json');"
                                   "const p=require('./workloads/zcorp/public/procedure.json');console.log(JSON.stringify(P.schedule(b,p)))"],
                                  cwd=P('chainbench'), capture_output=True, text=True, check=True).stdout)
blocks = [{'session': s['id'], 'network': b['network'], 'order': [f"{o['schedule_id']}:{o['proof_id']}" for o in b['ops']]} for s in sched['sessions'] for b in s['blocks']]
mcc = None
if a.measurement_code_commit:
    mcc = git('rev-parse', a.measurement_code_commit + '^{commit}')
    d = git('diff', '--name-only', mcc, hc, '--', *MEASUREMENT_CODE_PATHS)
    if d:
        die(f'measurement code differs between {mcc[:7]} and the harness commit {hc[:7]}: {d.splitlines()[:5]}')
image = None
arc = P('chainbench/adapters/public/ARCHIVE.json')
if os.path.exists(arc):
    ir = frozen_image_id()
    image = {k: ir[k] for k in ('image_id', 'manifest_digest', 'config_digest', 'attestation_manifest_digest', 'platform', 'architecture', 'base_image',
                                'archive', 'archive_bytes', 'archive_sha256', 'rootfs_layers', 'provenance', 'built_utc', 'saved_utc', 'docker_client', 'docker_engine')}
    image['record'] = 'chainbench/adapters/public/ARCHIVE.json'; image['record_sha256'] = sha('chainbench/adapters/public/ARCHIVE.json')
    image['rule'] = 'live commands run only in this image (CHAIN-PUBLIC-PROTOCOL-v1 section 13.1); verified before and after every live command'
SG = B['key'].get('signer_address')
signer = None
if SG:
    r = subprocess.run(['node', '-e', "const {ethers}=require('./adapters/public/node_modules/ethers');const K=require('./adapters/public/lib/keysafety');"
                        "const a=process.argv[1];const c=ethers.getAddress(a);if(c!==a)throw new Error('not the EIP-55 form');"
                        "if(K.devAccounts(require('path').resolve('..')).has(a.toLowerCase()))throw new Error('a development account');console.log('ok')", SG],
                       cwd=P('chainbench'), capture_output=True, text=True)
    if r.returncode or r.stdout.strip() != 'ok':
        die(f'signer address {SG} refused: {r.stderr.strip()[-200:]}')
    signer = {'address': SG, 'created_with': 'chainbench/adapters/public/tools/new_public_key.sh (author, campaign host, frozen image)',
              'verified_with': 'chainbench/adapters/public/tools/verify_public_key.sh (author; PASS)', 'checks_here': 'EIP-55 form; not one of the blocked development accounts',
              'key': 'never recorded, printed or read by any tool other than the key-safety module at run time'}
records = {}
for item in a.record:
    name, path = item.split('=', 1)
    records[name] = {'path': os.path.relpath(P(path), REPO), 'sha256': sha(path)}
EPB = B['endpoints']
open_inputs = []
if not all(s_.get('scheduled_start_utc') for s_ in B['sessions']):
    open_inputs.append('session start times (S1-S3, at least two UTC days)')
for net, lab in (('sepolia', 'Sepolia'), ('era-sepolia', 'Era Sepolia')):
    if not (EPB.get('frozen') or {}).get(net):
        open_inputs.append(f'{lab} endpoint and provider label')
if not SG:
    open_inputs.append('dedicated signing key and its address (tools/new_public_key.sh, verify_public_key.sh)')
open_inputs += ['funding on both networks, recorded by a read-only doctor-public with the key',
                'results directory date label <D> (binding results_dir)', 'public baseline commit and annotated tag chain-public-baseline-<D>']
status, baseline = 'planned', None
if a.ready:
    D = a.results_label or die('--ready needs --results-label <D>')
    tag = B['baseline_tag_prefix'] + D
    if B.get('results_dir') != f'results/chain-public-{D}':
        die(f"binding results_dir is {B.get('results_dir')}, not results/chain-public-{D}")
    if not (SG and mcc and image and all(s_.get('scheduled_start_utc') for s_ in B['sessions']) and all((EPB.get('frozen') or {}).get(n) for n in B['networks'])):
        die('ready needs the signer address, --measurement-code-commit, the image record, the session times and both frozen primary endpoints')
    if not a.funded_doctor:
        die('--ready needs --funded-doctor (a live read-only doctor-public report run with the key)')
    fstate = funded_doctor_gate(a.funded_doctor, SG, image['image_id'])
    status = 'ready'
    baseline = {'tag': tag, 'tagged_commit': f'the commit that adds this record (git rev-parse {tag}^{{commit}}); setup and S1-S3 run from it with a clean tree',
                'results_dir': B['results_dir'], 'funded_doctor': {'path': os.path.relpath(P(a.funded_doctor), REPO), 'sha256': sha(a.funded_doctor),
                                                                   'signer_balance_wei': {n: v['balance_wei'] for n, v in fstate.items()}, 'funding_gate': 'D5 PASS',
                                                                   'funded_state': fstate},
                'protocol_sha256': sha(B['protocol']), 'measurement_code_commit': mcc, 'image_id': image['image_id']}
    open_inputs = []
if image is None:
    open_inputs.insert(0, 'frozen public image record (save-image-public)')
rec = {
    'admin_id': AR['admin_id'], 'status': status, 'experiment': AR['experiment'], 'venue': B['venue'], 'arm': B['arm'],
    'stage': ('baseline: every author input frozen, funded read-only doctor recorded; the annotated baseline tag is created on this commit before setup; no public transaction sent'
              if status == 'ready' else 'harness, design, frozen inputs and image registered; engineering dry run passed; author inputs listed in author_inputs_open remain; no public transaction sent'),
    'claim_boundary': 'dated public-network case study: deployability, observed price and paid fee, request-to-hash and hash-to-receipt behaviour through named endpoints, public gasUsed as a dated observation, RPC/client failures, Era batch lifecycle post hoc; not latency in general, mainnet economics, reliability, superiority, EVM-vs-EraVM equivalence or causal backend latency',
    'protocol': {'path': B['protocol'], 'sha256': sha(B['protocol']), 'status': 'draft for freeze at the public baseline tag'},
    'binding': {'path': BIND, 'sha256': sha(BIND)},
    'harness': {'commit': hc, 'measurement_code_commit': mcc, 'measurement_code_paths': MEASUREMENT_CODE_PATHS if mcc else None, 'adapter': 'chainbench/adapters/public', 'procedure': 'chainbench/workloads/zcorp/' + B['procedure'].split('zcorp/')[-1],
                'lockfile_sha256': sha('chainbench/adapters/public/package-lock.json'), 'runtime_packages': {'ethers': '6.13.5', 'zksync-ethers': '6.21.2'},
                'image_base': 'node@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9', 'derivation': 'scripts/analysis/derive_chain_public.py'},
    'inputs': {'dir': B['inputs_dir'], 'manifest_sha256': hashlib.sha256(man.encode()).hexdigest(), 'identity_checks': f"{sum(c['pass'] for c in idn['checks'])}/{len(idn['checks'])}",
               'controlled_references': B['controlled_references'], 'proofs': {k: B['proofs'][k] for k in ('groth16', 'plonk')}, 'depth': B['depth']},
    'matrix': {'setup': 16, 'verification': 24, 'total': sched['total_transactions'], 'schedule_seed': B['schedule_seed'], 'blocks': blocks},
    'sessions': B['sessions'], 'networks': B['networks'], 'fee_policy': B['fee_policy'], 'timing': B['timing'], 'states': B['states'],
    'readiness': {'dry_run_id': S['dry_id'], 'dir': os.path.relpath(dry, REPO), 'summary_sha256': sha(os.path.join(dry, 'SUMMARY.json')),
                  'expectations': f"{S['passed']}/{S['total']}", 'commit': S['commit'], 'node': S['node'], 'mode': S['mode'],
                  'evidence_status': 'engineering; not scientific data', 'reuse': dry_reuse},
    'image': image,
    'signer': signer,
    'baseline': baseline,
    'endpoints': {'frozen': EPB.get('frozen'), 'secondary': EPB.get('secondary'), 'fallback_policy': EPB.get('fallback_policy')},
    'engineering_records': records,
    'dependency_audit': {'note': os.path.join(EV, 'notes', 'DEPENDENCY-AUDIT.md'), 'evidence': os.path.join(EV, 'notes', 'dependency-audit')},
    'author_inputs_open': open_inputs,
    'not_done': 'no public-network transaction signed or sent, no test ether spent, no deployment on Sepolia or Era Sepolia; no July or zkUIT result included',
}
open(P(os.path.join(EV, 'campaign.json')), 'w').write(json.dumps(rec, indent=2, sort_keys=True) + '\n')
reg = P(AR['registry'])
rows = list(csv.DictReader(open(reg, newline=''))); fields = list(rows[0].keys())
hit = [r for r in rows if r['admin_id'] == AR['admin_id']]
if not hit:
    rows.append({f: '' for f in fields}); hit = [rows[-1]]
hit[0].update({'venue': B['venue'], 'admin_id': AR['admin_id'], 'experiment': AR['experiment'], 'status': status, 'used_in_manuscript': 'no',
               'campaign_id': '-', 'source_path': '-', 'baseline_tag': baseline['tag'] if baseline else '-', 'commit': hc, 'protocol_version': 'v1', 'protocol_path': B['protocol']})
with open(reg, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=fields, lineterminator='\n'); w.writeheader(); w.writerows(rows)
print(f"written {EV}/campaign.json and the {AR['admin_id']} registry row ({status}, harness {hc[:7]})")
