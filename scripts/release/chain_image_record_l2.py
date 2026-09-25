#!/usr/bin/env python3
"""CSI-CHAIN-LOCAL-01-L2: identity record of the archived local-EraVM image (release manifest, Zenodo deposit).

Reads the frozen `docker save` archive of the scientific image (csi/release/CSI-CHAIN-LOCAL-01-L2/image/
chainbench-l2-arm64.oci.tar, not versioned; written by `./chainbench/run.sh save-image-l2 --frozen` on the campaign host
and copied unchanged) with its host record (IMAGE-ARCHIVE.arm64.json), and writes
csi/release/CSI-CHAIN-LOCAL-01-L2/IMAGE-ARCHIVE.json: archive bytes and sha256 (recomputed), OCI index, platform manifest
and config digests, base image, and the sha256 of /opt/eravm/bin/{anvil-zksync,zksolc,solc} and of the installed npm
lockfile, read from the archived layers. Checks: archive sha256 = host record = chainbench/adapters/eravm/ARCHIVE.json;
index digest = image id; binaries = the arm64 pins (chainbench/adapters/eravm/pins.env) = IMAGE.json toolchain; lockfile =
chainbench/adapters/eravm/package-lock.json. Exit 1 on failure. If the archive is absent (a checkout without the
release binaries), the record is not rewritten.

    python3 scripts/release/chain_image_record_l2.py"""
import hashlib, io, json, os, re, sys, tarfile
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
REL = 'csi/release/CSI-CHAIN-LOCAL-01-L2'
P = lambda p: os.path.join(REPO, p)
fails = []
def need(c, m):
    if not c: fails.append(m)
def sha_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()
WANT = {'opt/eravm/bin/anvil-zksync': 'anvil_zksync', 'opt/eravm/bin/zksolc': 'zksolc', 'opt/eravm/bin/solc': 'era_solc',
        'repo/chainbench/package-lock.json': 'npm_lockfile'}
def describe(path):
    t = tarfile.open(path)
    blob = lambda d: json.load(t.extractfile('blobs/sha256/' + d.split(':')[1]))
    idx = json.load(t.extractfile('index.json')); top = idx['manifests'][0]; b = blob(top['digest'])
    d = {'top_digest': top['digest'], 'top_media_type': top['mediaType'], 'ref_name': (top.get('annotations') or {}).get('io.containerd.image.name'), 'manifests': []}
    found = {}
    for m in (b['manifests'] if 'manifests' in b else [dict(top, platform=None)]):
        try: mm = blob(m['digest'])
        except KeyError: mm = None
        plat = m.get('platform') or {}
        cfg = blob(mm['config']['digest']) if mm and 'config' in mm else {}
        e = {'digest': m['digest'], 'platform': f"{plat.get('os', cfg.get('os'))}/{plat.get('architecture', cfg.get('architecture'))}",
             'kind': (m.get('annotations') or {}).get('vnd.docker.reference.type', 'image'), 'config': mm['config']['digest'] if mm else None}
        if mm and e['kind'] == 'image':
            e['layers'] = len(mm['layers'])
            e['env'] = sorted(x for x in cfg.get('config', {}).get('Env', []) if x.startswith(('CHAINBENCH_', 'NODE_VERSION')))
            e['labels'] = cfg.get('config', {}).get('Labels', {})
            for l in mm['layers']:
                try: lt = tarfile.open(fileobj=io.BytesIO(t.extractfile('blobs/sha256/' + l['digest'].split(':')[1]).read()), mode='r:*')
                except Exception: continue
                for x in lt.getmembers():
                    n = x.name.lstrip('./')
                    if x.isfile() and n in WANT:
                        found[WANT[n]] = {'path': '/' + n, 'sha256': hashlib.sha256(lt.extractfile(x).read()).hexdigest(), 'bytes': x.size, 'layer': l['digest']}
        d['manifests'].append(e)
    d['files_in_layers'] = found
    return d
def pins():
    return dict(re.findall(r'^([A-Z0-9_]+)="(.*)"$', open(P('chainbench/adapters/eravm/pins.env')).read(), re.M))
