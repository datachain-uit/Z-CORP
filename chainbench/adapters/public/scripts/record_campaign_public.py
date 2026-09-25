#!/usr/bin/env python3
"""Administrative record of the evidence entry CSI-CHAIN-PUBLIC-01 (CHAIN-PUBLIC-PROTOCOL-v1 section 16).
Deterministic output; identity from the campaign binding.

    record_campaign_public.py --planned --harness-commit <sha> --dry-run <readiness dir>
                              [--measurement-code-commit <sha>] [--record NAME=PATH ...]
writes csi/campaigns/chain/CSI-CHAIN-PUBLIC-01/campaign.json (status planned) and the CSI-CHAIN-PUBLIC-01 row of
csi/campaign-index.csv (status planned, commit = the harness commit); other registry rows are untouched. Refuses unless
the harness commit contains the adapter, binding, protocol and frozen inputs exactly as in the working tree, the inputs
verify, and the engineering dry run recorded under --dry-run passed every expectation. With --measurement-code-commit it
also refuses unless the measurement code (MEASUREMENT_CODE_PATHS) is byte-identical between that commit and the harness
commit, and records the frozen public image (adapters/public/ARCHIVE.json, chain re-verified), the frozen endpoints, the
author inputs still open and the listed engineering records (--record NAME=PATH, sha256 only). The ready and scientific
stages (after the signer, the results label and the baseline tag) are added to this tool when they are reached."""
import argparse, csv, hashlib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
BIND = 'chainbench/workloads/zcorp/campaigns/CSI-CHAIN-PUBLIC-01.json'
ap = argparse.ArgumentParser()
ap.add_argument('--planned', action='store_true'); ap.add_argument('--harness-commit', required=True); ap.add_argument('--dry-run', required=True)
ap.add_argument('--measurement-code-commit'); ap.add_argument('--record', action='append', default=[])
a = ap.parse_args()


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
if not S['all_pass'] or S['commit'] != hc:
    die(f"dry run {S['dry_id']}: all_pass={S['all_pass']}, commit {S['commit'][:7]} (harness {hc[:7]})")
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
    r = subprocess.run(['node', '-e', "const I=require('./adapters/public/lib/imageid');const r=I.loadRecord();console.log(JSON.stringify(r))"], cwd=P('chainbench'), capture_output=True, text=True)
    if r.returncode:
        die(f'the frozen image record does not verify: {r.stderr.strip()[:200]}')
    ir = json.loads(r.stdout)
    image = {k: ir[k] for k in ('image_id', 'manifest_digest', 'config_digest', 'attestation_manifest_digest', 'platform', 'architecture', 'base_image',
                                'archive', 'archive_bytes', 'archive_sha256', 'rootfs_layers', 'provenance', 'built_utc', 'saved_utc', 'docker_client', 'docker_engine')}
    image['record'] = 'chainbench/adapters/public/ARCHIVE.json'; image['record_sha256'] = sha('chainbench/adapters/public/ARCHIVE.json')
    image['rule'] = 'live commands run only in this image (CHAIN-PUBLIC-PROTOCOL-v1 section 13.1); verified before and after every live command'
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
open_inputs += ['dedicated signing key and its address (tools/new_public_key.sh, verify_public_key.sh)', 'funding on both networks, recorded by a read-only doctor-public with the key',
                'results directory date label <D> (binding results_dir)', 'public baseline commit and annotated tag chain-public-baseline-<D>']
if image is None:
    open_inputs.insert(0, 'frozen public image record (save-image-public)')
rec = {
    'admin_id': AR['admin_id'], 'status': 'planned', 'experiment': AR['experiment'], 'venue': B['venue'], 'arm': B['arm'],
    'stage': 'harness, design and frozen inputs registered; engineering dry run passed; author inputs open (protocol section 17); no public transaction sent',
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
                  'evidence_status': 'engineering; not scientific data'},
    'image': image,
    'endpoints': {'frozen': EPB.get('frozen'), 'secondary': EPB.get('secondary'), 'fallback_policy': EPB.get('fallback_policy')},
    'engineering_records': records,
    'dependency_audit': {'note': os.path.join(EV, 'notes', 'DEPENDENCY-AUDIT.md'), 'evidence': os.path.join(EV, 'notes', 'dependency-audit')},
    'author_inputs_open': open_inputs,
    'not_done': 'no transaction sent, no key used, no test ether spent, no deployment on Sepolia or Era Sepolia; no July or zkUIT result included',
}
open(P(os.path.join(EV, 'campaign.json')), 'w').write(json.dumps(rec, indent=2, sort_keys=True) + '\n')
reg = P(AR['registry'])
rows = list(csv.DictReader(open(reg, newline=''))); fields = list(rows[0].keys())
hit = [r for r in rows if r['admin_id'] == AR['admin_id']]
if not hit:
    rows.append({f: '' for f in fields}); hit = [rows[-1]]
hit[0].update({'venue': B['venue'], 'admin_id': AR['admin_id'], 'experiment': AR['experiment'], 'status': 'planned', 'used_in_manuscript': 'no',
               'campaign_id': '-', 'source_path': '-', 'baseline_tag': '-', 'commit': hc, 'protocol_version': 'v1', 'protocol_path': B['protocol']})
with open(reg, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=fields, lineterminator='\n'); w.writeheader(); w.writerows(rows)
print(f"written {EV}/campaign.json and the {AR['admin_id']} registry row (planned, harness {hc[:7]})")
