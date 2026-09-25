#!/usr/bin/env python3
"""Publication hygiene of CSI-CHAIN-LOCAL-01-L2: redact the standard public development credentials that anvil-zksync prints in
its start-up banner (post-acceptance; not a measurement step).

Scope: an explicit allowlist of the 18 anvil-zksync start-up logs (anvil.stdout) of the accepted campaign
full-l2-e97b69f-20260925T132901Z (runs a and b: envcheck and the 8 cell nodes). In each, exactly three banner lines are
replaced in place by the stable marker below: the two lines of the "Private Keys" section, which display the private keys of
the two local development accounts, and the "Mnemonic:" line of the "Wallet" section. The line count and every other byte
are unchanged. Transaction traces, fee records (computational gas, pubdata), hashes, blocks, system-contract and toolchain
identities and fee-model values are not touched; no scientific script reads anvil.stdout (the fee trace is parsed from
anvil.log).

Recognition is by value: a banner line is redacted only if its value hashes to a known public value (sha256 of the lowercase
0x-prefixed private key of accounts 0 and 1 derived from the node's configured public mnemonic at m/44'/60'/0'/0/{0,1}; sha256
of that mnemonic). The script prints and stores no credential value. It refuses (exit 2; nothing written) on anything
unexpected: a missing, moved or reshaped banner; a credential line whose value is not a known public value; a partially
sanitised file; a known credential value anywhere else in the campaign directory. The one documented exception is the node
configuration: the mnemonic as the value of the anvil-zksync "-m" argument in environment.json (read by the validators), which
is retained and reported, as it is in the measurement code and the protocol.

    sanitize_chain_l2_devcreds.py                    sanitise (idempotent: sanitised files are left unchanged)
    sanitize_chain_l2_devcreds.py --check            exit 0 only if all 18 files are sanitised and no credential remains
    sanitize_chain_l2_devcreds.py --report FILE      also write the machine-readable report (JSON)
Standard library only.
"""
import argparse, hashlib, json, os, re, sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = 'results/chain-local-l2-20260925'
CID = 'full-l2-e97b69f-20260925T132901Z'
CELLS = [f'primary-{b}-d{d}' for b in ('groth16', 'plonk') for d in (5, 10, 11, 15)]
ALLOW = sorted([f'{SRC}/{CID}-{r}/envcheck/anvil.stdout' for r in 'ab'] + [f'{SRC}/{CID}-{r}/nodes/{c}/anvil.stdout' for r in 'ab' for c in CELLS])
MARKER = '[REDACTED: STANDARD PUBLIC DEVELOPMENT CREDENTIAL]'
BANNER_LINES = [25, 26, 32]  # 1-based: "(0) <key>", "(1) <key>", "Mnemonic: <phrase>" (identical position in all 18 logs)
KNOWN_KEYS = {'60a09e4357868c1e9b801052726d061c370429f723db84523ed58ac354f6eb8a': 'private key of development account (0)',
              '095101cf732c298a0ce0320b9de704209cdd8640b70d8fdf4e5be51aa2eb272e': 'private key of development account (1)'}
KNOWN_MNEMONIC = 'f79cd64f9cea237897b8133e4b905b361c6f166faa5a1c64c32280938f5b707e'
RETAINED_NOTE = ('the public development mnemonic remains as the value of the anvil-zksync "-m" argument in environment.json of runs a '
                 'and b (frozen node configuration, read by validate_l2.py, compare_l2.py and derive_chain_l2.py), as it does in the measurement '
                 'code (chainbench/lib/constants.js, chainbench/adapters/eravm/lib/constants.js) and the protocol; no private key remains')
KEY_RE = re.compile(r'(?<![0-9A-Za-z])(?:0x)?([0-9a-fA-F]{64})(?![0-9A-Za-z])')
WORDS_RE = re.compile(r'[a-z]+(?: [a-z]+)+')


def h(s): return hashlib.sha256(s.encode()).hexdigest()


class Refuse(Exception):
    pass


def secrets_in(text):
    """Known credential values in a text: [(line, kind)] (never the value)."""
    found = []
    for n, line in enumerate(text.split('\n'), 1):
        for m in KEY_RE.finditer(line):
            k = KNOWN_KEYS.get(h('0x' + m.group(1).lower()))
            if k:
                found.append((n, k))
        for m in WORDS_RE.finditer(line):
            w = m.group().split(' ')
            if any(h(' '.join(w[i:i + 12])) == KNOWN_MNEMONIC for i in range(len(w) - 11)):
                found.append((n, 'development mnemonic'))
    return found


def plan_file(rel):
    """-> (state, new_text, changes) for one allowlisted file; raises Refuse on anything unexpected."""
    text = open(os.path.join(REPO, rel), encoding='utf-8', newline='').read()
    L = text.split('\n')
    if L[22:24] != ['Private Keys', '========================'] or L[27:31] != ['', '', 'Wallet', '========================'] \
            or not L[32].startswith('Derivation path:') or L[26] != '':
        raise Refuse(f'{rel}: start-up banner not at the expected position')
    cur = [L[i - 1] for i in BANNER_LINES]
    if cur == [MARKER] * 3:
        state, changes = 'sanitised', []
    elif MARKER in cur:
        raise Refuse(f'{rel}: partially sanitised banner')
    else:
        changes = []
        for j, i in enumerate(BANNER_LINES[:2]):
            m = re.fullmatch(r'\((\d+)\) (0x[0-9a-fA-F]{64})', L[i - 1])
            if not m or int(m.group(1)) != j or h(m.group(2).lower()) not in KNOWN_KEYS:
                raise Refuse(f'{rel}:{i}: banner key line is not a known public development key')
            changes.append({'line': i, 'kind': KNOWN_KEYS[h(m.group(2).lower())]})
        m = re.fullmatch(r'Mnemonic:\s+(.+)', L[BANNER_LINES[2] - 1])
        if not m or h(m.group(1)) != KNOWN_MNEMONIC:
            raise Refuse(f'{rel}:{BANNER_LINES[2]}: mnemonic line is not the known public development mnemonic')
        changes.append({'line': BANNER_LINES[2], 'kind': 'development mnemonic'})
        state = 'raw'
    N = list(L)
    for i in BANNER_LINES:
        N[i - 1] = MARKER
    new = '\n'.join(N)
    rest = secrets_in(new)
    if rest:
        raise Refuse(f'{rel}: known credential value outside the banner lines at lines {[n for n, _ in rest]}')
    if sum(x == MARKER for x in N) != 3:
        raise Refuse(f'{rel}: unexpected marker elsewhere in the file')
    return state, new, changes, text


