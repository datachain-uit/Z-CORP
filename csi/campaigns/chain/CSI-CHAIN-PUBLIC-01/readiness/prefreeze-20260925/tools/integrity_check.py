#!/usr/bin/env python3
"""CSI-CHAIN-PUBLIC-01 final pre-flight: integrity of the completed evidence (read-only; nothing is modified).
   python3 integrity_check.py --part git|manifests|archives --out DIR
git:       baseline tags (local and origin), measurement code of L1/L2 vs their tags and measurement_code_commit,
           protected paths unchanged since the last pushed commit and clean in the working tree.
manifests: L1 / L2 public raw / CSI-PROVER-01 SOURCE.sha256, PS-01 PROOFSET.sha256, acquisition-raw record and archive.
archives:  every csi/release/<entry>/RELEASE.sha256 (campaign, code and image archives)."""
import argparse, hashlib, json, os, subprocess, sys, tarfile, datetime
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), *['..'] * 5))
def sh(*a): return subprocess.run(['git', '-C', REPO, *a], capture_output=True, text=True)
def sha_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()
def verify_manifest(man, base):
    ok = bad = 0; bads = []
    for line in open(os.path.join(REPO, man)):
        if not line.strip(): continue
        h, f = line.split(None, 1); f = f.strip()
        p = os.path.join(REPO, base, f)
        if os.path.isfile(p) and sha_file(p) == h: ok += 1
        else: bad += 1; bads.append(f)
    return {'manifest': man, 'manifest_sha256': sha_file(os.path.join(REPO, man)), 'files_ok': ok, 'files_bad': bad, 'bad': bads[:10]}
ap = argparse.ArgumentParser(); ap.add_argument('--part', required=True); ap.add_argument('--out', required=True); a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
R = {'part': a.part, 'at_utc': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'head': sh('rev-parse', 'HEAD').stdout.strip()}
LAST_PUSHED = '68285ca8ec8f01d1172f29818ed3469021827cd9'
TAGS = {'rerun-baseline-20260925': ('9723c3fa1de42ccfb6c724ccc9ca91d1927944ad', 'dc13ddd3e4561e5d69fe372fe3cb2d550bfb2b81'),
        'chain-l1-baseline-20260925': ('d34d7f11c9030da8a96883c275f53b4ab6c99688', '71a58545a6bc6873499928154827d7075bdb3440'),
        'chain-l2-baseline-20260925': ('8d875fc0b8963eac8d9a5531b3788521872fc887', 'e97b69f92b6f1b31bd89f8fa2ffda1792e79a119')}
if a.part == 'git':
    remote = {}
    lr = sh('ls-remote', '--tags', 'origin')
    for l in lr.stdout.splitlines():
        h, ref = l.split('\t'); remote[ref.replace('refs/tags/', '')] = h
    R['tags'] = {}
    for t, (obj, com) in TAGS.items():
        lo, lc, ty = sh('rev-parse', t).stdout.strip(), sh('rev-parse', t + '^{commit}').stdout.strip(), sh('cat-file', '-t', t).stdout.strip()
        R['tags'][t] = {'expected_object': obj, 'expected_commit': com, 'local_object': lo, 'local_commit': lc, 'type': ty,
                        'origin_object': remote.get(t), 'origin_commit': remote.get(t + '^{}'), 'unchanged': lo == obj and lc == com and ty == 'tag' and remote.get(t) == obj and remote.get(t + '^{}') == com}
    R['origin_ls_remote_rc'] = lr.returncode
    arms = {}
    for arm, cj, tag in [('L1', 'csi/campaigns/chain/CSI-CHAIN-LOCAL-01/campaign.json', 'chain-l1-baseline-20260925'),
                         ('L2', 'csi/campaigns/chain/CSI-CHAIN-LOCAL-01-L2/campaign.json', 'chain-l2-baseline-20260925')]:
        c = json.load(open(os.path.join(REPO, cj)))
        paths = c['commits']['measurement_code_paths']; mcc = c['commits']['measurement_code_commit']
        d_tag = sh('diff', '--name-only', tag, 'HEAD', '--', *paths).stdout.split()
        d_mcc = sh('diff', '--name-only', mcc, 'HEAD', '--', *paths).stdout.split()
        wt = sh('status', '--porcelain', '--', *paths).stdout.split('\n')
        bpaths = c['baseline']['measurement_paths']
        d_broad = sh('diff', '--name-only', tag, 'HEAD', '--', *bpaths).stdout.split()
        arms[arm] = {'measurement_code_commit': mcc, 'measurement_code_paths': len(paths), 'changed_vs_tag': d_tag, 'changed_vs_measurement_code_commit': d_mcc,
                     'worktree_changes': [x for x in wt if x.strip()], 'broader_baseline_measurement_paths_changed_vs_tag': d_broad}
    R['measurement_code'] = arms
    protected = ['results/chain-local-l1-20260925', 'results/chain-local-l2-20260925', 'results/postcorr-20260925', 'contracts',
                 'csi/campaigns/chain/CSI-CHAIN-LOCAL-01', 'csi/campaigns/chain/CSI-CHAIN-LOCAL-01-L2', 'csi/campaigns/prover/CSI-PROVER-01',
                 'csi/release', 'csi/protocols/prover', 'csi/protocols/chain/CHAIN-PROTOCOL-v1.md', 'chainbench/adapters/eravm', 'chainbench/docker',
                 'main.tex', 'manuscript', 'CSI_paper', 'submission']
    R['protected_paths'] = protected
    R['protected_changed_since_last_pushed'] = sh('diff', '--name-status', LAST_PUSHED, 'HEAD', '--', *protected).stdout.splitlines()
    R['protected_worktree_status'] = [x for x in sh('status', '--porcelain', '--', *protected).stdout.splitlines() if x.strip()]
    R['unpushed_commits'] = sh('log', '--format=%H %s', f'{LAST_PUSHED}..HEAD').stdout.splitlines()
    R['origin_main'] = sh('ls-remote', 'origin', 'refs/heads/main').stdout.split('\t')[0]
    R['secret_json'] = {'tracked': sh('ls-files', '--error-unmatch', '--', 'secret.json').returncode == 0,
                        'in_history_any_ref': bool(sh('log', '--all', '--format=%H', '--', 'secret.json').stdout.strip()),
                        'any_path_named_secret_json_in_history': bool([l for l in sh('log', '--all', '--name-only', '--format=').stdout.splitlines() if os.path.basename(l) == 'secret.json']),
                        'ignored_rule': sh('check-ignore', '-v', '--no-index', 'secret.json').stdout.strip(),
                        'exists_in_worktree': os.path.exists(os.path.join(REPO, 'secret.json')),
                        'contents_read': False}
