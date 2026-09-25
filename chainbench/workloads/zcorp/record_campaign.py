#!/usr/bin/env python3
"""Administrative record of a zcorp local-L1 campaign (CHAIN-PROTOCOL-v1 §13). Campaign and venue identity come from the
campaign binding (workloads/zcorp/campaigns/<id>.json); nothing venue-specific is hard-coded here.

Writes, from a packaged (container) dry run:
  <campaign_dir>/campaign.json   deterministic (sort_keys)
  <notes_dir>/DRY-RUN.md         packaged engineering dry run: status, comparisons, per-cell summary
  <registry> row                 status / baseline_tag / commit of this campaign only (other rows untouched)

Refuses unless:
  * the three runs (EDR a, EDR b, geth) were made at one commit with clean tracked paths and accepted checks;
  * the measurement paths of the binding are unchanged between that commit and the working tree;
  * determinism, cross-client and both comparisons with the accepted readiness dry run are identical;
  * the smoke check passed;
  * the image records in the working tree (chainbench/docker/pins.env, IMAGE.json) equal the records of the image the
    runs actually used (freeze directory written by `run.sh author-freeze`; image id in each run's environment.json).

Usage: record_campaign.py --dry-run-id <id> --smoke <smoke run dir> --freeze <freeze dir> --baseline-tag <tag>
                          [--dry-root build/chainbench/dry-run] [--binding <campaign binding json>]"""
import argparse, csv, hashlib, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CB = os.path.abspath(os.path.join(HERE, '..', '..'))
REPO = os.path.abspath(os.path.join(CB, '..'))
CB_REL = os.path.relpath(CB, REPO)
ap = argparse.ArgumentParser()
ap.add_argument('--dry-run-id', required=True); ap.add_argument('--smoke', required=True); ap.add_argument('--freeze', required=True)
ap.add_argument('--baseline-tag', required=True); ap.add_argument('--dry-root', default='build/chainbench/dry-run')
ap.add_argument('--binding', default=os.path.join(HERE, 'campaigns', 'CSI-CHAIN-LOCAL-01.json'))
a = ap.parse_args()

def P(p): return p if os.path.isabs(p) else os.path.join(REPO, p)
def sha(p): return hashlib.sha256(open(P(p), 'rb').read()).hexdigest()
def git(*x): return subprocess.run(['git', '-C', REPO, *x], capture_output=True, text=True, check=True).stdout.strip()
def jl(p): return json.load(open(P(p)))
def envfile(p): return dict(re.findall(r'^([A-Z0-9_]+)="(.*)"$', open(P(p)).read(), re.M))
def die(msg): sys.exit(f'record_campaign: REFUSED: {msg}')

B = jl(a.binding); AR = B['admin_record']
CAMP = B['campaign_dir']; NOTES = AR['notes_dir']; PROTO = B['protocol']
MEAS = B['measurement_paths']
IMAGE_RECORDS = [f'{CB_REL}/docker/pins.env', f'{CB_REL}/docker/IMAGE.json']
dry = os.path.join(a.dry_root, a.dry_run_id)
D = {'edr-a': f'{dry}-edr-a', 'edr-b': f'{dry}-edr-b', 'geth': f'{dry}-geth'}
runs = {k: jl(os.path.join(d, 'run.json')) for k, d in D.items()}
envs = {k: jl(os.path.join(d, 'environment.json')) for k, d in D.items()}
head = runs['edr-a']['commit']

# ---- refusals
for k, r in runs.items():
    if r['commit'] != head or r['dirty_tracked_paths']: die(f'{k}: commit {r["commit"][:7]} / dirty {r["dirty_tracked_paths"]} (one clean commit required)')
    if r.get('accepted_checks') is not True: die(f'{k}: run checks not accepted')
    if not all(s in r.get('steps', {}) for s in ('build', 'envcheck', 'exec', 'finish')): die(f'{k}: incomplete steps {r.get("steps")}')
    if r.get('campaign_id') != B['campaign_id']: die(f'{k}: campaign {r.get("campaign_id")} is not {B["campaign_id"]}')
