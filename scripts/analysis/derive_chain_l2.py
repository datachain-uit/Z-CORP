#!/usr/bin/env python3
"""Derivations of the CSI-CHAIN-LOCAL-01-L2 campaign: the local-EraVM arm of CSI-CHAIN-LOCAL-01
(CHAIN-PROTOCOL-v1 section 16, amendments A6 and A7). Fixed before the scientific L2 run; tested on the readiness dry run.

Reads one L2 campaign directory -- the two runs <id>-a and <id>-b and, for the scientific plan, the campaign files
<id>.preflight.json and <id>.postflight.json -- re-checks section 16.6 independently of the runner (V1-V13, determinism,
identities), and derives descriptive quantities from the accepted raw rows of run a (run b is checked identical first).
Every gas value is EraVM gas; nothing here is comparable with EVM gas, and no fee, cost, latency or finality is derived.
No thresholds, no exclusions, no rounding of gas values. Standard library only; deterministic output. Exit 2 if any check
fails (nothing is written then).

    python3 scripts/analysis/derive_chain_l2.py --campaign <dir> --out <dir> [--repo .] [--plan full|dry|smoke]
        [--expect-campaign-id ID] [--expect-commit SHA] [--expect-tag TAG] [--expect-image-id ID] [--expect-protocol-sha256 SHA]

Outputs (in --out):
  l2_ops.csv                every row of run a (transactions and calls), measurement columns
  l2_cells.csv              per cell: deployments, setIssuer, addRoot, verification (min/max over K), manager overhead, sizes
  l2_proofs.csv             per cell and proof: manager-level and direct verification, manager overhead
  l2_negatives.csv          negative controls by expected/observed status, revert reason, return (gas not interpreted, 7.2)
  l2_ranges.csv             per backend and operation: ranges over depths and proofs
  l2_compile_sizes.csv      compile-only EraVM bytecode sizes of every contract of the build manifest (all 11 depths)
  l2_backend_comparison.csv descriptive PLONK / Groth16 ratios per depth, within EraVM units only
  validation.json           every check re-evaluated from the raw data
  values.tex                machine-readable macros (\\zl...)
  derivation.json           tool, inputs and outputs sha256, identities, rules
"""
import argparse, csv, hashlib, io, json, os, re, subprocess, sys

ENV_LABEL = ('EraVM execution under protocol v29 (anvil-zksync 0.6.11 built-in v29 system contracts; bootloader and default-account '
             'hashes differ from live Era Sepolia; no EVM emulator; fixed local fee input)')
# Frozen by A6 (section 16); these are not read from the runner, so the checks are independent of it.
FEE = {'base_fee': 45250000, 'fair_l2_gas_price': 45250000, 'fair_pubdata_price': 3784558330, 'gas_per_pubdata': 84}
TX = {'tx_type': 113, 'max_fee_per_gas_wei': 45250000, 'gas_per_pubdata_limit': 50000, 'chain_id': 260, 'protocol_version': 'Version29'}
GAS_LIMIT = {'deploy_verifier': 20000000, 'deploy_manager': 20000000, 'set_issuer': 2000000, 'add_root': 2000000, 'verify_credential': 10000000,
             'verify_proof_direct': 10000000, 'neg_unknown_root': 10000000, 'neg_tampered': 10000000, 'neg_cross_depth_setup': 2000000,
             'neg_cross_depth': 10000000, 'neg_non_issuer': 2000000}
SYSTEM = {'bootloader hash': '0x0100092f045c41c21bd08a9c6fa909fa6a8b446e3f6cd9f08356352a3195a40c',
          'default AA hash': '0x010005f74935e95e527d18ea9bfc82906fb20903a5683c528ee7af404e9bd531', 'protocol version (block 0)': 'Version29'}
PINS_ARM64 = {'anvil_zksync': '565ea5418561937d704c5ef0b2fcea1cb01cd2338e45fdd32ac0516395938216',
              'zksolc': 'ee4f02f8614ef320fc95d2f15c69678bb1781f9526df78fb35a906180c998b44',
              'era_solc': 'd98d1068b3bff4679a32585ea75febbf75b004a2870a3e2ebf191550f36950b2'}
MAX_BYTECODE = (2 ** 16 - 1) * 32
COLUMNS = ['campaign_id', 'arm', 'run_id', 'plan', 'env', 'node_version', 'protocol_version', 'chain_id', 'profile', 'cell_id', 'backend', 'depth', 'partner_depth',
           'op_seq', 'op', 'kind', 'proof_id', 'proof_j', 'leaf_index', 'from_account', 'to_contract', 'contract_name', 'contract_address', 'nonce',
           'tx_type', 'gas_limit', 'gas_per_pubdata_limit', 'max_fee_per_gas_wei', 'expected_status', 'status', 'expected_revert', 'revert_reason',
           'expected_return', 'return_value', 'check_pass', 'computational_gas', 'pubdata_bytes', 'pubdata_gas', 'gas_per_pubdata', 'gas_used',
           'gas_used_derived', 'fee_trace_gas_limit', 'accounting_ok', 'calldata_bytes', 'calldata_sha256', 'raw_tx_bytes', 'factory_deps',
           'bytecode_bytes', 'bytecode_hash', 'bytecode_matches_artifact', 'tx_hash', 'block_number', 'l1_batch_number', 'block_timestamp',
           'effective_gas_price_wei', 'fee_semantics']
