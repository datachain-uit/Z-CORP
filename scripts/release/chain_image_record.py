#!/usr/bin/env python3
"""CSI-CHAIN-LOCAL-01: identity record of the archived Docker images (for the release manifest and the Zenodo deposit).

Reads the `docker save` archives written on the campaign host by `./chainbench/run.sh save-image` / `author-prefreeze`
(csi/release/CSI-CHAIN-LOCAL-01/image/*.oci.tar, not versioned) and their per-platform records, and writes
csi/release/CSI-CHAIN-LOCAL-01/IMAGE-ARCHIVE.json with, for every archive: file, bytes, sha256 (recomputed), OCI index,
platform manifest and config digests, and, for the geth images, the sha256 of /usr/local/bin/geth extracted from the layers.
Checks: sha256 = the host record; the image index blob is in the archive; the scientific archive = chainbench/docker/ARCHIVE.json;
its toolchain = chainbench/docker/IMAGE.json; the archived geth binary = the geth binary recorded for the image. Exit 1 on failure.

    python3 scripts/release/chain_image_record.py [--amd64-identity build/chainbench/image-amd64/identity.json]"""
import argparse, hashlib, io, json, os, sys, tarfile
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
REL = 'csi/release/CSI-CHAIN-LOCAL-01'
ap = argparse.ArgumentParser(); ap.add_argument('--amd64-identity', default='build/chainbench/image-amd64/identity.json'); a = ap.parse_args()
P = lambda p: os.path.join(REPO, p)
fails = []
def need(c, m):
    if not c: fails.append(m)
def sha_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()
def describe(path):
    t = tarfile.open(path)
    blob = lambda d: json.load(t.extractfile('blobs/sha256/' + d.split(':')[1]))
    idx = json.load(t.extractfile('index.json')); top = idx['manifests'][0]; b = blob(top['digest'])
    d = {'top_digest': top['digest'], 'top_media_type': top['mediaType'], 'ref_name': (top.get('annotations') or {}).get('io.containerd.image.name')}
    mans = b['manifests'] if 'manifests' in b else [dict(top, platform=None)]
    d['manifests'] = []
    geth = None
    for m in mans:
        try: mm = blob(m['digest'])
        except KeyError: mm = None
        plat = m.get('platform') or {}
        cfg = blob(mm['config']['digest']) if mm and 'config' in mm else {}
        e = {'digest': m['digest'], 'platform': f"{plat.get('os', cfg.get('os'))}/{plat.get('architecture', cfg.get('architecture'))}",
             'kind': (m.get('annotations') or {}).get('vnd.docker.reference.type', 'image'), 'config': mm['config']['digest'] if mm else None}
        d['manifests'].append(e)
        if mm and e['kind'] == 'image':
            for l in mm['layers']:
                try: lt = tarfile.open(fileobj=io.BytesIO(t.extractfile('blobs/sha256/' + l['digest'].split(':')[1]).read()), mode='r:*')
                except Exception: continue
                for x in lt.getmembers():
                    if x.isfile() and x.name.lstrip('./') in ('usr/local/bin/geth', 'opt/geth/geth'):
                        geth = hashlib.sha256(lt.extractfile(x).read()).hexdigest()
    d['geth_binary_sha256'] = geth
    return d
frozen = json.load(open(P('chainbench/docker/ARCHIVE.json'))); image = json.load(open(P('chainbench/docker/IMAGE.json')))
amd_id = json.load(open(P(a.amd64_identity))) if os.path.exists(P(a.amd64_identity)) else None
out = {'campaign': 'CSI-CHAIN-LOCAL-01', 'rule': 'the scientific campaign runs only in the archived linux/arm64 image (chainbench/docker/ARCHIVE.json); '
       'the linux/amd64 image is a reviewer-portability artifact (doctor and smoke only; not scientific data)', 'images': []}
for arch in ('arm64', 'amd64'):
    rp = P(f'{REL}/IMAGE-ARCHIVE.{arch}.json')
    if not os.path.exists(rp):
        need(arch != 'arm64', f'missing {REL}/IMAGE-ARCHIVE.{arch}.json'); continue
    r = json.load(open(rp))
    ent = {'platform': r['platform'], 'role': r['role'], 'host_record': f'{REL}/IMAGE-ARCHIVE.{arch}.json',
           'host_record_sha256': sha_file(rp), 'image_ref': r['image_ref'], 'image_id': r['image_id'], 'base_image': r['base_image'],
           'geth_source': r['geth_source'], 'saved_utc': r['saved_utc'], 'docker': r['docker_engine']}
    for kind, fk in (('chainbench', 'archive'), ('geth', 'geth_archive')):
        f = P(f"{REL}/{r[fk]}"); present = os.path.exists(f)
        e = {'file': f"{REL}/{r[fk]}", 'bytes': r[f'{fk}_bytes'], 'sha256': r[f'{fk}_sha256'], 'present_in_this_checkout': present, 'versioned': False}
        if present:
            need(sha_file(f) == e['sha256'], f'{e["file"]}: sha256 differs from the host record')
            need(os.path.getsize(f) == e['bytes'], f'{e["file"]}: size differs from the host record')
            e.update(describe(f))
        ent[kind] = e
    if ent['chainbench'].get('geth_binary_sha256') and ent['geth'].get('geth_binary_sha256'):
        need(ent['chainbench']['geth_binary_sha256'] == ent['geth']['geth_binary_sha256'], f'{arch}: /opt/geth/geth in the chainbench image != the archived geth image binary')
    if 'top_digest' in ent['chainbench']:
        need(ent['chainbench']['top_digest'] == r['image_id'], f'{arch}: archive index {ent["chainbench"]["top_digest"]} != image id {r["image_id"]}')
    if arch == 'arm64':
        need(r['role'] == 'scientific' and r['image_id'] == frozen['image_id'] and r['archive_sha256'] == frozen['archive_sha256'], 'arm64 archive is not the frozen archive of chainbench/docker/ARCHIVE.json')
        ent['toolchain'] = image['toolchain']
        need(ent['geth'].get('geth_binary_sha256') in (None, image['toolchain']['geth']['sha256']), 'arm64: archived geth binary != IMAGE.json geth sha256')
    elif amd_id:
        need(amd_id['container']['image_id'] == r['image_id'], 'amd64 identity does not belong to the amd64 archive')
        ent['toolchain'] = amd_id['toolchain']
        need(ent['geth'].get('geth_binary_sha256') in (None, amd_id['toolchain']['geth']['sha256']), 'amd64: archived geth binary != identity geth sha256')
    out['images'].append(ent)
out['checks_pass'] = not fails; out['check_failures'] = fails
open(P(f'{REL}/IMAGE-ARCHIVE.json'), 'w').write(json.dumps(out, indent=2, sort_keys=True) + '\n')
print(json.dumps({'written': f'{REL}/IMAGE-ARCHIVE.json', 'checks_pass': not fails, 'failures': fails}))
sys.exit(1 if fails else 0)
