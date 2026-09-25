#!/usr/bin/env python3
"""CSI-CHAIN-LOCAL-01 (CHAIN-PROTOCOL-v1 §11). File-based GOPROXY for every non-GitHub module version named in geth's go.sum, built from official
GitHub mirrors. Each .zip/.mod is accepted only if its h1 dirhash equals the go.sum entry."""
import os, sys, subprocess, hashlib, base64, json, zipfile, re, tempfile, tarfile, io
G = os.path.dirname(os.path.abspath(__file__)); GP = os.path.join(G, 'goproxy'); SRC = os.path.join(G, 'mirrors-full')
MIRRORS = {'go.uber.org/automaxprocs': 'uber-go/automaxprocs', 'go.uber.org/goleak': 'uber-go/goleak',
 'google.golang.org/protobuf': 'protocolbuffers/protobuf-go', 'gopkg.in/natefinch/lumberjack.v2': 'natefinch/lumberjack',
 'gopkg.in/yaml.v3': 'go-yaml/yaml', 'gopkg.in/yaml.v2': 'go-yaml/yaml', 'gopkg.in/check.v1': 'go-check/check',
 'gopkg.in/errgo.v2': 'go-errgo/errgo', 'gopkg.in/fsnotify.v1': 'fsnotify/fsnotify', 'gopkg.in/tomb.v1': 'go-tomb/tomb'}
def mirror(mod):
    if mod in MIRRORS: return MIRRORS[mod]
    m = re.match(r'golang\.org/x/([a-z0-9]+)$', mod)
    if m: return 'golang/' + m.group(1)
    raise SystemExit('no mirror for ' + mod)
entries = {}
for l in open(os.path.join(G, 'go-ethereum', 'go.sum')):
    mod, ver, h = l.split()
    if mod.startswith('github.com/'): continue
    isgomod = ver.endswith('/go.mod'); v = ver[:-7] if isgomod else ver
    e = entries.setdefault((mod, v), {}); e['mod' if isgomod else 'zip'] = h
def run(*a, cwd=None, binary=False):
    r = subprocess.run(a, cwd=cwd, check=True, capture_output=True); return r.stdout if binary else r.stdout.decode().strip()
def repo(name):
    d = os.path.join(SRC, name.replace('/', '__'))
    if not os.path.isdir(d): run('git', 'clone', '-q', '--bare', f'https://github.com/{name}.git', d)
    return d
def resolve(d, ver):
    m = re.match(r'v\d+\.\d+\.\d+-(?:[0-9A-Za-z.]+\.)?\d{14}-([0-9a-f]{12})$', ver)
    ref = m.group(1) if m else ver
    return run('git', 'rev-parse', ref + '^{commit}', cwd=d)
def h1(files):
    lines = ''.join(f'{hashlib.sha256(b).hexdigest()}  {n}\n' for n, b in sorted(files))
    return 'h1:' + base64.b64encode(hashlib.sha256(lines.encode()).digest()).decode()
def is_vendored(name):
    if name.startswith('vendor/'): i = len('vendor/')
    elif '/vendor/' in name: i = len('/vendor/')
    else: return False
    return '/' in name[i:]
def tree_files(d, commit):
    data = run('git', 'archive', '--format=tar', commit, cwd=d, binary=True)
    t = tarfile.open(fileobj=io.BytesIO(data)); files = {}; dirs_with_gomod = set()
    for m in t.getmembers():
        if m.isfile():
            files[m.name] = t.extractfile(m).read()
            if m.name.endswith('/go.mod'): dirs_with_gomod.add(m.name[:-len('/go.mod')])
    out = []
    for n, b in files.items():
        parts = n.split('/')
        if any(p in ('.git', '.hg', '.svn', '.bzr') for p in parts[:-1]): continue
        if any('/'.join(parts[:i]) in dirs_with_gomod for i in range(1, len(parts))): continue
        if is_vendored(n): continue
        out.append((n, b))
    return out
bad = []; made = 0
for (mod, ver), e in sorted(entries.items()):
    d = repo(mirror(mod)); c = resolve(d, ver)
    try: gomod = run('git', 'show', f'{c}:go.mod', cwd=d, binary=True)
    except subprocess.CalledProcessError: gomod = f'module {mod}\n'.encode()
    vd = os.path.join(GP, mod, '@v'); os.makedirs(vd, exist_ok=True)
    if 'mod' in e:
        if h1([('go.mod', gomod)]) != e['mod']: bad.append((mod, ver, 'mod')); continue
        open(os.path.join(vd, ver + '.mod'), 'wb').write(gomod)
    if 'zip' in e:
        files = [(f'{mod}@{ver}/{n}', b) for n, b in tree_files(d, c)]
        if h1(files) != e['zip']: bad.append((mod, ver, 'zip')); continue
        with zipfile.ZipFile(os.path.join(vd, ver + '.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
            for n, b in sorted(files): z.writestr(n, b)
    ts = run('git', 'log', '-1', '--format=%cI', c, cwd=d)
    json.dump({'Version': ver, 'Time': ts}, open(os.path.join(vd, ver + '.info'), 'w'))
    lst = os.path.join(vd, 'list'); vs = set(open(lst).read().split()) if os.path.exists(lst) else set(); vs.add(ver)
    open(lst, 'w').write('\n'.join(sorted(vs)) + '\n'); made += 1
print('entries', len(entries), 'made', made, 'bad', bad)
sys.exit(1 if bad else 0)