DEPTHS = {'full': [5, 10, 11, 15], 'dry': None, 'smoke': None}
PLAN_CELLS = {'full': [f'primary-{b}-d{d}' for b in ('groth16', 'plonk') for d in (5, 10, 11, 15)],
              'dry': ['primary-groth16-d5', 'primary-groth16-d11', 'primary-plonk-d10', 'primary-plonk-d11'],
              'smoke': ['primary-groth16-d5', 'primary-plonk-d10']}
PLAN_PROOFS = {'full': list(range(8)), 'dry': [0, 1], 'smoke': [0]}
NEG = ['neg_unknown_root', 'neg_tampered_call', 'neg_tampered', 'neg_cross_depth_setup', 'neg_cross_depth_call', 'neg_cross_depth', 'neg_non_issuer']
EXPECT = {'deploy_verifier': ('1', '', ''), 'deploy_manager': ('1', '', ''), 'set_issuer': ('1', '', ''), 'add_root': ('1', '', ''),
          'precheck_call': ('call', '', 'true'), 'verify_credential': ('1', '', 'true'), 'verify_proof_call': ('call', '', 'true'),
          'verify_proof_direct': ('1', '', 'true'), 'neg_unknown_root': ('0', 'Invalid root', ''), 'neg_tampered_call': ('call', '', 'false'),
          'neg_tampered': ('0', 'Invalid proof', ''), 'neg_cross_depth_setup': ('1', '', ''), 'neg_cross_depth_call': ('call', '', 'false'),
          'neg_cross_depth': ('0', 'Invalid proof', ''), 'neg_non_issuer': ('0', 'CredentialManager: not issuer', '')}
OPS_COLS = ['cell_id', 'backend', 'depth', 'op_seq', 'op', 'kind', 'proof_id', 'proof_j', 'leaf_index', 'from_account', 'contract_name', 'gas_limit',
            'expected_status', 'status', 'expected_revert', 'revert_reason', 'expected_return', 'return_value', 'check_pass', 'computational_gas',
            'pubdata_bytes', 'pubdata_gas', 'gas_per_pubdata', 'gas_used', 'gas_used_derived', 'calldata_bytes', 'raw_tx_bytes', 'factory_deps',
            'bytecode_bytes', 'bytecode_hash', 'bytecode_matches_artifact', 'calldata_sha256']
WORD = {5: 'Five', 10: 'Ten', 11: 'Eleven', 15: 'Fifteen'}


class CheckError(Exception):
    pass


def sha256_bytes(b): return hashlib.sha256(b).hexdigest()
def sha256_file(p): return sha256_bytes(open(p, 'rb').read())
def jload(p): return json.load(open(p))
def op_sequence(k):
    return (['deploy_verifier', 'deploy_manager', 'set_issuer', 'add_root', 'precheck_call'] + ['verify_credential'] * k + ['verify_proof_call'] * k
            + ['verify_proof_direct'] * k + NEG)
