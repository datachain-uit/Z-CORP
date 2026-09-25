#!/usr/bin/env python3
"""Frozen public image record (chainbench/adapters/public/ARCHIVE.json) derived from the saved OCI archive itself.
Called by `./chainbench/run.sh save-image-public` inside the just-built image (--network none); prints the record.
Every blob digest in the archive is re-verified; the chain archive index.json -> image index (= Docker image ID under the
containerd store) -> platform manifest -> config is followed and the three blobs are embedded verbatim, so that
lib/imageid.js and derive_chain_public.py can re-verify the chain offline. Standard library only."""
import argparse, hashlib, json, os, sys, tarfile, datetime

ap = argparse.ArgumentParser()
for k in ('archive', 'archive-path', 'image-id', 'layers-json', 'base-image', 'docker-client', 'docker-engine', 'built-utc'):
    ap.add_argument('--' + k, required=True)
a = ap.parse_args()
H = lambda b: 'sha256:' + hashlib.sha256(b).hexdigest()
die = lambda m: sys.exit(f'image_record: {m}')
h = hashlib.sha256()
with open(a.archive, 'rb') as f:
    for blk in iter(lambda: f.read(1 << 20), b''):
        h.update(blk)
t = tarfile.open(a.archive)
blobs = {}
for m in t.getmembers():
    if m.isfile() and m.name.startswith('blobs/sha256/'):
        b = t.extractfile(m).read()
        if H(b) != 'sha256:' + m.name.rsplit('/', 1)[1]:
            die(f'blob digest mismatch: {m.name}')
        blobs['sha256:' + m.name.rsplit('/', 1)[1]] = b
top = json.loads(t.extractfile('index.json').read())
idx_d = [x['digest'] for x in top['manifests']]
if len(idx_d) != 1 or idx_d[0] != a.image_id:
    die(f'archive index.json lists {idx_d}, expected exactly the image {a.image_id}')
idx_b = blobs[a.image_id]; idx = json.loads(idx_b)
plats = [x for x in idx.get('manifests', []) if x.get('platform', {}).get('architecture') not in (None, 'unknown')]
atts = [x for x in idx.get('manifests', []) if x.get('annotations', {}).get('vnd.docker.reference.type') == 'attestation-manifest']
if len(plats) != 1:
    die(f'expected one platform manifest, found {len(plats)}')
man_d = plats[0]['digest']; man_b = blobs[man_d]; man = json.loads(man_b)
cfg_d = man['config']['digest']; cfg_b = blobs[cfg_d]; cfg = json.loads(cfg_b)
if json.dumps(cfg['rootfs']['diff_ids'], separators=(',', ':')) != a.layers_json.strip():
    die('docker rootfs layers differ from the archived config')
prov = {}
for att in atts:
    for l in json.loads(blobs[att['digest']]).get('layers', []):
        st = json.loads(blobs[l['digest']])
        req = st.get('predicate', {}).get('buildDefinition', {}).get('externalParameters', {}).get('request', {})
        args = {**req.get('args', {}), **req.get('root', {}).get('request', {}).get('args', {})}
        prov = {'predicate_type': st.get('predicateType'), 'vcs_revision': args.get('vcs:revision'), 'vcs_source': args.get('vcs:source'),
                'resolved_base': [d.get('uri') for d in st.get('predicate', {}).get('buildDefinition', {}).get('resolvedDependencies', [])]}
plat = f"{plats[0]['platform']['os']}/{plats[0]['platform']['architecture']}"
rec = {
    'schema': 'chainbench-public-image-archive/1',
    'campaign_id': 'CSI-CHAIN-PUBLIC-01',
    'role': 'the frozen public-runner image: live setup, sessions and finality collection run only in this image (run-public.sh refuses any other)',
    'identity_rule': 'image_id = OCI image-index digest = Docker image ID (containerd image store); a Docker tag is never identity',
    'image_id': a.image_id,
    'manifest_digest': man_d,
    'config_digest': cfg_d,
    'attestation_manifest_digest': atts[0]['digest'] if atts else '',
    'platform': plat,
    'architecture': cfg['architecture'],
    'base_image': a.base_image,
    'archive': os.path.basename(a.archive_path),
    'archive_file': a.archive_path,
    'archive_bytes': os.path.getsize(a.archive),
    'archive_sha256': h.hexdigest(),
    'archive_blobs': len(blobs),
    'rootfs_layers': len(cfg['rootfs']['diff_ids']),
    'rootfs_layers_json_sha256': hashlib.sha256(a.layers_json.strip().encode()).hexdigest(),
    'rootfs_layers_docker_json': a.layers_json.strip(),
    'config_created': cfg.get('created', ''),
    'provenance': prov,
    'built_utc': a.built_utc,
    'saved_utc': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'docker_client': a.docker_client,
    'docker_engine': a.docker_engine,
    'load_command': f'./chainbench/run.sh load-image-public {a.archive_path}',
    'verify_command': './chainbench/run.sh verify-image-public',
    'index_blob': idx_b.decode(),
    'manifest_blob': man_b.decode(),
    'config_blob': cfg_b.decode(),
}
print(json.dumps(rec, indent=2))