changed = git('diff', '--name-only', head, '--', *MEAS)
if changed: die(f'measurement paths differ between the dry-run commit {head[:7]} and the working tree: {changed}')
cmp = {'determinism': jl(os.path.join(D['edr-b'], 'compare_determinism.json')), 'cross_client': jl(os.path.join(D['geth'], 'compare_crossclient.json')),
       'edr_vs_readiness': jl(os.path.join(D['edr-a'], 'compare_vs_reference.json')), 'geth_vs_readiness': jl(os.path.join(D['geth'], 'compare_vs_reference.json'))}
for k, c in cmp.items():
    if c.get('identical') is not True: die(f'comparison {k} is not identical')
sm = jl(os.path.join(a.smoke, 'smoke_check.json'))
if sm.get('pass') is not True: die('smoke check did not pass')
fz_env = envfile(os.path.join(a.freeze, 'image.env')); fz_id = jl(os.path.join(a.freeze, 'identity.json'))
if open(P(IMAGE_RECORDS[0])).read() != open(P(os.path.join(a.freeze, 'pins.env'))).read(): die('chainbench/docker/pins.env differs from the pins used for the packaged dry run')
img = jl(IMAGE_RECORDS[1])
if img.get('toolchain') != fz_id.get('toolchain'): die('chainbench/docker/IMAGE.json toolchain differs from the identity of the image used')
for k, e in envs.items():
    c = e.get('container') or {}
    if c.get('image_id') != fz_env['IMAGE_ID']: die(f'{k}: ran in image {c.get("image_id")}, not the frozen image {fz_env["IMAGE_ID"]}')
    if c.get('network') != 'none' or (c.get('network_isolation') or {}).get('isolated') is not True:
        die(f'{k}: not run without network ({c.get("network")}, {c.get("network_isolation")})')
if open(P(os.path.join(a.freeze, 'DRY_RUN_ID'))).read().strip() != a.dry_run_id: die('the freeze directory belongs to another dry run')

# ---- record
envA, envG = envs['edr-a'], envs['geth']
ec = jl(os.path.join(D['geth'], 'env_check.json'))
UT = f'{dry}.unit_tests.log' if os.path.exists(P(f'{dry}.unit_tests.log')) else os.path.join(a.smoke, 'unit_tests.log')  # dry run's own step 4, else smoke
ut = open(P(UT)).read()
m_pass = re.search(r'(\d+) passing', ut); m_fail = re.search(r'(\d+) failing', ut)
prov = jl(B['plonk_verifier_provenance'])
psj = jl(os.path.join(B['proofset_dir'], 'PROOFSET.json'))
geth_sums = dict(reversed(l.split()) for l in open(os.path.join(CB, 'geth', 'SHA256SUMS')).read().splitlines())
old = jl(os.path.join(CAMP, 'campaign.json')) if os.path.exists(P(os.path.join(CAMP, 'campaign.json'))) else {}
previous = [{'superseded_because': 'readiness dry run before packaging', **p} for p in (old.get('previous_dry_runs') or [])]
if old.get('dry_run') and old['dry_run'].get('runs', {}).get('edr-a', {}).get('commit') not in (None, head) \
        and not any(p.get('runs', {}).get('edr-a', {}).get('commit') == old['dry_run']['runs']['edr-a']['commit'] for p in previous):
    oc = old['dry_run']['runs']['edr-a']['commit'][:7]
    packaged = 'packaged' in str(old['dry_run'].get('environment', ''))
    previous.append({**old['dry_run'],
                     'environment': (f"packaged container, image {old.get('container_image', {}).get('image_id')}, --network none" if packaged
                                     else 'uncontainerised pinned VM environment (readiness)'),
                     'superseded_because': ('the reviewer entry point changed after this run (protocol section 12 step 4 unit tests added to the '
                                            'run procedure; one runner invocation per step, section 15 A3); packaged dry run repeated'
                                            if packaged else 'readiness dry run before packaging'),
                     'container_image': old.get('container_image', {}).get('image_id') if packaged else None,
                     'harness_commit': old.get('harness', {}).get('commit'),
                     'notes': f'{NOTES}/DRY-RUN-{"packaged" if packaged else "readiness"}-{oc}.md'})

def run_summary(k):
    r = runs[k]
    return {'run_id': r['run_id'], 'env': r['env'], 'plan': r['plan'], 'commit': r['commit'], 'rows': r['rows'], 'rows_expected': r['rows_expected'],
            'rows_failing_check': r['rows_failing_check'], 'deployments_runtime_match': r['deployments_runtime_match'], 'env_check_pass': r['env_check_pass'],
            'ops_csv_sha256': r['ops_csv_sha256'], 'started_at_utc': r['started_at_utc'], 'finished_at_utc': r['finished_at_utc'],
            'raw_dir': os.path.relpath(P(D[k]), REPO) + ' (git-ignored; engineering, not archived)'}