def derived_gas_used(gl, comp, pd):
    per_byte = min(FEE['base_fee'] * FEE['gas_per_pubdata'], FEE['fair_pubdata_price'])
    refund_eth = gl * FEE['base_fee'] - (comp * FEE['fair_l2_gas_price'] + pd * per_byte)
    return None if refund_eth < 0 else gl - (-(-refund_eth // FEE['base_fee']))
def csv_bytes(cols, rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, lineterminator='\n', extrasaction='raise')
    w.writeheader()
    for r in rows:
        w.writerow({c: ('' if r.get(c) is None else r[c]) for c in cols})
    return buf.getvalue().encode()
def ratio(a, b): return f'{a / b:.4f}'


def validate_run(k, d, run, rows, header, env, envc, bm, plan, check):
    """V1-V13 of section 16.6, re-evaluated from the raw files of one run."""
    cells, proofs = PLAN_CELLS[plan], PLAN_PROOFS[plan]
    kk = len(proofs)
    tx = [r for r in rows if r['kind'] == 'tx']
    check(f'{k}_V1_schema', header == COLUMNS, f'{len(header)} columns')
    check(f'{k}_V2_counts', len(rows) == len(cells) * (4 + 1 + 3 * kk + 7) == run['expected_rows'] and len(tx) == len(cells) * (4 + 2 * kk + 5) == run['expected_tx'],
          f'{len(rows)} rows, {len(tx)} tx')
    by = {}
    for r in rows:
        by.setdefault(r['cell_id'], []).append(r)
    check(f'{k}_V3_cells', list(by) == cells == run['cells'] and run['proofs'] == proofs, f'{list(by)}')
    check(f'{k}_V4_sequence', all([r['op'] for r in v] == op_sequence(kk) and [int(r['op_seq']) for r in v] == list(range(1, len(v) + 1))
                                  and all(int(r['proof_j']) in proofs for r in v if r['op'] in ('verify_credential', 'verify_proof_call', 'verify_proof_direct'))
                                  and sorted(int(r['proof_j']) for r in v if r['op'] == 'verify_credential') == proofs for v in by.values()), '')
    bad = [(r['cell_id'], r['op_seq']) for r in rows
           if (r['expected_status'], r['expected_revert'], r['expected_return']) != EXPECT[r['op']] or r['check_pass'] != '1'
           or (r['kind'] == 'tx' and r['status'] != r['expected_status']) or (r['kind'] == 'tx' and r['expected_status'] == '0' and r['revert_reason'] != r['expected_revert'])
           or (r['expected_return'] != '' and r['return_value'] != r['expected_return'])]
    check(f'{k}_V5_outcomes', not bad, str(bad[:5]))
    badf = [(r['cell_id'], r['op_seq']) for r in tx if int(r['tx_type']) != TX['tx_type'] or int(r['gas_limit']) != GAS_LIMIT[r['op']]
            or int(r['max_fee_per_gas_wei']) != TX['max_fee_per_gas_wei'] or int(r['gas_per_pubdata_limit']) != TX['gas_per_pubdata_limit']
            or int(r['chain_id']) != TX['chain_id'] or r['protocol_version'] != TX['protocol_version']]
    check(f'{k}_V6_tx_fields', not badf, str(badf[:5]))
    bada = []
    for r in tx:
        try:
            gl, comp, pd, pg, gu = (int(r[c]) for c in ('gas_limit', 'computational_gas', 'pubdata_bytes', 'pubdata_gas', 'gas_used'))
            ok = (r['accounting_ok'] == '1' and int(r['fee_trace_gas_limit']) == gl and pg == pd * FEE['gas_per_pubdata'] and int(r['gas_per_pubdata']) == FEE['gas_per_pubdata']
                  and derived_gas_used(gl, comp, pd) == gu == int(r['gas_used_derived']) and int(r['effective_gas_price_wei']) == FEE['base_fee'] and comp > 0 and pd > 0)
        except (ValueError, KeyError):
            ok = False
        if not ok:
            bada.append((r['cell_id'], r['op_seq'], r['op']))
    check(f'{k}_V7_fee_accounting', not bada, str(bada[:5]))
    cm = {c['name']: c for c in bm['contracts'].values()}
    badb = [(r['cell_id'], r['op']) for r in tx if r['op'].startswith('deploy_') and not (
            r['bytecode_matches_artifact'] == '1' and r['contract_name'] in cm and r['bytecode_hash'] == cm[r['contract_name']]['bytecode_hash']
            and int(r['bytecode_bytes']) == cm[r['contract_name']]['bytecode_bytes'] and r['factory_deps'] == '1')]
    check(f'{k}_V8_bytecode', not badb, str(badb[:5]))
    check(f'{k}_V9_size_limit', all(c['eravm_size_ok'] and c['bytecode_bytes'] <= MAX_BYTECODE for c in bm['contracts'].values()), f"{len(bm['contracts'])} contracts")
    badc = []
    for cid, v in by.items():
        t = [r for r in v if r['kind'] == 'tx']
        a0 = [int(r['nonce']) for r in t if r['from_account'] == 'A0']; a1 = [int(r['nonce']) for r in t if r['from_account'] == 'A1']
        blocks = [int(r['block_number']) for r in t]
        if a0 != list(range(len(a0))) or a1 != list(range(len(a1))) or blocks != sorted(set(blocks)) or len({r['tx_hash'] for r in t}) != len(t):
            badc.append(cid)
    check(f'{k}_V10_fresh_chain_per_cell', not badc, str(badc))
    tc = env['toolchain']
    check(f'{k}_V11_binaries_pinned', all(tc[b].get('sha256') == tc[b].get('pinned_sha256') == PINS_ARM64[b] for b in PINS_ARM64), str({b: tc[b].get('sha256') for b in PINS_ARM64}))
    check(f'{k}_V12_env_check', envc.get('pass') is True and run.get('env_check_pass') is True, '')
    sc = {c['check']: c.get('got') for c in envc['checks']}
    check(f'{k}_V13_system_contracts', all(sc.get(n) == v for n, v in SYSTEM.items()), str({n: sc.get(n) for n in SYSTEM}))
    return by


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--campaign', required=True); ap.add_argument('--out', required=True); ap.add_argument('--repo', default='.')
    ap.add_argument('--plan', default='full', choices=sorted(PLAN_CELLS))
    ap.add_argument('--expect-campaign-id'); ap.add_argument('--expect-commit'); ap.add_argument('--expect-tag')
    ap.add_argument('--expect-image-id'); ap.add_argument('--expect-protocol-sha256')
    a = ap.parse_args()
    repo = os.path.abspath(a.repo); camp = os.path.abspath(a.campaign)
    rel = lambda p: os.path.relpath(p, repo)
    checks, inputs = {}, {}

    def check(name, cond, detail=''):
        checks[name] = {'pass': bool(cond), 'detail': detail}
        if not cond:
            raise CheckError(f'{name}: {detail}')

    runs = sorted(d for d in os.listdir(camp) if os.path.isdir(os.path.join(camp, d)))
    ids = sorted({re.sub(r'-(a|b)$', '', d) for d in runs})
    check('one_campaign_id', len(ids) == 1 and set(runs) == {f'{ids[0]}-a', f'{ids[0]}-b'}, f'dirs {runs}')
    cid = ids[0]
    if a.expect_campaign_id:
        check('campaign_id_expected', cid == a.expect_campaign_id, f'{cid} vs {a.expect_campaign_id}')
    D = {k: os.path.join(camp, f'{cid}-{k}') for k in ('a', 'b')}
    for d in D.values():
        for root, dirs, files in os.walk(d):
            dirs.sort()
            for fn in sorted(files):
                inputs[rel(os.path.join(root, fn))] = sha256_file(os.path.join(root, fn))
    flights = a.plan == 'full'
    if flights:
        for fn in (f'{cid}.preflight.json', f'{cid}.postflight.json'):
            p = os.path.join(camp, fn)
            check(f'file_{fn.split(".", 1)[1].replace(".", "_")}', os.path.exists(p), rel(p))
            inputs[rel(p)] = sha256_file(p)
    run = {k: jload(os.path.join(d, 'run.json')) for k, d in D.items()}
    env = {k: jload(os.path.join(d, 'environment.json')) for k, d in D.items()}
    envc = {k: jload(os.path.join(d, 'env_check.json')) for k, d in D.items()}
    bm = {k: jload(os.path.join(d, 'build_manifest.eravm.json')) for k, d in D.items()}
    rows, header = {}, {}
    for k, d in D.items():
        rd = csv.DictReader(open(os.path.join(d, 'local_l2_ops.csv'), newline=''))
        rows[k] = list(rd); header[k] = rd.fieldnames
    commit = run['a']['commit']
    by = None
    for k in D:
        r = run[k]
        check(f'{k}_run_id', r['run_id'] == f'{cid}-{k}', r['run_id'])
        check(f'{k}_plan', r['plan'] == a.plan and r['arm'] == 'L2-EraVM' and r['scientific'] == (a.plan == 'full'), f"{r['plan']} {r['arm']}")
        check(f'{k}_commit', r['commit'] == commit and (not flights or r['dirty_tracked_paths'] == []), f"{r['commit']} dirty={r['dirty_tracked_paths']}")
        check(f'{k}_steps', all(s in r.get('steps', {}) for s in ('build', 'envcheck', 'exec', 'finish')), str(r.get('steps')))
        check(f'{k}_accepted_by_runner', r.get('accepted_checks') is True and r.get('rows_failing_check') == 0 and r.get('tx_failing_accounting') == 0
              and r.get('deployments_bytecode_match') is True, '')
        v = jload(os.path.join(D[k], 'validation.json'))
        check(f'{k}_runner_validation', v.get('pass') is True and v.get('rules') == 13, f"{v.get('pass')} {v.get('rules')}")
        b = validate_run(k, D[k], r, rows[k], header[k], env[k], envc[k], bm[k], a.plan, check)
        if k == 'a':
            by = b
        c = env[k].get('container') or {}
        check(f'{k}_no_network', c.get('network') == 'none' and (c.get('network_isolation') or {}).get('isolated') is True, str(c.get('network_isolation')))
        check(f'{k}_fee_input_as_frozen', {x: int(y) for x, y in env[k]['fee_input'].items() if x in FEE} == FEE, str(env[k]['fee_input']))
        check(f'{k}_tx_fields_as_frozen', env[k]['tx_fields']['gas_limits'] == GAS_LIMIT and env[k]['tx_fields']['type'] == TX['tx_type'], '')
        if a.expect_image_id:
            check(f'{k}_image', c.get('image_id') == a.expect_image_id, str(c.get('image_id')))
        if a.expect_protocol_sha256:
            check(f'{k}_protocol_sha256', r['protocol_sha256'] == a.expect_protocol_sha256, r['protocol_sha256'])
    if a.expect_commit:
        check('commit_expected', commit == a.expect_commit, f'{commit} vs {a.expect_commit}')
    if a.expect_tag:
        tc = subprocess.run(['git', '-C', repo, 'rev-parse', a.expect_tag + '^{commit}'], capture_output=True, text=True).stdout.strip()
        check('tag_resolves_to_run_commit', tc == commit, f'{a.expect_tag} -> {tc}')
    check('same_image', (env['a'].get('container') or {}).get('image_id') == (env['b'].get('container') or {}).get('image_id'), '')
    check('same_protocol', run['a']['protocol_sha256'] == run['b']['protocol_sha256'], '')
    check('same_proofset_manifest', run['a']['proofset_manifest'] == run['b']['proofset_manifest'], '')
    pm = run['a']['proofset_manifest']; psd = os.path.join(repo, 'csi/campaigns/chain/CSI-CHAIN-LOCAL-01/inputs/proofset')
    check('proofset_is_committed_PS01', pm['csv_sha256'] == sha256_file(os.path.join(psd, 'PROOFSET.csv'))
          and pm['sha256_file_sha256'] == sha256_file(os.path.join(psd, 'PROOFSET.sha256')) and pm['json_sha256'] == sha256_file(os.path.join(psd, 'PROOFSET.json'))
          and pm['files_verified'] == 128, str(pm))
    # determinism (section 16.6): every raw field except run_id; build manifests and environment probes identical
    key = lambda x: (x['cell_id'], int(x['op_seq']))
    A = {key(x): x for x in rows['a']}; B = {key(x): x for x in rows['b']}
    cols = [c for c in COLUMNS if c != 'run_id']
    det = sum(1 for kk in A for c in cols if A[kk][c] != B.get(kk, {}).get(c))
    check('determinism_rows_identical', set(A) == set(B) and det == 0, f'{det} differing field values')
    checks['determinism_rows_identical']['comparisons'] = len(A) * len(cols)
    check('build_manifest_identical', open(os.path.join(D['a'], 'build_manifest.eravm.json'), 'rb').read() == open(os.path.join(D['b'], 'build_manifest.eravm.json'), 'rb').read(), '')
    check('env_check_probe_identical', envc['a']['probe'] == envc['b']['probe'] and envc['a']['checks'] == envc['b']['checks'], '')
    cr = jload(os.path.join(D['b'], 'compare_determinism.json'))
    check('runner_determinism_report', cr.get('identical') is True and cr.get('field_value_comparisons') == checks['determinism_rows_identical']['comparisons'], '')
    if flights:
        pre = jload(os.path.join(camp, f'{cid}.preflight.json')); post = jload(os.path.join(camp, f'{cid}.postflight.json'))
        for n, dd in (('preflight', pre), ('postflight', post)):
            lv = {x['check']: x['level'] for x in dd['results']}
            check(f'{n}_no_fail', dd['fails'] == 0 and dd.get('head') == commit, f"fails {dd['fails']}, head {dd.get('head')}")
            for want in ('archived L2 image in use', 'L2 baseline tag', 'sources clean', 'no network (container --network none)',
                         'protocol with the L2 amendment', 'proof set PS-01 intact', 'local EraVM node'):
                check(f'{n}_{re.sub(r"[^a-z0-9]+", "_", want.lower()).strip("_")}', lv.get(want) == 'PASS', lv.get(want, 'missing'))
            if a.expect_image_id:
                check(f'{n}_image', dd.get('image_id') == a.expect_image_id, str(dd.get('image_id')))
            if a.expect_protocol_sha256:
                check(f'{n}_protocol_sha256', dd.get('protocol_sha256') == a.expect_protocol_sha256, str(dd.get('protocol_sha256')))
    return derive(a, cid, commit, run, env, bm, rows, by, checks, inputs, D)


def derive(a, cid, commit, run, env, bm, rows, by, checks, inputs, D):
    R = rows['a']
    out = {}
    out['l2_ops.csv'] = csv_bytes(OPS_COLS, [{c: x[c] for c in OPS_COLS} for x in R])
    I = lambda x, f: int(x[f])
    def one(cell, op): v = [x for x in by[cell] if x['op'] == op]; assert len(v) == 1, (cell, op); return v[0]
    def many(cell, op): return [x for x in by[cell] if x['op'] == op]
    rng = lambda xs, f: (min(I(x, f) for x in xs), max(I(x, f) for x in xs))
    cells = list(by)
    cell_rows, proof_rows, neg_rows = [], [], []
    for cell in cells:
        r0 = by[cell][0]
        dv, dm, si, ar = one(cell, 'deploy_verifier'), one(cell, 'deploy_manager'), one(cell, 'set_issuer'), one(cell, 'add_root')
        vc, vd = many(cell, 'verify_credential'), many(cell, 'verify_proof_direct')
        vdj = {x['proof_j']: x for x in vd}
        ovc = [I(x, 'computational_gas') - I(vdj[x['proof_j']], 'computational_gas') for x in vc]
        ovg = [I(x, 'gas_used') - I(vdj[x['proof_j']], 'gas_used') for x in vc]
        ovp = [I(x, 'pubdata_bytes') - I(vdj[x['proof_j']], 'pubdata_bytes') for x in vc]
        c = {'cell_id': cell, 'backend': r0['backend'], 'depth': r0['depth'], 'k': len(vc), 'verifier': dv['contract_name'], 'manager': dm['contract_name']}
        for pre, x in (('deploy_verifier', dv), ('deploy_manager', dm), ('set_issuer', si), ('add_root', ar)):
            c[f'{pre}_computational_gas'] = x['computational_gas']; c[f'{pre}_pubdata_bytes'] = x['pubdata_bytes']; c[f'{pre}_gas_used'] = x['gas_used']
        c.update({'verifier_bytecode_bytes': dv['bytecode_bytes'], 'verifier_bytecode_hash': dv['bytecode_hash'],
                  'manager_bytecode_bytes': dm['bytecode_bytes'], 'manager_bytecode_hash': dm['bytecode_hash']})
        for pre, xs in (('verify_credential', vc), ('verify_proof_direct', vd)):
            for f in ('computational_gas', 'pubdata_bytes', 'gas_used'):
                lo, hi = rng(xs, f)
                c[f'{pre}_{f}_min'], c[f'{pre}_{f}_max'] = lo, hi
            c[f'{pre}_computational_gas_range'] = c[f'{pre}_computational_gas_max'] - c[f'{pre}_computational_gas_min']
        c.update({'manager_overhead_computational_gas_min': min(ovc), 'manager_overhead_computational_gas_max': max(ovc),
                  'manager_overhead_pubdata_bytes_min': min(ovp), 'manager_overhead_pubdata_bytes_max': max(ovp),
                  'manager_overhead_gas_used_min': min(ovg), 'manager_overhead_gas_used_max': max(ovg),
                  'verify_credential_calldata_bytes': '|'.join(sorted({x['calldata_bytes'] for x in vc})),
                  'verify_proof_direct_calldata_bytes': '|'.join(sorted({x['calldata_bytes'] for x in vd})),
                  'negatives_as_expected': int(all(x['check_pass'] == '1' for x in by[cell] if x['op'] in NEG))})
        cell_rows.append(c)
        for x in vc:
            d = vdj[x['proof_j']]
            proof_rows.append({'cell_id': cell, 'backend': r0['backend'], 'depth': r0['depth'], 'proof_id': x['proof_id'], 'proof_j': x['proof_j'], 'leaf_index': x['leaf_index'],
                               'verify_credential_computational_gas': x['computational_gas'], 'verify_credential_pubdata_bytes': x['pubdata_bytes'],
                               'verify_credential_gas_used': x['gas_used'], 'verify_credential_calldata_bytes': x['calldata_bytes'],
                               'verify_proof_direct_computational_gas': d['computational_gas'], 'verify_proof_direct_pubdata_bytes': d['pubdata_bytes'],
                               'verify_proof_direct_gas_used': d['gas_used'], 'verify_proof_direct_calldata_bytes': d['calldata_bytes'],
                               'manager_overhead_computational_gas': I(x, 'computational_gas') - I(d, 'computational_gas'),
                               'manager_overhead_gas_used': I(x, 'gas_used') - I(d, 'gas_used')})
        for x in by[cell]:
            if x['op'] in NEG:
                neg_rows.append({'cell_id': cell, 'backend': r0['backend'], 'depth': r0['depth'], 'op': x['op'], 'kind': x['kind'], 'from_account': x['from_account'],
                                 'expected_status': x['expected_status'], 'status': x['status'], 'expected_revert': x['expected_revert'], 'revert_reason': x['revert_reason'],
                                 'expected_return': x['expected_return'], 'return_value': x['return_value'], 'check_pass': x['check_pass']})
    out['l2_cells.csv'] = csv_bytes(list(cell_rows[0].keys()), cell_rows)
    out['l2_proofs.csv'] = csv_bytes(list(proof_rows[0].keys()), proof_rows)
    out['l2_negatives.csv'] = csv_bytes(list(neg_rows[0].keys()), neg_rows)
    return derive2(a, cid, commit, run, env, bm, R, cells, cell_rows, proof_rows, out, checks, inputs)


def derive2(a, cid, commit, run, env, bm, R, cells, cell_rows, proof_rows, out, checks, inputs):
    I = lambda x, f: int(x[f])
    rng = lambda xs, f: (min(I(x, f) for x in xs), max(I(x, f) for x in xs))
    # ranges over depths and proofs, per backend and operation
    rr = []
    for b in ('groth16', 'plonk'):
        for op in ('deploy_verifier', 'deploy_manager', 'set_issuer', 'add_root', 'verify_credential', 'verify_proof_direct'):
            xs = [x for x in R if x['backend'] == b and x['op'] == op]
            if not xs:
                continue
            e = {'backend': b, 'op': op, 'n': len(xs), 'depths': '|'.join(sorted({x['depth'] for x in xs}, key=int)), 'cells': len({x['cell_id'] for x in xs})}
            for f in ('computational_gas', 'pubdata_bytes', 'gas_used'):
                e[f'{f}_min'], e[f'{f}_max'] = rng(xs, f)
            rr.append(e)
        ps = [p for p in proof_rows if p['backend'] == b]
        if ps:
            v = [p['manager_overhead_computational_gas'] for p in ps]; g = [p['manager_overhead_gas_used'] for p in ps]
            rr.append({'backend': b, 'op': 'manager_overhead', 'n': len(ps), 'depths': '|'.join(sorted({p['depth'] for p in ps}, key=int)),
                       'cells': len({p['cell_id'] for p in ps}), 'computational_gas_min': min(v), 'computational_gas_max': max(v),
                       'pubdata_bytes_min': min(int(p['verify_credential_pubdata_bytes']) - int(p['verify_proof_direct_pubdata_bytes']) for p in ps),
                       'pubdata_bytes_max': max(int(p['verify_credential_pubdata_bytes']) - int(p['verify_proof_direct_pubdata_bytes']) for p in ps),
                       'gas_used_min': min(g), 'gas_used_max': max(g)})
    out['l2_ranges.csv'] = csv_bytes(list(rr[0].keys()), rr)
    # compile-only sizes (build manifest of run a; identical in run b)
    m = bm['a']; sz = []
    for kk in sorted(m['contracts']):
        c = m['contracts'][kk]
        dm_ = re.search(r'Depth(\d+)$', c['name'])
        sz.append({'source': c['source'], 'contract': c['name'], 'depth': dm_.group(1) if dm_ else '', 'bytecode_bytes': c['bytecode_bytes'],
                   'bytecode_words': c['bytecode_words'], 'bytecode_hash': c['bytecode_hash'], 'bytecode_sha256': c['bytecode_sha256'],
                   'eravm_size_ok': int(c['eravm_size_ok']), 'deployed_in_matrix': int(any(x['contract_name'] == c['name'] and x['op'].startswith('deploy_') for x in R))})
    sz.sort(key=lambda s: (re.sub(r'\d+$', '', s['contract']), int(s['depth'] or 0)))
    out['l2_compile_sizes.csv'] = csv_bytes(list(sz[0].keys()), sz)
    # descriptive backend comparison per depth, EraVM units only
    C = {(c['backend'], int(c['depth'])): c for c in cell_rows}
    cmp_rows = []
    for d in sorted({dd for (_, dd) in C}):
        g, p = C.get(('groth16', d)), C.get(('plonk', d))
        if not (g and p):
            continue
        row = {'depth': d, 'units': 'EraVM gas and bytes (descriptive; not EVM gas)'}
        for q in ('verify_credential_computational_gas', 'verify_proof_direct_computational_gas'):
            row[f'{q}_groth16_min'], row[f'{q}_groth16_max'] = g[f'{q}_min'], g[f'{q}_max']
            row[f'{q}_plonk_min'], row[f'{q}_plonk_max'] = p[f'{q}_min'], p[f'{q}_max']
            row[f'{q}_plonk_over_groth16_at_min'] = ratio(p[f'{q}_min'], g[f'{q}_min'])
            row[f'{q}_plonk_over_groth16_at_max'] = ratio(p[f'{q}_max'], g[f'{q}_max'])
        for q in ('deploy_verifier_computational_gas', 'deploy_verifier_pubdata_bytes', 'verifier_bytecode_bytes'):
            row[f'{q}_groth16'], row[f'{q}_plonk'] = g[q], p[q]
            row[f'{q}_plonk_over_groth16'] = ratio(int(p[q]), int(g[q]))
        cmp_rows.append(row)
    out['l2_backend_comparison.csv'] = csv_bytes(list(cmp_rows[0].keys()), cmp_rows) if cmp_rows else b''
    val = {'campaign_id': cid, 'commit': commit, 'plan': a.plan, 'passed': all(c['pass'] for c in checks.values()), 'environment_label': ENV_LABEL,
           'rows_per_run': run['a']['expected_rows'], 'tx_per_run': run['a']['expected_tx'], 'cells': run['a']['cells'], 'proofs': run['a']['proofs'], 'checks': checks}
    out['validation.json'] = (json.dumps(val, indent=2, sort_keys=True) + '\n').encode()
    out['values.tex'] = values_tex(cid, commit, run, cells, cell_rows, cmp_rows)
    os.makedirs(a.out, exist_ok=True)
    outputs = {}
    for fn in sorted(out):
        if not out[fn]:
            continue
        open(os.path.join(a.out, fn), 'wb').write(out[fn]); outputs[fn] = sha256_bytes(out[fn])
    meta = {'tool': 'scripts/analysis/derive_chain_l2.py', 'tool_sha256': sha256_file(os.path.abspath(__file__)), 'evidence_id': 'CSI-CHAIN-LOCAL-01-L2',
            'campaign_id': cid, 'campaign_commit': commit, 'plan': a.plan, 'reference_run': f'{cid}-a', 'environment_label': ENV_LABEL,
            'image_id': (env['a'].get('container') or {}).get('image_id'), 'protocol_sha256': run['a']['protocol_sha256'],
            'proofset_manifest': run['a']['proofset_manifest'], 'fee_input': FEE,
            'rules': ['fixed before the scientific L2 run (CHAIN-PROTOCOL-v1 A7); formulas and outputs follow section 16; tested only on the readiness dry run',
                      'derived only from the accepted raw rows of run a; run b is checked identical first (every field except run_id)',
                      'units: EraVM gas and bytes only; never compared with EVM gas; no fee in ETH, no live cost, no L1 publication cost, no latency or finality',
                      'gas_used is the receipt value, reported only as derived under the fixed local fee input (it must equal gas_used_derived)',
                      'no rows, cells or proofs are excluded; gas values are not rounded',
                      'negative-control gas is not interpreted (protocol 7.2); negatives are summarised by status',
                      'manager overhead = verify_credential - verify_proof_direct for the same proof (computational gas, gasUsed, pubdata)',
                      'l2_backend_comparison.csv and the ratio macros are descriptive, within EraVM units only',
                      'l2_compile_sizes.csv is compile-only for depths not in the matrix (section 16.7)'],
            'checks': {k: v['pass'] for k, v in checks.items()}, 'inputs_sha256': dict(sorted(inputs.items())), 'outputs_sha256': outputs}
    open(os.path.join(a.out, 'derivation.json'), 'w').write(json.dumps(meta, indent=2, sort_keys=True) + '\n')
    print(json.dumps({'campaign': cid, 'checks': f'{sum(1 for c in checks.values() if c["pass"])}/{len(checks)}', 'outputs': sorted(outputs) + ['derivation.json']}))


def values_tex(cid, commit, run, cells, cell_rows, cmp_rows):
    L = ['% Generated by scripts/analysis/derive_chain_l2.py -- do not edit by hand.',
         f'% Campaign {cid} (CSI-CHAIN-LOCAL-01-L2), commit {commit}, CHAIN-PROTOCOL-v1 section 16 (run a; run b identical on every compared field).',
         f'% {ENV_LABEL}.',
         '% Units: EraVM gas (computational gas; receipt gasUsed derived under the fixed local fee input, 84 gas per pubdata byte) and bytes.',
         '% Not comparable with EVM gas; not a live Era Sepolia fee or cost; no latency or finality. Ratios (2 decimals) are descriptive, within EraVM units.', '']
    mac = lambda n, v: L.append(f'\\newcommand{{\\zl{n}}}{{{v}}}')
    mac('CampaignId', cid); mac('CampaignCommitShort', commit[:7]); mac('ProofsPerCell', len(run['a']['proofs']))
    mac('RowsPerRun', run['a']['expected_rows']); mac('TxPerRun', run['a']['expected_tx']); mac('Cells', len(cells))
    mac('ProtocolVersion', '29'); mac('GasPerPubdata', FEE['gas_per_pubdata']); mac('EnvLabel', ENV_LABEL)
    for c in cell_rows:
        pre = ('Groth' if c['backend'] == 'groth16' else 'Plonk') + WORD.get(int(c['depth']), str(c['depth']))
        for n, f in (('DeployVerifierComp', 'deploy_verifier_computational_gas'), ('DeployVerifierPubdata', 'deploy_verifier_pubdata_bytes'),
                     ('DeployVerifierGasUsed', 'deploy_verifier_gas_used'), ('DeployManagerComp', 'deploy_manager_computational_gas'),
                     ('DeployManagerPubdata', 'deploy_manager_pubdata_bytes'), ('DeployManagerGasUsed', 'deploy_manager_gas_used'),
                     ('SetIssuerComp', 'set_issuer_computational_gas'), ('SetIssuerPubdata', 'set_issuer_pubdata_bytes'), ('SetIssuerGasUsed', 'set_issuer_gas_used'),
                     ('AddRootComp', 'add_root_computational_gas'), ('AddRootPubdata', 'add_root_pubdata_bytes'), ('AddRootGasUsed', 'add_root_gas_used'),
                     ('VerifyCredCompMin', 'verify_credential_computational_gas_min'), ('VerifyCredCompMax', 'verify_credential_computational_gas_max'),
                     ('VerifyCredPubdataMin', 'verify_credential_pubdata_bytes_min'), ('VerifyCredPubdataMax', 'verify_credential_pubdata_bytes_max'),
                     ('VerifyCredGasUsedMin', 'verify_credential_gas_used_min'), ('VerifyCredGasUsedMax', 'verify_credential_gas_used_max'),
                     ('VerifyDirectCompMin', 'verify_proof_direct_computational_gas_min'), ('VerifyDirectCompMax', 'verify_proof_direct_computational_gas_max'),
                     ('VerifyDirectGasUsedMin', 'verify_proof_direct_gas_used_min'), ('VerifyDirectGasUsedMax', 'verify_proof_direct_gas_used_max'),
                     ('OverheadCompMin', 'manager_overhead_computational_gas_min'), ('OverheadCompMax', 'manager_overhead_computational_gas_max'),
                     ('VerifierBytes', 'verifier_bytecode_bytes'), ('ManagerBytes', 'manager_bytecode_bytes')):
            mac(pre + n, c[f])
    for r in cmp_rows:
        w = WORD.get(int(r['depth']), str(r['depth']))
        mac(f'RatioVerifyCredCompMin{w}', f"{float(r['verify_credential_computational_gas_plonk_over_groth16_at_min']):.2f}")
        mac(f'RatioVerifyCredCompMax{w}', f"{float(r['verify_credential_computational_gas_plonk_over_groth16_at_max']):.2f}")
        mac(f'RatioVerifierBytes{w}', f"{float(r['verifier_bytecode_bytes_plonk_over_groth16']):.2f}")
    return ('\n'.join(L) + '\n').encode()


if __name__ == '__main__':
    try:
        main()
    except CheckError as e:
        print(f'derive_chain_l2: CHECK FAILED: {e}', file=sys.stderr)
        sys.exit(2)
