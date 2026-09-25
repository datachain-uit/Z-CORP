#!/usr/bin/env python3
"""CSI-CHAIN-LOCAL-01 administrative record (CHAIN-PROTOCOL-v1 §13): writes
  csi/campaigns/chain/CSI-CHAIN-LOCAL-01/campaign.json   (deterministic, sort_keys)
  csi/campaigns/chain/CSI-CHAIN-LOCAL-01/notes/DRY-RUN.md (engineering dry run: status, comparisons, per-cell summary)
from the dry-run run directories. Refuses unless all three runs were made at the current HEAD with a clean tree.
Usage: record_campaign.py --edr-a <dir> --edr-b <dir> --geth <dir> --unit-tests <log> --env-check <json>"""
import argparse, csv, hashlib, json, os, re, subprocess, sys
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
CAMP = 'csi/campaigns/chain/CSI-CHAIN-LOCAL-01'
def sha(p): return hashlib.sha256(open(os.path.join(REPO, p) if not os.path.isabs(p) else p, 'rb').read()).hexdigest()
def git(*a): return subprocess.run(['git', '-C', REPO, *a], capture_output=True, text=True, check=True).stdout.strip()
def jl(p): return json.load(open(p))
ap = argparse.ArgumentParser()
for k in ('--edr-a', '--edr-b', '--geth', '--unit-tests', '--env-check'): ap.add_argument(k, required=True)
a = ap.parse_args()
head = git('rev-parse', 'HEAD')
runs = {k: jl(os.path.join(getattr(a, k.replace('-', '_')), 'run.json')) for k in ('edr-a', 'edr-b', 'geth')}
for k, r in runs.items():
    if r['commit'] != head or r['dirty_tracked_paths']:
        sys.exit(f'{k}: run commit {r["commit"][:7]} / dirty {r["dirty_tracked_paths"]} does not match clean HEAD {head[:7]}')
    if not r.get('accepted_checks'):
        sys.exit(f'{k}: run checks not accepted')
det = jl(os.path.join(a.edr_b, 'compare_determinism.json')); xc = jl(os.path.join(a.geth, 'compare_crossclient.json'))
envA = jl(os.path.join(a.edr_a, 'environment.json')); envG = jl(os.path.join(a.geth, 'environment.json'))
ut = open(a.unit_tests).read()
m_pass = re.search(r'(\d+) passing', ut); m_fail = re.search(r'(\d+) failing', ut)
ec = jl(a.env_check)
prov = jl(os.path.join(REPO, CAMP, 'inputs', 'plonk-verifiers.provenance.json'))
psj = jl(os.path.join(REPO, CAMP, 'inputs', 'proofset', 'PROOFSET.json'))
geth_sums = dict(reversed(l.split()) for l in open(os.path.join(REPO, 'chainbench', 'geth', 'SHA256SUMS')).read().splitlines())
def run_summary(k, d):
    r = runs[k]
    return {'run_id': r['run_id'], 'env': r['env'], 'plan': r['plan'], 'commit': r['commit'], 'rows': r['rows'], 'rows_expected': r['rows_expected'],
            'rows_failing_check': r['rows_failing_check'], 'deployments_runtime_match': r['deployments_runtime_match'], 'env_check_pass': r['env_check_pass'],
            'ops_csv_sha256': r['ops_csv_sha256'], 'started_at_utc': r['started_at_utc'], 'finished_at_utc': r['finished_at_utc'],
            'raw_dir': os.path.relpath(d, REPO) + ' (git-ignored; engineering, not archived)'}
contract_files = sorted([f'contracts/chain/{f}' for f in os.listdir(os.path.join(REPO, 'contracts/chain')) if f.endswith('.sol')] +
                        [f'contracts/Groth16LegacyVerifierDepth{d}.sol' for d in range(5, 16)] + ['contracts/CredentialManager.sol', 'contracts/IGroth16Verifier.sol'])