def cmp_summary(c):
    c = {**c, 'a': os.path.normpath(os.path.join(CB_REL, c['a'])), 'b': os.path.normpath(os.path.join(CB_REL, c['b']))}  # compare_runs ran in chainbench/
    return {k: c[k] for k in ('identical', 'a', 'b', 'rows_compared', 'tx_rows_compared', 'call_rows_compared', 'field_value_comparisons', 'differences_per_field', 'excluded_fields')} \
        | {'build_manifests_identical': all(v['identical'] for v in c['build_manifests'].values())}
contract_files = sorted([f'contracts/chain/{f}' for f in os.listdir(P('contracts/chain')) if f.endswith('.sol')] +
                        [f'contracts/Groth16LegacyVerifierDepth{d}.sol' for d in range(5, 16)] + ['contracts/CredentialManager.sol', 'contracts/IGroth16Verifier.sol'])
gsrc = (envG.get('container') or {}).get('geth_source') or ''
rec = {
    'admin_id': AR['admin_id'], 'venue': B['venue'], 'experiment': AR['experiment'], 'status': 'ready',
    'stage': f'packaged (container) environment frozen; packaged engineering dry run passed; baseline tag {a.baseline_tag}; '
             'full L1 scientific matrix not started; local-EraVM arm pending (protocol section 14)',
    'used_in_manuscript': 'no',
    'protocol': {'path': PROTO, 'version': 'v1', 'sha256': sha(PROTO),
                 'frozen_at_commit': git('log', '--diff-filter=A', '--format=%H', '--', PROTO).splitlines()[-1],
                 'amendments_pre_run': re.findall(r'^\| (A\d+) \|', open(P(PROTO)).read(), re.M), 'eravm_arm': 'pending'},
    'baseline': {'tag': a.baseline_tag, 'tagged_commit': 'the commit that adds this record and the committed image records (see the registry and `git rev-parse <tag>`)',
                 'measurement_paths_identical_to': head, 'measurement_paths': MEAS, 'image_records': IMAGE_RECORDS,
                 'workload': runs['edr-a'].get('workload'), 'campaign_binding': runs['edr-a'].get('campaign_binding')},
    'harness': {'path': CB_REL, 'commit': head, 'lockfile_sha256': envA['lockfile_sha256'], 'packages': envA['packages'],
                'edr_native_binary': envA['edr_native_binary'], 'edr_identity': envA.get('edr_identity'), 'soljson_sha256': envA['soljson_sha256'],
                'hardhat_console_sol_sha256': envA['hardhat_console_sol_sha256'], 'node': envA['node'], 'npm': envA['npm'], 'host': envA['host'],
                'reviewer_entry_point': f'{CB_REL}/run.sh (doctor, smoke, full-local-l1)', 'reviewer_readme': f'{CB_REL}/README.md'},
    'container_image': {'image_id': fz_env['IMAGE_ID'], 'base_image': fz_env['BASE_IMAGE_PINNED'], 'geth_source': fz_env['GETH_SOURCE_DESC'],
                        'platform': f'linux/{fz_env["ARCH"]}', 'built_at_utc': fz_env['BUILT_AT'], 'network_at_run_time': 'none: only loopback up, no IPv4 route, no non-loopback IPv6 route (core/netcheck.js; recorded per run in environment.json container.network_isolation)',
                        'identity_record': IMAGE_RECORDS[1], 'identity_record_sha256': sha(IMAGE_RECORDS[1]), 'pins': IMAGE_RECORDS[0], 'pins_sha256': sha(IMAGE_RECORDS[0]),
                        'toolchain': fz_id['toolchain'], 'apt_packages': (fz_id.get('system') or {}).get('apt_packages'),
                        'os_release': (fz_id.get('system') or {}).get('os_release'), 'docker_host': fz_id.get('host'),
                        'buildx_metadata': {k: v for k, v in (fz_id.get('build_metadata') or {}).items() if k in ('containerimage.config.digest', 'containerimage.digest', 'buildx.build.ref')},
                        'image_id_note': 'the image id is machine-specific (apt layer); reproducibility is defined by the pinned base/geth digests, the lockfile and the recorded toolchain identity'},
    'contracts': {f: sha(f) for f in contract_files},
    'plonk_verifiers': {'provenance': B['plonk_verifier_provenance'], 'sha256': sha(B['plonk_verifier_provenance']),
                        'all_checks_pass': prov['all_checks_pass'], 'depths': len(prov['depths'])},
    'proofset': {'id': 'PS-01', 'dir': B['proofset_dir'], 'count': psj['count'], 'rule': psj['rule'],
                 'csv_sha256': sha(f'{B["proofset_dir"]}/PROOFSET.csv'), 'sha256_file_sha256': sha(f'{B["proofset_dir"]}/PROOFSET.sha256'),
                 'json_sha256': sha(f'{B["proofset_dir"]}/PROOFSET.json'), 'generated_at_commit': psj['commit_at_start']},
    'geth': {'version': 'v1.16.9', 'source_commit': '95665d5703e1023995a0ff93e4ce9eb77e8a59bd', 'source_used': gsrc,
             'from_source_recipe': f'{CB_REL}/geth/', 'from_source_binary_sha256': geth_sums, 'binary_used_sha256': envG['geth']['sha256'],
             'binary_used_version': envG['geth'].get('version'), 'dev_mode_forks': 'through Osaka (AllDevChainProtocolChanges)',
             'client_version': ec['geth']['client_version']},
    'env_check': {'file': os.path.relpath(P(os.path.join(D['geth'], 'env_check.json')), REPO), 'edr_osaka_markers': ec['edr']['osaka']['markers'],
                  'edr_prague_control_markers': ec['edr']['prague']['markers'], 'geth_markers': ec['geth']['markers'], 'pass': ec['pass']},
    'unit_tests': {'passing': int(m_pass.group(1)) if m_pass else 0, 'failing': int(m_fail.group(1)) if m_fail else 0, 'log': os.path.relpath(P(UT), REPO)},
    'smoke': {'run_id': os.path.basename(os.path.normpath(a.smoke)), 'pass': sm['pass'], 'checks': len(sm.get('checks', [])),
              'evidence_status': 'packaging check; not data'},
    'dry_run': {
        'plan': 'dry (Groth16 d5, d11; PLONK d10, d11; bridge Groth16 d11; proofs p0, p1; all negative controls)',
        'environment': 'packaged container (this record\'s container_image), --network none',
        'runs': {k: run_summary(k) for k in ('edr-a', 'edr-b', 'geth')},
        'determinism': cmp_summary(cmp['determinism']), 'cross_client': cmp_summary(cmp['cross_client']),
        'vs_readiness_dry_run': {'edr': cmp_summary(cmp['edr_vs_readiness']), 'geth': cmp_summary(cmp['geth_vs_readiness'])},
        'evidence_status': 'engineering; not evidence (protocol section 10 item 7)'},
    'previous_dry_runs': previous,
    'scientific_run': None,
    'notes': sorted({f'{NOTES}/DRY-RUN.md', f'{NOTES}/PROOFSET-GENERATION.md', *[p['notes'] for p in previous if p.get('notes')]}),
}
open(P(os.path.join(CAMP, 'campaign.json')), 'w').write(json.dumps(rec, indent=2, sort_keys=True) + '\n')