frozen = json.load(open(P('chainbench/adapters/eravm/ARCHIVE.json'))); image = json.load(open(P('chainbench/adapters/eravm/IMAGE.json')))
pn = pins(); host = json.load(open(P(f'{REL}/IMAGE-ARCHIVE.arm64.json')))
arc = P(f"{REL}/{host['archive']}")
if not os.path.exists(arc):
    print(json.dumps({'skipped': f'{REL}/{host["archive"]} not present in this checkout; record not rewritten'})); sys.exit(0)
ent = {'platform': host['platform'], 'role': host['role'], 'host_record': f'{REL}/IMAGE-ARCHIVE.arm64.json', 'host_record_sha256': sha_file(P(f'{REL}/IMAGE-ARCHIVE.arm64.json')),
       'image_ref': host['image_ref'], 'image_id': host['image_id'], 'base_image': host['base_image'], 'saved_utc': host['saved_utc'], 'docker': host['docker_engine'],
       'archive': {'file': f"{REL}/{host['archive']}", 'bytes': os.path.getsize(arc), 'sha256': sha_file(arc), 'versioned': False,
                   'copied_from': host['archive_file'], 'rebuilt': False}}
ent['archive'].update(describe(arc))
need(ent['archive']['sha256'] == host['archive_sha256'] == frozen['archive_sha256'], 'archive sha256 differs from the host record or chainbench/adapters/eravm/ARCHIVE.json')
need(ent['archive']['bytes'] == host['archive_bytes'] == frozen['archive_bytes'], 'archive size differs from the records')
need(host['image_id'] == frozen['image_id'] == ent['archive']['top_digest'], 'image id / archive index digest mismatch')
need(host['base_image'] == f"{pn['BASE_IMAGE_REPO']}@{pn['BASE_IMAGE_DIGEST']}", 'base image differs from pins.env')
need(host['role'] == 'scientific' and host['platform'] == 'linux/arm64', 'not the scientific linux/arm64 archive')
f = ent['archive']['files_in_layers']
for k, pin in (('anvil_zksync', 'ANVIL_ZKSYNC_BIN_SHA256_ARM64'), ('zksolc', 'ZKSOLC_SHA256_ARM64'), ('era_solc', 'ERA_SOLC_SHA256_ARM64')):
    need(f.get(k, {}).get('sha256') == pn[pin] == image['toolchain'][k]['sha256'], f'{k}: archived binary != pins.env ({pin}) / IMAGE.json')
need(f.get('npm_lockfile', {}).get('sha256') == sha_file(P('chainbench/adapters/eravm/package-lock.json')) == image['toolchain']['lockfile_sha256'], 'archived npm lockfile != adapters/eravm/package-lock.json')
ent['binaries_sha256'] = {k: f.get(k, {}).get('sha256') for k in ('anvil_zksync', 'zksolc', 'era_solc')}
ent['versions'] = {'anvil_zksync': image['toolchain']['anvil_zksync']['version'], 'zksolc': image['toolchain']['zksolc']['version'], 'era_solc': image['toolchain']['era_solc']['version']}
ent['toolchain'] = image['toolchain']
out = {'campaign': 'CSI-CHAIN-LOCAL-01-L2', 'arm': 'L2-EraVM (the local EraVM arm of CSI-CHAIN-LOCAL-01)',
       'rule': 'the scientific L2 campaign runs only in this archived linux/arm64 image (chainbench/adapters/eravm/ARCHIVE.json; '
               'full-local-l2 refuses any other image); the image is never rebuilt for the campaign',
       'images': [ent], 'checks_pass': not fails, 'check_failures': fails}
open(P(f'{REL}/IMAGE-ARCHIVE.json'), 'w').write(json.dumps(out, indent=2, sort_keys=True) + '\n')
print(json.dumps({'written': f'{REL}/IMAGE-ARCHIVE.json', 'checks_pass': not fails, 'failures': fails, 'binaries': ent['binaries_sha256'], 'image_id': ent['image_id']}))
sys.exit(1 if fails else 0)
