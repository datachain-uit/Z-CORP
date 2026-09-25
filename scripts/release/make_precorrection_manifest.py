#!/usr/bin/env python3
"""Pre-correction (July 2026) provenance manifest, rerun protocol v3 section 7.4.

Writes results/PRECORRECTION-2026-07.sha256 from git history only (no working-tree file is read
or changed). For every July measurement file it records the path, its first commit, the git
blob ID and sha256 of the committed original (the version unchanged through the last
pre-correction commit a723c22), and its state since then: unchanged, annotated (with the sha256
of the annotated copy and the commit that annotated it) or deleted (with the deleting commit).

    python3 scripts/release/make_precorrection_manifest.py [--repo .] [--check]

--check regenerates in memory and exits 1 if the committed file differs. Deterministic.
"""
import argparse
import hashlib
import os
import subprocess
import sys

LAST_PRECORRECTION = 'a723c22181df80100004e660a82c9bfdcc3a9f72'
OUT = 'results/PRECORRECTION-2026-07.sha256'
G = 'results/proving/4.2.2-Groth16-Prover-Side-performance'
P = 'results/proving/4.2.3-PLONK-Prover-Side-performance'
W = 'results/blockchain/4.1.2-Proof-verification-behavior-across-time-windows'
DEP = 'results/blockchain/4.1.1-Deployment-and-root-publication-cost'
C = 'results/constraints/4.2.1-The-Growth-of-Depth-Parameterized-Circuit'
# Section 7.4 table: the July (pre-correction) measurement files.
FILES = ([f'{G}/device{i}-groth16.csv' for i in (1, 2, 3)] + [f'{P}/device{i}-plonk.csv' for i in (1, 2, 3)] +
         [f'{W}/{n}' for n in ('20260711T091246-11-50-sepolia.csv', '20260711T092751-11-50-zkSyncSepolia.csv',
                              '20260711T131457-11-50-sepolia.csv', '20260711T132711-11-50-zkSyncSepolia.csv',
                              '20260712T030525-11-50-sepolia.csv', '20260712T031611-11-50-zkSyncSepolia.csv')] +
         [f'{DEP}/20260712T134135-deploy-sepolia.csv', f'{DEP}/20260712T134140-deploy-zkSyncSepolia.csv'] +
         [f'{C}/20260711T054936-depth5-15-constraints.csv'])
COLS = ['path', 'first_commit', 'first_commit_date', 'first_path', 'blob_original', 'sha256_original',
        'state', 'changed_by_commit', 'blob_now', 'sha256_now']


def git(repo, *a, ok_fail=False):
    r = subprocess.run(['git', '-C', repo, *a], capture_output=True)
    if r.returncode and not ok_fail:
        raise SystemExit(f'git {" ".join(a)}: {r.stderr.decode().strip()}')
    return r.stdout if not r.returncode else None


def blob_sha(repo, rev, path):
    b = git(repo, 'rev-parse', f'{rev}:{path}', ok_fail=True)
    if b is None:
        return None, None
    blob = b.decode().strip()
    return blob, hashlib.sha256(git(repo, 'cat-file', 'blob', blob)).hexdigest()


def build(repo):
    head = git(repo, 'rev-parse', 'HEAD').decode().strip()
    rows = []
    for path in sorted(FILES):
        log = git(repo, 'log', '--follow', '--format=%x00%H %aI', '--name-only', LAST_PRECORRECTION, '--', path).decode()
        entries = [e.strip().split('\n') for e in log.split('\x00') if e.strip()]
        first_commit, first_date = entries[-1][0].split(' ')
        first_path = [x for x in entries[-1][1:] if x.strip()][-1]
        blob_o, sha_o = blob_sha(repo, LAST_PRECORRECTION, path)
        blob_f, _ = blob_sha(repo, first_commit, first_path)
        if blob_o is None or blob_f != blob_o:
            raise SystemExit(f'{path}: committed original differs between first commit and {LAST_PRECORRECTION[:7]}')
        blob_n, sha_n = blob_sha(repo, head, path)
        changes = git(repo, 'log', '--format=%H', f'{LAST_PRECORRECTION}..{head}', '--', path).decode().split()
        if blob_n is None:
            state, by = 'deleted', changes[0] if changes else ''
        elif blob_n == blob_o:
            state, by = 'unchanged', ''
        else:
            state, by = 'annotated', changes[0] if changes else ''
        rows.append([path, first_commit, first_date, first_path, blob_o, sha_o, state, by, blob_n or '-', sha_n or '-'])
    head_note = [
        '# PRECORRECTION-2026-07.sha256 -- provenance of the pre-correction (July 2026) measurement files.',
        '# Rerun protocol v3, section 7.4. These files are superseded and not used by the CSI manuscript;',
        '# they are kept unchanged as historical evidence. Generated from git history by',
        '# scripts/release/make_precorrection_manifest.py; do not edit by hand.',
        f'# Committed originals: the versions unchanged through the last pre-correction commit {LAST_PRECORRECTION}.',
        '# state: unchanged | annotated (2026-09-21 explorer annotations, P4b) | deleted (superseded, P4c).',
        '# sha256_original is the sha256 of the committed original; sha256_now of the file at the commit that',
        '# generated this manifest (annotated copy), or "-" if deleted. Tab-separated.',
    ]
    lines = head_note + ['\t'.join(COLS)] + ['\t'.join(r) for r in rows]
    return ('\n'.join(lines) + '\n').encode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    data = build(a.repo)
    target = os.path.join(a.repo, OUT)
    if a.check:
        same = os.path.exists(target) and open(target, 'rb').read() == data
        print(f'{OUT}: {"up to date" if same else "DIFFERS"}')
        sys.exit(0 if same else 1)
    with open(target, 'wb') as f:
        f.write(data)
    print(f'wrote {OUT} ({len(FILES)} files); sha256 {hashlib.sha256(data).hexdigest()}')


if __name__ == '__main__':
    main()