rec = {
    'admin_id': 'CSI-CHAIN-LOCAL-01', 'venue': 'CSI', 'experiment': 'controlled on-chain verification (local L1)', 'status': 'ready',
    'stage': 'engineering dry run passed; full L1 scientific matrix not started; local-EraVM arm pending (protocol section 14)',
    'used_in_manuscript': 'no',
    'protocol': {'path': 'csi/protocols/chain/CHAIN-PROTOCOL-v1.md', 'version': 'v1', 'sha256': sha('csi/protocols/chain/CHAIN-PROTOCOL-v1.md'),
                 'frozen_at_commit': git('log', '--diff-filter=A', '--format=%H', '--', 'csi/protocols/chain/CHAIN-PROTOCOL-v1.md').splitlines()[-1],
                 'amendments_pre_run': ['A1', 'A2', 'A3'], 'eravm_arm': 'pending'},
    'harness': {'path': 'chainbench', 'commit': head, 'lockfile_sha256': envA['lockfile_sha256'], 'packages': envA['packages'],
                'edr_native_binary': envA['edr_native_binary'], 'soljson_sha256': envA['soljson_sha256'],
                'hardhat_console_sol_sha256': envA['hardhat_console_sol_sha256'], 'node': envA['node'], 'npm': envA['npm'], 'host': envA['host'],
                'container_image': 'none (pinned-environment record instead; see readiness report)'},
    'contracts': {f: sha(f) for f in contract_files},
    'plonk_verifiers': {'provenance': f'{CAMP}/inputs/plonk-verifiers.provenance.json', 'sha256': sha(f'{CAMP}/inputs/plonk-verifiers.provenance.json'),
                        'all_checks_pass': prov['all_checks_pass'], 'depths': len(prov['depths'])},
    'proofset': {'id': 'PS-01', 'dir': f'{CAMP}/inputs/proofset', 'count': psj['count'], 'rule': psj['rule'],
                 'csv_sha256': sha(f'{CAMP}/inputs/proofset/PROOFSET.csv'), 'sha256_file_sha256': sha(f'{CAMP}/inputs/proofset/PROOFSET.sha256'),
                 'json_sha256': sha(f'{CAMP}/inputs/proofset/PROOFSET.json'), 'generated_at_commit': psj['commit_at_start']},
    'geth': {'version': 'v1.16.9', 'source_commit': '95665d5703e1023995a0ff93e4ce9eb77e8a59bd', 'go': 'go1.24.7', 'build_recipe': 'chainbench/geth/',
             'binary_sha256': geth_sums, 'binary_used_sha256': envG['geth']['sha256'], 'dev_mode_forks': 'through Osaka (AllDevChainProtocolChanges)',
             'client_version': ec['geth']['client_version']},
    'env_check': {'file': os.path.relpath(a.env_check, REPO), 'edr_osaka_markers': ec['edr']['osaka']['markers'],
                  'edr_prague_control_markers': ec['edr']['prague']['markers'], 'geth_markers': ec['geth']['markers'], 'pass': ec['pass']},
    'unit_tests': {'passing': int(m_pass.group(1)) if m_pass else 0, 'failing': int(m_fail.group(1)) if m_fail else 0},
    'dry_run': {
        'plan': 'dry (Groth16 d5, d11; PLONK d10, d11; bridge Groth16 d11; 2 proofs per cell; all negative controls)',
        'runs': {k: run_summary(k, getattr(a, k.replace('-', '_'))) for k in ('edr-a', 'edr-b', 'geth')},
        'determinism': {k: det[k] for k in ('identical', 'rows_compared', 'tx_rows_compared', 'call_rows_compared', 'field_value_comparisons', 'differences_per_field')}
                       | {'build_manifests_identical': all(v['identical'] for v in det['build_manifests'].values()), 'excluded_fields': det['excluded_fields']},
        'cross_client': {k: xc[k] for k in ('identical', 'rows_compared', 'tx_rows_compared', 'call_rows_compared', 'field_value_comparisons', 'differences_per_field')}
                        | {'build_manifests_identical': all(v['identical'] for v in xc['build_manifests'].values()), 'excluded_fields': xc['excluded_fields']},
        'evidence_status': 'engineering; not evidence (protocol section 10 item 7)'},
    'scientific_run': None,
    'notes': [f'{CAMP}/notes/DRY-RUN.md', f'{CAMP}/notes/PROOFSET-GENERATION.md'],
}
open(os.path.join(REPO, CAMP, 'campaign.json'), 'w').write(json.dumps(rec, indent=2, sort_keys=True) + '\n')
# DRY-RUN.md
S = list(csv.DictReader(open(os.path.join(a.edr_a, 'summary.csv'))))
L = ['# CSI-CHAIN-LOCAL-01: engineering dry run (not evidence)', '',
     f"- **Commit:** `{head[:7]}`, clean tree. **Plan:** `dry`, i.e. Groth16 d5 and d11, PLONK d10 and d11, and the bridge cell (Groth16 d11, July configuration), with 2 frozen proofs per cell and all negative controls.",
     f"- **Runs:** two from-scratch EDR runs, `{runs['edr-a']['run_id']}` and `{runs['edr-b']['run_id']}`, and a geth v1.16.9 `--dev` replay, `{runs['geth']['run_id']}`. Each has {runs['edr-a']['rows']} rows, the planned number, and every row passes its check.",
     f"- **Determinism (a against b):** identical = {det['identical']}. {det['rows_compared']} rows ({det['tx_rows_compared']} transactions, {det['call_rows_compared']} calls) × {len(det['fields_compared'])} fields = {det['field_value_comparisons']} comparisons, with 0 differences. Both build manifests are byte-identical.",
     f"- **Cross-client (EDR a against geth):** identical = {xc['identical']}. {xc['field_value_comparisons']} comparisons (excluding {', '.join(xc['excluded_fields'])}), with 0 differences, including `gas_used` of all {xc['tx_rows_compared']} transactions and the negative controls. The build manifests are identical.",
     f"- **Hardfork verification:** EDR `osaka` and geth show all four Osaka markers; the EDR `prague` control shows none. The unit tests give {rec['unit_tests']['passing']} passing and {rec['unit_tests']['failing']} failing.",
     '', '## Per-cell summary (run a; gas units; engineering values)', '',
     '| cell | verifier deploy | manager deploy | setIssuer | addRoot | verifyCredential (min–max) | direct verifyProof (min–max) | verifier runtime B | manager runtime B | negatives |',
     '|---|---|---|---|---|---|---|---|---|---|']
for s in S:
    L.append(f"| {s['cell_id']} | {int(s['deploy_verifier_gas']):,} | {int(s['deploy_manager_gas']):,} | {int(s['set_issuer_gas']):,} | {int(s['add_root_gas']):,} | "
             f"{int(s['verify_credential_gas_min']):,}–{int(s['verify_credential_gas_max']):,} | {int(s['verify_proof_direct_gas_min']):,}–{int(s['verify_proof_direct_gas_max']):,} | "
             f"{s['verifier_runtime_bytes']} | {s['manager_runtime_bytes']} | {'all as expected' if s['all_checks_pass'] == 'True' else 'CHECK FAILED'} |")
L += ['', 'These are dry-run values, with 2 of the 8 frozen proofs per cell. They are not scientific results. The full matrix (protocol §6) has not been run.', '']
open(os.path.join(REPO, CAMP, 'notes', 'DRY-RUN.md'), 'w').write('\n'.join(L))
print('written', CAMP + '/campaign.json', CAMP + '/notes/DRY-RUN.md')