def scan_others():
    """Known credential values in the other campaign files; only the documented node configuration is allowed."""
    retained = []
    for root, dirs, files in os.walk(os.path.join(REPO, SRC)):
        dirs.sort()
        for fn in sorted(files):
            rel = os.path.relpath(os.path.join(root, fn), REPO)
            if rel in ALLOW:
                continue
            text = open(os.path.join(root, fn), encoding='utf-8', errors='replace').read()
            found = secrets_in(text)
            if not found:
                continue
            ok = fn == 'environment.json' and [k for _, k in found] == ['development mnemonic']
            if ok:
                args = json.loads(text)['node_options']['args']
                idx = [i for i, x in enumerate(args) if h(x) == KNOWN_MNEMONIC]
                ok = len(idx) == 1 and idx[0] > 0 and args[idx[0] - 1] == '-m'
            if not ok:
                raise Refuse(f'{rel}: unexpected credential value(s) at lines {[n for n, _ in found]} ({sorted({k for _, k in found})})')
            retained.append({'path': rel, 'json_path': f'node_options.args[{idx[0]}]', 'kind': 'development mnemonic (anvil-zksync -m argument; node configuration)'})
    return retained


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true'); ap.add_argument('--report')
    a = ap.parse_args()
    try:
        present = sorted(os.path.relpath(os.path.join(r, f), REPO) for r, _, fs in os.walk(os.path.join(REPO, SRC)) for f in fs if f == 'anvil.stdout')
        if present != ALLOW or len(ALLOW) != 18:
            raise Refuse(f'anvil.stdout files in {SRC} differ from the 18-file allowlist')
        plans = {rel: plan_file(rel) for rel in ALLOW}
        retained = scan_others()
    except Refuse as e:
        print(f'sanitize_chain_l2_devcreds: REFUSED: {e}', file=sys.stderr)
        sys.exit(2)
    files = []
    for rel in ALLOW:
        state, new, changes, old = plans[rel]
        files.append({'path': rel, 'state_before': state, 'changed_lines': changes, 'lines': old.count('\n') + 1,
                      'sha256_before': hashlib.sha256(old.encode()).hexdigest(), 'sha256_after': hashlib.sha256(new.encode()).hexdigest()})
    todo = [f for f in files if f['state_before'] == 'raw']
    if a.check:
        ok = not todo
        print(f"sanitize_chain_l2_devcreds --check: {'OK' if ok else 'NOT SANITISED'}: {len(files) - len(todo)}/{len(files)} files sanitised; "
              + ('no private key remains' if ok else f'banner credentials present in {len(todo)} files')
              + f"; retained configuration: {len(retained)} environment.json value(s)")
        sys.exit(0 if ok else 1)
    for f in todo:
        open(os.path.join(REPO, f['path']), 'w', encoding='utf-8', newline='').write(plans[f['path']][1])
        for c in f['changed_lines']:
            print(f"{f['path']}:{c['line']}: {c['kind']} -> {MARKER}")
    for f in files:
        if hashlib.sha256(open(os.path.join(REPO, f['path']), 'rb').read()).hexdigest() != f['sha256_after']:
            print(f"sanitize_chain_l2_devcreds: write verification failed: {f['path']}", file=sys.stderr)
            sys.exit(2)
    rep = {'tool': 'scripts/release/sanitize_chain_l2_devcreds.py', 'campaign_id': CID, 'marker': MARKER, 'banner_lines': BANNER_LINES,
           'rule': ('replace, in each allowlisted anvil-zksync start-up log, the two "Private Keys" banner lines and the "Mnemonic:" banner line '
                    'by the marker, only if their values are the known public development credentials; line count and all other bytes unchanged'),
           'known_values': 'sha256 of the lowercase 0x-prefixed private keys of accounts 0 and 1 and of the mnemonic (stored in the tool; no value stored)',
           'allowlist': ALLOW, 'files': files, 'retained_configuration': retained, 'retained_configuration_note': RETAINED_NOTE,
           'summary': {'files_allowlisted': len(files), 'files_changed': sum(bool(f['changed_lines']) for f in files) if todo else 0,
                       'lines_changed': sum(len(f['changed_lines']) for f in files) if todo else 0, 'files_already_sanitised': len(files) - len(todo)}}
    if a.report:
        open(a.report, 'w').write(json.dumps(rep, indent=2, sort_keys=True) + '\n')
    print(f"sanitize_chain_l2_devcreds: {rep['summary']['files_changed']} files changed, {rep['summary']['lines_changed']} lines; "
          f"{rep['summary']['files_already_sanitised']} already sanitised; retained configuration: {len(retained)}")


if __name__ == '__main__':
    main()
