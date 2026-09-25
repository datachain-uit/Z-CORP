#!/usr/bin/env python3
"""check-public-inputs (CHAIN-PUBLIC-PROTOCOL-v1 section 6): reviewer check of the frozen CSI-CHAIN-PUBLIC-01 inputs
against the accepted controlled study, with the standard library only (no compiler, no key, no network).

  - INPUTS.sha256 covers every input file; IDENTITY.json (the builder's 43 checks) all pass
  - EVM artifacts: init and runtime bytecode byte-identical to the frozen L1 build manifest of both EDR runs
  - EraVM artifacts: bytecode sha256 and EraVM bytecode hash equal to the frozen L2 build manifest
  - ABI: sha256(JSON of the stored ABI) equals the ABI digest of both frozen manifests
  - contract sources: unchanged since the controlled study (sha256)
  - proofs: PS-01 proof and public files match PROOFSET.csv; verifyCredential calldata = selector + the ABI words of
    the stored arguments; its sha256 equals the controlled L1 (runs a, b) and L2 (runs a, b) raw rows; addRoot likewise
Full regeneration (zksolc, snarkjs): node chainbench/adapters/public/scripts/build_public_inputs.js --check in the
chainbench-l2 image.
"""
import csv, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
B = json.load(open(os.path.join(REPO, 'chainbench', 'workloads', 'zcorp', 'campaigns', 'CSI-CHAIN-PUBLIC-01.json')))
D = os.path.join(REPO, B['inputs_dir'])
res = []


def check(name, ok, detail=''):
    res.append((bool(ok), name, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{' — ' + str(detail) if detail != '' else ''}")


def sha(b):
    return hashlib.sha256(b).hexdigest()


def rows(rel):
    with open(os.path.join(REPO, rel), newline='') as f:
        return list(csv.DictReader(f))


man = open(os.path.join(D, 'INPUTS.sha256')).read().split('\n')
bad = [l.split()[1] for l in man if l.strip() and sha(open(os.path.join(D, l.split()[1]), 'rb').read()) != l.split()[0]]
files = sorted(os.path.relpath(os.path.join(r, f), D) for r, _, fs in os.walk(D) for f in fs if f != 'INPUTS.sha256')
check('INPUTS.sha256 covers every input file and verifies', not bad and files == sorted(l.split()[1] for l in man if l.strip()), bad)
idn = json.load(open(os.path.join(D, 'IDENTITY.json')))
check('IDENTITY.json: all builder identity checks pass', idn['all_pass'] and all(c['pass'] for c in idn['checks']), f"{sum(c['pass'] for c in idn['checks'])}/{len(idn['checks'])}")
L1, L2 = B['controlled_references']['l1'], B['controlled_references']['l2']
m1a = json.load(open(os.path.join(REPO, L1['build_manifest'])))['contracts']
m1b = json.load(open(os.path.join(REPO, L1['build_manifest'].replace('-edr-a/', '-edr-b/'))))['contracts']
m2 = json.load(open(os.path.join(REPO, L2['build_manifest'])))['contracts']
for venue in ('evm', 'eravm'):
    for fn in sorted(os.listdir(os.path.join(D, 'deployment', venue))):
        a = json.load(open(os.path.join(D, 'deployment', venue, fn)))
        key = f"{a['source']}:{a['name']}"
        abi_sha = sha(json.dumps(a['abi'], separators=(',', ':'), ensure_ascii=False).encode())
        src_ok = sha(open(os.path.join(REPO, a['source']), 'rb').read()) == a['source_sha256']
        if venue == 'evm':
            ok = all(a['bytecode'] == m[key]['init_hex'] and a['deployedBytecode'] == m[key]['runtime_hex'] for m in (m1a, m1b))
            ok = ok and sha(bytes.fromhex(a['bytecode'][2:])) == a['init_sha256'] and sha(bytes.fromhex(a['deployedBytecode'][2:])) == a['runtime_sha256']
            check(f"EVM {a['name']}: init/runtime bytecode = frozen L1 build manifest (runs a, b)", ok, a['runtime_keccak'])
            check(f"EVM {a['name']}: ABI digest = L1 and L2 manifests; source unchanged", abi_sha == m1a[key]['abi_sha256'] == m2[key]['abi_sha256'] and src_ok, abi_sha[:16])
        else:
            ok = sha(bytes.fromhex(a['bytecode'][2:])) == a['bytecode_sha256'] == m2[key]['bytecode_sha256'] and a['bytecode_hash'] == m2[key]['bytecode_hash']
            check(f"EraVM {a['name']}: bytecode sha256 and hash = frozen L2 build manifest", ok, a['bytecode_hash'])
            check(f"EraVM {a['name']}: ABI digest = L1 and L2 manifests; source unchanged", abi_sha == m1a[key]['abi_sha256'] == m2[key]['abi_sha256'] and src_ok, abi_sha[:16])
P = json.load(open(os.path.join(D, 'proofs', 'd11.json')))
ps = {r['proof_id']: r for r in rows(os.path.join(B['proofset_dir'], 'PROOFSET.csv'))}
# the controlled rows of the primary profile at depth 11 (the L1 bridge profile is a separate historical cell)
ops = {'l1': [x for x in rows(L1['ops']) + rows(L1['ops'].replace('-edr-a/', '-edr-b/')) if x['profile'] == 'primary' and x['depth'] == '11'],
       'l2': [x for x in rows(L2['ops']) + rows(L2['ops'].replace('-a/', '-b/')) if x['depth'] == '11']}


def words(x):
    if isinstance(x, list):
        return [w for y in x for w in words(y)]
    return [int(x, 16) if isinstance(x, str) and x.startswith('0x') else int(x)]


for p in P['proofs']:
    r = ps[p['proof_id']]
    pdir = os.path.join(REPO, B['proofset_dir'])
    fok = sha(open(os.path.join(pdir, r['proof_file']), 'rb').read()) == r['proof_sha256'] == p['proof_sha256'] and sha(open(os.path.join(pdir, r['public_file']), 'rb').read()) == r['public_sha256'] == p['public_sha256']
    check(f"{p['proof_id']}: PS-01 proof and public files match PROOFSET.csv", fok)
    data = bytes.fromhex(p['verify_credential_calldata'][2:])
    enc = b''.join(w.to_bytes(32, 'big') for w in words(p['args']))
    dsha = sha(data)
    ctl = [x['calldata_sha256'] for k in ('l1', 'l2') for x in ops[k] if x['op'] == 'verify_credential' and x['proof_id'] == p['proof_id'] and x['depth'] == '11']
    check(f"{p['proof_id']}: calldata = selector + ABI words of the stored arguments; sha256 = controlled L1 and L2 raw rows (4 rows)",
          data[4:] == enc and dsha == p['verify_credential_calldata_sha256'] and len(ctl) == 4 and all(h == dsha for h in ctl) and str(int(p['root'])) == r['root'], dsha[:16])
ar = sha(bytes.fromhex(P['add_root_calldata'][2:]))
ctl = [x['calldata_sha256'] for k in ('l1', 'l2') for x in ops[k] if x['op'] == 'add_root']
check('addRoot calldata sha256 = every controlled depth-11 L1 and L2 add_root row', ar == P['add_root_calldata_sha256'] and len(ctl) == 8 and all(h == ar for h in ctl), f'{len(ctl)} rows')
fails = sum(1 for ok, _, _ in res if not ok)
print(f"CHECK-PUBLIC-INPUTS: {len(res) - fails}/{len(res)} checks pass")
sys.exit(1 if fails else 0)