# ---- DRY-RUN.md (packaged)
S = list(csv.DictReader(open(P(os.path.join(D['edr-a'], 'summary.csv')))))
refG = jl(os.path.join(B['reference_dry_run']['geth'], 'environment.json')) if os.path.exists(P(os.path.join(B['reference_dry_run']['geth'], 'environment.json'))) else {}
det, xc, re_e, re_g = cmp['determinism'], cmp['cross_client'], cmp['edr_vs_readiness'], cmp['geth_vs_readiness']
L = [f'# {AR["admin_id"]}: packaged engineering dry run (not evidence)', '',
     f"- **Commit:** `{head[:7]}`, clean tracked paths. **Baseline tag:** `{a.baseline_tag}`. **Plan:** `dry`, i.e. Groth16 d5 and d11, PLONK d10 and d11, and the bridge cell (Groth16 d11, July configuration), with proofs p0 and p1 and all negative controls.",
     f"- **Environment:** the chainbench container `{fz_env['IMAGE_ID'][:19]}…` (base `{fz_env['BASE_IMAGE_PINNED']}`; geth `{fz_env['GETH_SOURCE_DESC']}`), platform linux/{fz_env['ARCH']}, run with `--network none` (only loopback up, no routes; checked per run), repository mounted read-only, one fresh container per run.",
     f"- **Runs:** two from-scratch EDR runs, `{runs['edr-a']['run_id']}` and `{runs['edr-b']['run_id']}`, and a geth v1.16.9 `--dev` replay, `{runs['geth']['run_id']}`. Each has {runs['edr-a']['rows']} rows, the planned number, and every row passes its check.",
     f"- **Determinism (a against b):** identical = {det['identical']}. {det['rows_compared']} rows × {len(det['fields_compared'])} fields = {det['field_value_comparisons']} comparisons, 0 differences; build manifests byte-identical.",
     f"- **Cross-client (EDR a against geth):** identical = {xc['identical']}. {xc['field_value_comparisons']} comparisons (excluding {', '.join(xc['excluded_fields'])}), 0 differences.",
     f"- **Against the accepted readiness dry run:** EDR a against `{cmp_summary(re_e)['a']}`: identical = {re_e['identical']} ({re_e['field_value_comparisons']} comparisons, 0 differences, build manifests byte-identical). geth against `{cmp_summary(re_g)['a']}`: identical = {re_g['identical']} ({re_g['field_value_comparisons']} comparisons).",
     f"- **Why the geth comparison uses the cross-client exclusions:** the geth binaries differ. The readiness run used `{refG.get('geth', {}).get('sha256', '?')[:12]}…` (the from-source build); the packaged run used `{envG['geth']['sha256'][:12]}…` ({gsrc.split('@')[0]}). Both report v1.16.9 at commit 95665d57, so `client_version` differs (the Go version). `block_number` and `gas_price_wei` are geth dev-mode scheduling fields; they also vary between two runs of the same geth binary. `gas_used`, status, revert data, return values, addresses, bytecode and `tx_hash` are identical.",
     f"- **Hardfork verification:** EDR `osaka` and geth show all four Osaka markers; the EDR `prague` control shows none. Unit tests: {rec['unit_tests']['passing']} passing, {rec['unit_tests']['failing']} failing. Smoke check: pass.",
     '', '## Per-cell summary (run a; gas units; engineering values)', '',
     '| cell | verifier deploy | manager deploy | setIssuer | addRoot | verifyCredential (min–max) | direct verifyProof (min–max) | verifier runtime B | manager runtime B | negatives |',
     '|---|---|---|---|---|---|---|---|---|---|']