elif a.part == 'manifests':
    R['manifests'] = {
        'L1 raw (SOURCE.sha256)': verify_manifest('csi/campaigns/chain/CSI-CHAIN-LOCAL-01/SOURCE.sha256', '.'),
        'L2 public raw (SOURCE.sha256)': verify_manifest('csi/campaigns/chain/CSI-CHAIN-LOCAL-01-L2/SOURCE.sha256', '.'),
        'CSI-PROVER-01 raw (SOURCE.sha256)': verify_manifest('csi/campaigns/prover/CSI-PROVER-01/SOURCE.sha256', '.'),
        'PS-01 (PROOFSET.sha256)': verify_manifest('csi/campaigns/chain/CSI-CHAIN-LOCAL-01/inputs/proofset/PROOFSET.sha256', 'csi/campaigns/chain/CSI-CHAIN-LOCAL-01/inputs/proofset'),
    }
    acq = json.load(open(os.path.join(REPO, 'csi/campaigns/chain/CSI-CHAIN-LOCAL-01-L2/ACQUISITION-RAW.json')))
    camp = json.load(open(os.path.join(REPO, 'csi/campaigns/chain/CSI-CHAIN-LOCAL-01-L2/campaign.json')))
    arc = os.path.join(REPO, camp['scientific_run']['provenance_layers']['acquisition_raw']['archive'])
    want = {f['path'] if isinstance(f, dict) else f.split()[1]: (f['sha256'] if isinstance(f, dict) else f.split()[0]) for f in acq['files']}
    mem_ok = mem_bad = 0
    with tarfile.open(arc) as t:
        names = []
        for m in t.getmembers():
            if not m.isfile(): continue
            names.append(m.name); h = hashlib.sha256(t.extractfile(m).read()).hexdigest()
            key = m.name if m.name in want else next((k for k in want if k.endswith('/' + m.name) or m.name.endswith(k)), None)
            if key and want[key] == h: mem_ok += 1
            else: mem_bad += 1
    R['acquisition_raw'] = {'record': 'csi/campaigns/chain/CSI-CHAIN-LOCAL-01-L2/ACQUISITION-RAW.json', 'record_sha256': sha_file(os.path.join(REPO, 'csi/campaigns/chain/CSI-CHAIN-LOCAL-01-L2/ACQUISITION-RAW.json')),
                            'record_files': len(want), 'archive': os.path.relpath(arc, REPO), 'archive_sha256': sha_file(arc), 'archive_sha256_expected': camp['scientific_run']['provenance_layers']['acquisition_raw']['archive_sha256'],
                            'archive_bytes': os.path.getsize(arc), 'members': len(names), 'members_matching_record': mem_ok, 'members_not_matching': mem_bad, 'manifest': acq.get('manifest')}
elif a.part == 'archives':
    R['releases'] = {}
    for e in ['CSI-PROVER-01', 'CSI-CHAIN-LOCAL-01', 'CSI-CHAIN-LOCAL-01-L2']:
        R['releases'][e] = verify_manifest(f'csi/release/{e}/RELEASE.sha256', f'csi/release/{e}')
json.dump(R, open(os.path.join(a.out, f'integrity-{a.part}.json'), 'w'), indent=1)
print(json.dumps(R, indent=1)[:6000])
