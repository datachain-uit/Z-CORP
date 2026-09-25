#!/usr/bin/env python3
"""Build or check the CSI evidence workspace (csi/) from registered campaigns.

The source campaign directories stay the only source of truth: nothing under them is written.
The workspace holds (a) a hand-maintained registry, csi/campaign-index.csv, (b) generated,
deterministic records derived from the sources and from git, and (c) hand-written notes.
Generated files are rebuilt byte-identically from the same inputs; `--check` verifies that.

    python3 scripts/release/build_csi_bundle.py            build/update generated files
    python3 scripts/release/build_csi_bundle.py --check    exit 1 if any generated file is stale
    python3 scripts/release/build_csi_bundle.py --release  also build release archives (not versioned)

Per registered campaign (csi/campaigns/<experiment-dir>/<admin_id>/):
  SOURCE.sha256    sha256 of every file of the source campaign (frozen: a later mismatch aborts)
  campaign.json    registration, identities (campaign, commit, tag, protocol, image), validation,
                   superseded-campaign digest, image-archive record, derived-output checksums
  derived/         scripts/analysis/derive_prover.py outputs (accepted attempts only)
Workspace-wide:
  protocols/prover/RERUN-PROTOCOL-<v>.md   byte-identical snapshot of the protocol at the campaign commit
  code/prover/KIT.sha256                   code the campaign ran (campaign paths at the campaign commit)
  code/analysis/ANALYSIS.sha256            derivation and release scripts used to build this workspace
  provenance/SNAPSHOTS.csv                 origin and sha256 of every file in csi/ (except itself and binaries)
Chain campaigns (experiment dir `chain`, e.g. CSI-CHAIN-LOCAL-01) are registered in the same index but are not built
from a source campaign here: their records (campaign.json, notes) are produced by chainbench/, their inputs are frozen
under csi/campaigns/chain/<admin_id>/inputs/ (checked here against their manifests), and this script adds
  code/chain/<admin_id>.KIT.sha256        the chain campaign's code at its registered commit
and attributes their files correctly in provenance/SNAPSHOTS.csv. Prover outputs are unaffected. The local-EraVM arm is a
separate chain entry (CSI-CHAIN-LOCAL-01-L2, experiment "controlled on-chain verification (local EraVM)"): its image
record, derivation (derive_chain_l2.py), inputs (the L1 entry's PS-01) and attribution are its own (CHAIN_KIND).
Standard library only.
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
CSI = 'csi'
INDEX = f'{CSI}/campaign-index.csv'
CAMPAIGN_PATHS = ['bench', 'scripts/setup', 'circuits', 'contracts', 'test', 'ARTIFACTS.sha256', 'PROVENANCE.md']
ANALYSIS_CODE = ['scripts/analysis/derive_prover.py', 'scripts/analysis/compare_completion_report.py',
                 'scripts/analysis/input_stage_diagnostic.js', 'scripts/release/build_csi_bundle.py',
                 'scripts/release/make_precorrection_manifest.py', 'scripts/release/save_image.sh',
                 'scripts/release/chain_image_record.py', 'scripts/analysis/derive_chain_l1.py', 'scripts/analysis/verify_chain_proofset.js',
                 'scripts/analysis/derive_chain_l2.py', 'scripts/release/chain_image_record_l2.py']
SUPERSEDED = 'results/PRECORRECTION-2026-07.sha256'
EXPERIMENT_DIR = {'controlled prover scaling': 'prover', 'controlled on-chain verification (local L1)': 'chain',
                  'controlled on-chain verification (local EraVM)': 'chain'}
# Per chain arm: frozen image record, derivation, frozen inputs (the L2 arm reuses the L1 entry's PS-01), attribution.
L1_EXP, L2_EXP = 'controlled on-chain verification (local L1)', 'controlled on-chain verification (local EraVM)'
CHAIN_KIND = {
    L1_EXP: {'archive': 'chainbench/docker/ARCHIVE.json', 'derive': 'scripts/analysis/derive_chain_l1.py', 'derive_args': [], 'inputs': None},
    L2_EXP: {'archive': 'chainbench/adapters/eravm/ARCHIVE.json', 'derive': 'scripts/analysis/derive_chain_l2.py', 'derive_args': ['--plan', 'full'],
             'inputs': f'{CSI}/campaigns/chain/CSI-CHAIN-LOCAL-01/inputs'},
}
CHAIN_PATHS = ['chainbench', 'contracts', 'scripts/setup/generate_input_depth.js', 'scripts/setup/paths.js', 'ARTIFACTS.sha256']
CHAIN_PREFIXES = (f'{CSI}/protocols/chain/', f'{CSI}/campaigns/chain/', f'{CSI}/code/chain/')


class Abort(Exception):
    pass


def sha(b):
    return hashlib.sha256(b).hexdigest()


def rd(rel):
    with open(os.path.join(REPO, rel), 'rb') as f:
        return f.read()


def git(*a, ok_fail=False):
    r = subprocess.run(['git', '-C', REPO, *a], capture_output=True)
    if r.returncode:
        if ok_fail:
            return None
        raise Abort(f'git {" ".join(a)}: {r.stderr.decode().strip()}')
    return r.stdout


def jdump(obj):
    return (json.dumps(obj, indent=2, sort_keys=True) + '\n').encode()


class Plan:
    """Collects generated files; writes them, or compares them in --check mode."""

    def __init__(self, check):
        self.check, self.files, self.stale = check, {}, []

    def put(self, rel, data):
        self.files[rel] = data
        p = os.path.join(REPO, rel)
        cur = open(p, 'rb').read() if os.path.exists(p) else None
        if cur == data:
            return
        if self.check:
            self.stale.append(rel)
        else:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'wb') as f:
                f.write(data)


def source_manifest(src):
    lines = []
    for root, dirs, files in os.walk(os.path.join(REPO, src)):
        dirs.sort()
        for fn in sorted(files):
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, REPO)
            lines.append(f'{sha(open(p, "rb").read())}  {rel}')
    return ('\n'.join(sorted(lines, key=lambda l: l[66:])) + '\n').encode()


def tree_manifest(commit, paths):
    out = []
    ls = git('ls-tree', '-r', '--full-tree', commit, '--', *paths).decode().splitlines()
    for ln in ls:
        meta, path = ln.split('\t', 1)
        mode, typ, blob = meta.split()
        if typ != 'blob':
            continue
        out.append(f'{sha(git("cat-file", "blob", blob))}  {path}')
    return ('\n'.join(sorted(out, key=lambda l: l[66:])) + '\n').encode()


def build_campaign(row, plan, tmpdir):
    admin = row['admin_id']
    src = row['source_path']
    base = f"{CSI}/campaigns/{EXPERIMENT_DIR[row['experiment']]}/{admin}"
    cj = json.loads(rd(f'{src}/CAMPAIGN.json'))
    # ---- identities: registry vs source vs git
    for k, got in [('campaign_id', cj['campaign_id']), ('commit', cj['repo']['commit']), ('protocol_version', cj['protocol_version'])]:
        if row[k] != got:
            raise Abort(f'{admin}: registry {k}={row[k]} but source has {got}')
    tag_commit = git('rev-parse', row['baseline_tag'] + '^{commit}').decode().strip()
    if tag_commit != row['commit']:
        raise Abort(f"{admin}: tag {row['baseline_tag']} -> {tag_commit}, registry commit {row['commit']}")
    val = json.loads(rd(f'{src}/derived/validation.json'))
    if not (val['passed'] and val['complete']):
        raise Abort(f'{admin}: source campaign validation is not passed+complete')
    if row['status'] == 'validated' and not rd(f'{src}/environment/RESULT.txt').startswith(b'result: PASS'):
        raise Abort(f'{admin}: status validated but RESULT.txt is not PASS')
    # ---- frozen source fingerprint
    sm = source_manifest(src)
    sm_rel = f'{base}/SOURCE.sha256'
    existing = os.path.join(REPO, sm_rel)
    if os.path.exists(existing) and open(existing, 'rb').read() != sm:
        raise Abort(f'{admin}: {src} no longer matches the frozen {sm_rel}; the source campaign must not change')
    plan.put(sm_rel, sm)
    tracked = git('ls-files', '--error-unmatch', f'{src}/CAMPAIGN.json', ok_fail=True) is not None
    clean = tracked and not git('status', '--porcelain', '--', src).strip()
    # ---- image identity from the campaign's own build log
    blog = [f for f in sorted(os.listdir(os.path.join(REPO, src, 'environment'))) if f.startswith('docker-build-')][0]
    btxt = rd(f'{src}/environment/{blog}').decode()
    man = re.search(r'exporting manifest (sha256:[0-9a-f]{64}) done', btxt).group(1)
    cfg = re.search(r'exporting config (sha256:[0-9a-f]{64}) done', btxt).group(1)
    image = {'tag': cj['image']['tag'], 'id_per_build': cj['image']['built_image_id'], 'manifest': man, 'config': cfg,
             'base_image_ref': cj['image']['base_image_ref'], 'base_arm64_manifest': cj['image']['base_arm64_manifest_digest'],
             'platform': cj['image']['platform'], 'identity_source': f'{src}/environment/{blog}'}
    rec_rel = f'{CSI}/release/{admin}/IMAGE-ARCHIVE.json'
    if os.path.exists(os.path.join(REPO, rec_rel)):
        rec = json.loads(rd(rec_rel))
        for k, want in [('image_id_per_build', image['id_per_build']), ('image_manifest', man), ('image_config', cfg), ('campaign_id', cj['campaign_id'])]:
            if rec.get(k) != want:
                raise Abort(f'{admin}: {rec_rel} {k}={rec.get(k)} does not match the campaign ({want})')
        if not (rec['archive_contains_image_manifest_blob'] and rec['archive_contains_image_config_blob']):
            raise Abort(f'{admin}: image archive record says manifest/config blobs are missing')
        tar_p = os.path.join(REPO, CSI, 'release', admin, rec['archive'])
        present = os.path.exists(tar_p)
        if present and sha(open(tar_p, 'rb').read()) != rec['archive_sha256']:
            raise Abort(f'{admin}: {rec["archive"]} does not match archive_sha256 in {rec_rel}')
        image['archive'] = {'record': rec_rel, 'file': f"{CSI}/release/{admin}/{rec['archive']}", 'sha256': rec['archive_sha256'],
                            'bytes': rec['archive_bytes'], 'present_in_this_checkout': present, 'versioned': False}
    else:
        image['archive'] = 'pending: run scripts/release/save_image.sh on the campaign host'
    # ---- protocol snapshot (byte-identical, from git at the campaign commit)
    proto_src = row['protocol_path']
    proto = git('show', f"{row['commit']}:{proto_src}")
    proto_rel = f"{CSI}/protocols/{EXPERIMENT_DIR[row['experiment']]}/RERUN-PROTOCOL-{row['protocol_version']}.md"
    plan.put(proto_rel, proto)
    # ---- superseded-campaign digest
    sup = rd(SUPERSEDED)
    sup_committed = git('show', f'HEAD:{SUPERSEDED}', ok_fail=True)
    # ---- derived outputs (committed derivation script, accepted attempts only)
    dtmp = os.path.join(tmpdir, admin, 'derived')
    cmd = [sys.executable, os.path.join(REPO, 'scripts/analysis/derive_prover.py'), '--campaign', os.path.join(REPO, src), '--out', dtmp,
           '--repo', REPO, '--expect-campaign-id', row['campaign_id'], '--expect-commit', row['commit'],
           '--expect-tag', row['baseline_tag'], '--expect-image-id', image['id_per_build'], '--expect-manifest-sha256', cj['manifest_sha256']]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode:
        raise Abort(f'{admin}: derive_prover.py failed: {r.stderr.decode().strip()}')
    dmeta = json.loads(open(os.path.join(dtmp, 'derivation.json')).read())
    dmeta.pop('python', None)
    dmeta['campaign_dir'] = src
    derived = {}
    for fn in sorted(os.listdir(dtmp)):
        data = jdump(dmeta) if fn == 'derivation.json' else open(os.path.join(dtmp, fn), 'rb').read()
        plan.put(f'{base}/derived/{fn}', data)
        derived[fn] = sha(data)
    # ---- report-vs-derivation comparison (if the comparison script is present)
    cmp_script = os.path.join(REPO, 'scripts/analysis/compare_completion_report.py')
    if os.path.exists(cmp_script):
        r = subprocess.run([sys.executable, cmp_script, '--derived', dtmp], capture_output=True)
        if r.returncode:
            raise Abort(f'{admin}: compare_completion_report.py failed: {r.stderr.decode().strip()}')
        plan.put(f'{base}/notes/report-vs-derivation.md', r.stdout)
    # ---- campaign record
    record = {
        'admin_id': admin, 'venue': row['venue'], 'experiment': row['experiment'], 'status': row['status'],
        'used_in_manuscript': row['used_in_manuscript'],
        'source': {'path': src, 'campaign_id': cj['campaign_id'], 'files': sm.count(b'\n'),
                   'manifest': sm_rel, 'manifest_sha256': sha(sm), 'tracked_in_git': tracked, 'unchanged_vs_git_head': clean,
                   'rule': 'source of truth; never edited; SOURCE.sha256 is frozen and checked on every build'},
        'baseline': {'tag': row['baseline_tag'], 'commit': row['commit'], 'tag_resolves_to_commit': True},
        'protocol': {'version': row['protocol_version'], 'path': proto_src, 'at_commit': row['commit'],
                     'sha256': sha(proto), 'snapshot': proto_rel},
        'image': image,
        'identities': {'artifact_manifest_sha256': cj['manifest_sha256'], 'adapter_sha256': cj['adapter_sha256'],
                       'schedule_sha256': cj['schedule_sha256'], 'execution_plan_sha256': cj['execution_plan_sha256'],
                       'environment': cj['environment']},
        'validation': {'pipeline_checks': f"{sum(1 for c in val['checks'] if c['passed'])}/{len(val['checks'])}",
                       'rounds_accepted': val['accepted_rounds'], 'rounds_scheduled': val['scheduled_rounds'],
                       'sessions': val['sessions'], 'derivation_checks': dmeta['checks']},
        'superseded_campaign': {'file': SUPERSEDED, 'sha256': sha(sup), 'committed': sup_committed == sup,
                                'scope': 'pre-correction July 2026 measurement files (protocol v3 section 7.4)'},
        'derived': {'dir': f'{base}/derived', 'tool': dmeta['tool'], 'tool_sha256': dmeta['tool_sha256'], 'outputs_sha256': derived},
        'code': {'campaign_kit': f'{CSI}/code/prover/KIT.sha256', 'analysis': f'{CSI}/code/analysis/ANALYSIS.sha256'},
        'notes': sorted({os.path.relpath(os.path.join(dp, f), REPO) for dp, _, fs in os.walk(os.path.join(REPO, base)) for f in fs if f.endswith('.md')}
                        | {f for f in plan.files if f.startswith(base + '/') and f.endswith('.md')}),
    }
    plan.put(f'{base}/campaign.json', jdump(record))
    return {'row': row, 'base': base, 'image': image, 'cj': cj}


def build_chain_campaign(row, plan, tmpdir):
    """Chain campaign: verify registry identities and frozen inputs; generate the code manifest. Once the scientific
    run is registered (source_path set): the frozen source manifest and the derived outputs (derive_chain_l1.py)."""
    admin = row['admin_id']
    base = f"{CSI}/campaigns/{EXPERIMENT_DIR[row['experiment']]}/{admin}"
    git('rev-parse', row['commit'] + '^{commit}')
    if not os.path.exists(os.path.join(REPO, row['protocol_path'])):
        raise Abort(f"{admin}: protocol {row['protocol_path']} missing")
    src = row['source_path']
    scientific = src not in ('', '-')
    rec_rel = f'{base}/campaign.json'
    if os.path.exists(os.path.join(REPO, rec_rel)):
        rec = json.loads(rd(rec_rel))
        for k in ('admin_id', 'status'):
            if rec.get(k) != row[k]:
                raise Abort(f'{admin}: {rec_rel} {k}={rec.get(k)} but registry has {row[k]}')
        if scientific:
            sr = rec.get('scientific_run') or {}
            for k, want in (('baseline_commit', row['commit']), ('campaign_id', row['campaign_id']), ('source_path', src), ('baseline_tag', row['baseline_tag'])):
                if sr.get(k) != want:
                    raise Abort(f"{admin}: {rec_rel} scientific_run.{k}={sr.get(k)} but registry has {want}")
            tag_commit = git('rev-parse', row['baseline_tag'] + '^{commit}').decode().strip()
            if tag_commit != row['commit']:
                raise Abort(f"{admin}: tag {row['baseline_tag']} -> {tag_commit}, registry commit {row['commit']}")
        elif rec.get('harness', {}).get('commit') != row['commit']:
            raise Abort(f"{admin}: {rec_rel} harness commit {rec.get('harness', {}).get('commit')} but registry has {row['commit']}")
    kind = CHAIN_KIND[row['experiment']]
    ps = f"{kind['inputs'] or base + '/inputs'}/proofset"
    if os.path.exists(os.path.join(REPO, ps, 'PROOFSET.sha256')):
        for ln in rd(f'{ps}/PROOFSET.sha256').decode().splitlines():
            h, f = ln.split(None, 1)
            if sha(rd(f'{ps}/{f.strip()}')) != h:
                raise Abort(f'{admin}: frozen proof-set file changed: {ps}/{f.strip()}')
    if scientific:
        # frozen source fingerprint (the tracked raw campaign is the only source of truth)
        sm = source_manifest(src)
        sm_rel = f'{base}/SOURCE.sha256'
        existing = os.path.join(REPO, sm_rel)
        if os.path.exists(existing) and open(existing, 'rb').read() != sm:
            raise Abort(f'{admin}: {src} no longer matches the frozen {sm_rel}; the source campaign must not change')
        plan.put(sm_rel, sm)
        # protocol at the campaign commit must be a byte prefix of the committed protocol: later amendments (e.g. A6,
        # the local-EraVM arm) may only be appended; any edit of the text the campaign ran under aborts
        proto = git('show', f"{row['commit']}:{row['protocol_path']}")
        if not rd(row['protocol_path']).startswith(proto):
            raise Abort(f"{admin}: {row['protocol_path']} was edited after the campaign commit (only appended amendments are allowed)")
        arc = json.loads(git('show', f"{row['commit']}:{kind['archive']}"))
        dtmp = os.path.join(tmpdir, admin, 'derived')
        cmd = [sys.executable, os.path.join(REPO, kind['derive']), '--campaign', os.path.join(REPO, src), '--out', dtmp,
               '--repo', REPO, '--expect-campaign-id', row['campaign_id'], '--expect-commit', row['commit'], '--expect-tag', row['baseline_tag'],
               '--expect-image-id', arc['image_id'], '--expect-protocol-sha256', sha(proto), *kind['derive_args']]
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode:
            raise Abort(f"{admin}: {os.path.basename(kind['derive'])} failed: {r.stderr.decode().strip()}")
        for fn in sorted(os.listdir(dtmp)):
            plan.put(f'{base}/derived/{fn}', open(os.path.join(dtmp, fn), 'rb').read())
    plan.put(f'{CSI}/code/chain/{admin}.KIT.sha256', tree_manifest(row['commit'], CHAIN_PATHS))
    return {'row': row, 'base': base, 'scientific': scientific, 'src': src, 'kind': kind}


def det_tar(path, src):
    """Deterministic tar of a directory (sorted paths, mtime 0, uid/gid 0, mode 0644)."""
    with tarfile.open(path, 'w', format=tarfile.USTAR_FORMAT) as t:
        paths = []
        for root, dirs, files in os.walk(os.path.join(REPO, src)):
            dirs.sort()
            paths += [os.path.join(root, f) for f in sorted(files)]
        for p in sorted(paths, key=lambda x: os.path.relpath(x, REPO)):
            ti = tarfile.TarInfo(os.path.relpath(p, REPO))
            data = open(p, 'rb').read()
            ti.size, ti.mtime, ti.mode, ti.uid, ti.gid, ti.uname, ti.gname = len(data), 0, 0o644, 0, 0, '', ''
            t.addfile(ti, io.BytesIO(data))


def release_manifest(rdir):
    lines = []
    for root, _, files in os.walk(rdir):
        for fn in files:
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, rdir)
            if rel != 'RELEASE.sha256':
                h = hashlib.sha256()
                with open(p, 'rb') as f:
                    for b in iter(lambda: f.read(1 << 20), b''):
                        h.update(b)
                lines.append(f'{h.hexdigest()}  {rel}')
    with open(os.path.join(rdir, 'RELEASE.sha256'), 'w') as f:
        f.write('\n'.join(sorted(lines, key=lambda l: l[66:])) + '\n')


def build_chain_release(ctx):
    """Chain release archives (not versioned): raw campaign tar (deterministic), code tar (git archive at the campaign commit)."""
    admin, src, commit = ctx['row']['admin_id'], ctx['row']['source_path'], ctx['row']['commit']
    rdir = os.path.join(REPO, CSI, 'release', admin)
    os.makedirs(rdir, exist_ok=True)
    det_tar(os.path.join(rdir, f"campaign-{ctx['row']['campaign_id']}.tar"), src)
    with open(os.path.join(rdir, f'code-{commit[:7]}.tar'), 'wb') as f:
        f.write(git('archive', '--format=tar', f'--prefix=zcorp-{commit[:7]}/', commit, '--', *CHAIN_PATHS,
                    'csi/protocols/chain', ctx['kind']['inputs'] or f"{CSI}/campaigns/chain/{admin}/inputs"))
    release_manifest(rdir)
    print(f'release: {rdir}')


def chain_attribution_l2(rel, crow):
    """CSI-CHAIN-LOCAL-01-L2, the local-EraVM arm (CHAIN-PROTOCOL-v1 section 16, A6, A7)."""
    if f"/release/{crow['admin_id']}/" in rel:
        if rel.endswith('/IMAGE-ARCHIVE.json'):
            return 'generated', 'scripts/release/chain_image_record_l2.py <- the frozen docker save archive'
        if rel.endswith('RELEASE.sha256'):
            return 'generated', 'scripts/release/build_csi_bundle.py --release'
        return 'record', 'chainbench/run.sh save-image-l2 --frozen (campaign host; copied unchanged)'
    if rel.startswith(f'{CSI}/code/chain/'):
        return 'generated', 'scripts/release/build_csi_bundle.py'
    if '/observation/' in rel and not rel.endswith('.md'):
        return 'record', 'chainbench/adapters/eravm/observe-public.sh (read-only JSON-RPC to ZKsync Era Sepolia, campaign host)'
    if '/readiness/' in rel:
        return 'record', 'chainbench/run.sh author-l2 (campaign host; copied run records; not scientific data)'
    if rel.endswith('/campaign.json') or rel.endswith('/VALIDATION.md'):
        return 'generated', 'chainbench/workloads/zcorp/record_campaign_l2.py'
    if rel.endswith('/SOURCE.sha256'):
        return 'generated', crow['source_path']
    if '/derived/' in rel:
        return 'generated', f"scripts/analysis/derive_chain_l2.py <- {crow['source_path']}"
    return 'hand-written', '-'


def chain_attribution(rel, crow):
    if crow['experiment'] == L2_EXP:
        return chain_attribution_l2(rel, crow)
    if f"/release/{crow['admin_id']}/" in rel:
        if rel.endswith('/IMAGE-ARCHIVE.json'):
            return 'generated', 'scripts/release/chain_image_record.py <- the docker save archives (campaign host)'
        if rel.endswith('RELEASE.sha256'):
            return 'generated', 'scripts/release/build_csi_bundle.py --release'
        return 'record', 'chainbench/run.sh save-image (campaign host)'
    if '/inputs/proofset/' in rel:
        return 'frozen input', 'chainbench/scripts/gen_proofset.js (proof set PS-01)'
    if rel.endswith('plonk-verifiers.provenance.json'):
        return 'generated', 'chainbench/scripts/export_plonk_verifiers.js'
    if '/protocols/chain/' in rel:
        return 'protocol', 'hand-written; frozen, amendments logged in its section 15'
    if rel.startswith(f'{CSI}/code/chain/'):
        return 'generated', 'scripts/release/build_csi_bundle.py'
    if re.search(r'/notes/DRY-RUN-readiness-[0-9a-f]{7}\.md$', rel):
        return 'generated', 'chainbench/scripts/record_campaign.py at the readiness commit (earlier readiness dry run)'
    if re.search(r'/notes/DRY-RUN-packaged-[0-9a-f]{7}\.md$', rel):
        return 'generated', 'chainbench/workloads/zcorp/record_campaign.py (earlier, superseded packaged dry run)'
    if rel.endswith('/campaign.json') or rel.endswith('/notes/DRY-RUN.md') or rel.endswith('/VALIDATION.md'):
        return 'generated', 'chainbench/workloads/zcorp/record_campaign.py'
    if rel.endswith('/SOURCE.sha256'):
        return 'generated', crow['source_path']
    if '/derived/' in rel:
        return 'generated', f"scripts/analysis/derive_chain_l1.py <- {crow['source_path']}"
    if '/validation/' in rel:
        return 'generated', 'scripts/analysis/verify_chain_proofset.js (needs the manifest-covered vkeys under data/)'
    return 'hand-written', '-'


def build_release(ctx):
    """Release archives (not versioned): campaign tar (deterministic) and code tar (git archive)."""
    admin, src, commit = ctx['row']['admin_id'], ctx['row']['source_path'], ctx['row']['commit']
    rdir = os.path.join(REPO, CSI, 'release', admin)
    os.makedirs(rdir, exist_ok=True)
    camp = os.path.join(rdir, f"campaign-{ctx['cj']['campaign_id']}.tar")
    with tarfile.open(camp, 'w', format=tarfile.USTAR_FORMAT) as t:
        paths = []
        for root, dirs, files in os.walk(os.path.join(REPO, src)):
            dirs.sort()
            paths += [os.path.join(root, f) for f in sorted(files)]
        for p in sorted(paths, key=lambda x: os.path.relpath(x, REPO)):
            ti = tarfile.TarInfo(os.path.relpath(p, REPO))
            data = open(p, 'rb').read()
            ti.size, ti.mtime, ti.mode, ti.uid, ti.gid, ti.uname, ti.gname = len(data), 0, 0o644, 0, 0, '', ''
            t.addfile(ti, io.BytesIO(data))
    kit = os.path.join(rdir, f'code-{commit[:7]}.tar')
    with open(kit, 'wb') as f:
        f.write(git('archive', '--format=tar', f'--prefix=zcorp-{commit[:7]}/', commit, '--', *CAMPAIGN_PATHS))
    lines = []
    for root, _, files in os.walk(rdir):
        for fn in files:
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, rdir)
            if rel != 'RELEASE.sha256':
                lines.append(f'{sha(open(p, "rb").read())}  {rel}')
    with open(os.path.join(rdir, 'RELEASE.sha256'), 'w') as f:
        f.write('\n'.join(sorted(lines, key=lambda l: l[66:])) + '\n')
    print(f'release: {rdir}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--release', action='store_true')
    a = ap.parse_args()
    plan = Plan(a.check)
    tmpdir = tempfile.mkdtemp(prefix='csi-bundle-')
    try:
        allrows = list(csv.DictReader(io.StringIO(rd(INDEX).decode())))
        for r in allrows:
            if r['experiment'] not in EXPERIMENT_DIR:
                raise Abort(f"{r['admin_id']}: unknown experiment {r['experiment']}")
        rows = [r for r in allrows if EXPERIMENT_DIR[r['experiment']] == 'prover']
        crows = [r for r in allrows if EXPERIMENT_DIR[r['experiment']] == 'chain']
        ctxs = [build_campaign(r, plan, tmpdir) for r in rows]
        cctx = [build_chain_campaign(r, plan, tmpdir) for r in crows]
        if a.release and not a.check:
            for c in ctxs:
                build_release(c)
            for c in cctx:
                if c['scientific']:
                    build_chain_release(c)
        commits = sorted({r['commit'] for r in rows})
        for c in commits:
            plan.put(f'{CSI}/code/prover/KIT.sha256', tree_manifest(c, CAMPAIGN_PATHS))
        ana = []
        for rel in ANALYSIS_CODE:
            if os.path.exists(os.path.join(REPO, rel)):
                data = rd(rel)
                head_blob = git('rev-parse', f'HEAD:{rel}', ok_fail=True)
                work_blob = git('hash-object', '--', rel).decode().strip()
                state = 'committed' if head_blob and head_blob.decode().strip() == work_blob else 'uncommitted'
                ana.append(f'{sha(data)}  {rel}  # git blob {work_blob} ({state})')
        plan.put(f'{CSI}/code/analysis/ANALYSIS.sha256', ('\n'.join(ana) + '\n').encode())
        # provenance of every file in csi/ (generated, snapshot or note), except itself and release binaries
        snap = []
        allfiles = set(plan.files)
        for root, dirs, files in os.walk(os.path.join(REPO, CSI)):
            dirs.sort()
            for fn in files:
                allfiles.add(os.path.relpath(os.path.join(root, fn), REPO))
        ctx = ctxs[0]
        prow = ctx['row']
        for rel in sorted(allfiles):
            if rel == f'{CSI}/provenance/SNAPSHOTS.csv' or rel.endswith('.tar'):
                continue
            data = plan.files.get(rel) or rd(rel)
            chain_release = tuple(f"{CSI}/release/{c['row']['admin_id']}/" for c in cctx)
            if rel.startswith(CHAIN_PREFIXES + chain_release):
                owners = [c['row'] for c in cctx if rel.startswith(c['base'] + '/') or rel.startswith(f"{CSI}/release/{c['row']['admin_id']}/")
                          or rel == f"{CSI}/code/chain/{c['row']['admin_id']}.KIT.sha256"]
                crow = owners[0] if owners else (cctx[0]['row'] if cctx else None)
                if crow is None:
                    raise Abort(f'{rel}: chain file but no chain campaign is registered')
                kind, source = chain_attribution(rel, crow)
                cid_col = crow['campaign_id'] if crow['campaign_id'] not in ('', '-') else f"{crow['admin_id']} (pre-run)"
                snap.append({'artifact': rel, 'kind': kind, 'source': source, 'campaign_id': cid_col, 'commit': crow['commit'],
                             'baseline_tag': crow['baseline_tag'], 'protocol_version': crow['protocol_version'],
                             'image_manifest': '-', 'image_config': '-', 'sha256': sha(data)})
                continue
            if rel.endswith('SOURCE.sha256'):
                kind, source = 'generated', prow['source_path']
            elif '/protocols/' in rel:
                kind, source = 'snapshot', f"git {prow['commit']}:{prow['protocol_path']}"
            elif '/derived/' in rel:
                kind, source = 'generated', f"scripts/analysis/derive_prover.py <- {prow['source_path']}"
            elif rel.endswith('report-vs-derivation.md'):
                kind, source = 'generated', 'scripts/analysis/compare_completion_report.py <- derived/'
            elif rel in plan.files:
                kind, source = 'generated', 'scripts/release/build_csi_bundle.py'
            elif '/investigations/' in rel and rel.endswith('.json'):
                kind, source = 'diagnostic', 'scripts/analysis/input_stage_diagnostic.js (engineering micro-diagnostic; not campaign data)'
            elif rel.endswith('RELEASE.sha256'):
                kind, source = 'generated', 'scripts/release/build_csi_bundle.py --release'
            elif '/release/' in rel and '/image/' in rel or rel.endswith('IMAGE-ARCHIVE.json'):
                kind, source = 'record', 'scripts/release/save_image.sh (campaign host)'
            else:
                kind, source = 'hand-written', '-'
            snap.append({'artifact': rel, 'kind': kind, 'source': source, 'campaign_id': prow['campaign_id'], 'commit': prow['commit'],
                         'baseline_tag': prow['baseline_tag'], 'protocol_version': prow['protocol_version'],
                         'image_manifest': ctx['image']['manifest'], 'image_config': ctx['image']['config'], 'sha256': sha(data)})
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=list(snap[0].keys()), lineterminator='\n')
        w.writeheader()
        w.writerows(snap)
        plan.put(f'{CSI}/provenance/SNAPSHOTS.csv', buf.getvalue().encode())
    except Abort as e:
        print(f'build_csi_bundle: ABORT: {e}', file=sys.stderr)
        sys.exit(2)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    if a.check:
        print('build_csi_bundle: ' + ('up to date' if not plan.stale else 'STALE: ' + ', '.join(plan.stale)))
        sys.exit(1 if plan.stale else 0)
    print(f'build_csi_bundle: {len(plan.files)} generated files up to date')


if __name__ == '__main__':
    main()