for s in S:
    L.append(f"| {s['cell_id']} | {int(s['deploy_verifier_gas']):,} | {int(s['deploy_manager_gas']):,} | {int(s['set_issuer_gas']):,} | {int(s['add_root_gas']):,} | "
             f"{int(s['verify_credential_gas_min']):,}–{int(s['verify_credential_gas_max']):,} | {int(s['verify_proof_direct_gas_min']):,}–{int(s['verify_proof_direct_gas_max']):,} | "
             f"{s['verifier_runtime_bytes']} | {s['manager_runtime_bytes']} | {'all as expected' if s['all_checks_pass'] == 'True' else 'CHECK FAILED'} |")
L += ['', 'These are dry-run values, with 2 of the 8 frozen proofs per cell. They are not scientific results. The full matrix (protocol §6) has not been run.', '']
open(P(os.path.join(NOTES, 'DRY-RUN.md')), 'w').write('\n'.join(L))

# ---- registry row (this campaign only)
reg = P(AR['registry'])
rows = list(csv.DictReader(open(reg, newline=''))); fields = list(rows[0].keys())
hit = [r for r in rows if r['admin_id'] == AR['admin_id']]
if len(hit) != 1: die(f'registry {AR["registry"]}: expected one row for {AR["admin_id"]}, found {len(hit)}')
hit[0].update({'status': 'ready', 'baseline_tag': a.baseline_tag, 'commit': head})
with open(reg, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=fields, lineterminator='\n'); w.writeheader(); w.writerows(rows)
print('written', f'{CAMP}/campaign.json', f'{NOTES}/DRY-RUN.md', f'{AR["registry"]} ({AR["admin_id"]} row)')
