#!/usr/bin/env python3
"""CHAIN-PROTOCOL-v1 §16.6: validation of one local-EraVM run, recomputed from the raw files (independent of the runner).
Usage: validate_l2.py <run dir> [--out validation.json]. Exit 1 on any failed rule."""
import json, os, sys
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from l2common import schema_columns, constants, derived_gas_used, op_sequence, EXPECT, load_run
run_dir = sys.argv[1]
out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
K = constants()
rows, header, run = load_run(run_dir)
env = json.load(open(os.path.join(run_dir, 'environment.json')))
envc = json.load(open(os.path.join(run_dir, 'env_check.json')))
bm = json.load(open(os.path.join(run_dir, 'build_manifest.eravm.json')))
checks = []
def check(ok, rule, detail=''):
    checks.append({'rule': rule, 'pass': bool(ok), 'detail': detail if not ok else ''})
    print(('[PASS] ' if ok else '[FAIL] ') + rule + ('' if ok else f' -- {detail}'))
tx = [r for r in rows if r['kind'] == 'tx']; calls = [r for r in rows if r['kind'] == 'call']
k = len(run['proofs'])
check(header == schema_columns(), f'V1 CSV header = raw schema ({len(schema_columns())} columns)', str(header)[:200])
check(len(rows) == run['expected_rows'] and len(tx) == run['expected_tx'], f"V2 rows {len(rows)} = {run['expected_rows']}, tx rows {len(tx)} = {run['expected_tx']}")
cells = defaultdict(list)
for r in rows: cells[r['cell_id']].append(r)
check(list(cells) == run['cells'], 'V3 cells in plan order', f'{list(cells)} vs {run["cells"]}')
seq_ok = all([r['op'] for r in v] == op_sequence(k) and [int(r['op_seq']) for r in v] == list(range(1, len(v) + 1)) for v in cells.values())
check(seq_ok, 'V4 every cell follows the section 7 operation sequence (op_seq 1..n)')
bad = [(r['cell_id'], r['op_seq'], r['op']) for r in rows
       if (r['expected_status'], r['expected_revert'], r['expected_return']) != EXPECT[r['op']] or r['check_pass'] != '1'
       or (r['kind'] == 'tx' and r['status'] != r['expected_status'])
       or (r['kind'] == 'tx' and r['expected_status'] == '0' and r['revert_reason'] != r['expected_revert'])
       or (r['expected_return'] and r['return_value'] != r['expected_return'])]
check(not bad, 'V5 every row has its expected status / revert reason / return value (check_pass = 1)', str(bad[:5]))
badf = [(r['cell_id'], r['op_seq']) for r in tx if int(r['tx_type']) != K['tx_type'] or int(r['gas_limit']) != K['gas_limit'][r['op']]
        or int(r['max_fee_per_gas_wei']) != K['max_fee_per_gas'] or int(r['gas_per_pubdata_limit']) != K['gas_per_pubdata_limit']
        or int(r['chain_id']) != K['chain_id'] or r['protocol_version'] != K['protocol_version']]
check(not badf, 'V6 transaction type, gas limit, fee fields, chain id and protocol version as frozen', str(badf[:5]))
bada = []
for r in tx:
    try:
        gl, comp, pd, pg, gu = (int(r[c]) for c in ('gas_limit', 'computational_gas', 'pubdata_bytes', 'pubdata_gas', 'gas_used'))
        ok = (r['accounting_ok'] == '1' and int(r['fee_trace_gas_limit']) == gl and pg == pd * K['gas_per_pubdata'] and int(r['gas_per_pubdata']) == K['gas_per_pubdata']
              and derived_gas_used(gl, comp, pd, K) == gu == int(r['gas_used_derived']) and int(r['effective_gas_price_wei']) == K['base_fee'] and comp > 0 and pd > 0)
    except (ValueError, KeyError):
        ok = False
    if not ok: bada.append((r['cell_id'], r['op_seq'], r['op']))
check(not bada, f'V7 fee accounting: one node record per transaction; pubdata_gas = pubdata_bytes x {K["gas_per_pubdata"]}; receipt gasUsed reproduced exactly from computational_gas, pubdata_bytes and the fixed fee input', str(bada[:5]))
cm = {c['name']: c for c in bm['contracts'].values()}
badb = [(r['cell_id'], r['op']) for r in tx if r['op'].startswith('deploy_') and not (
        r['bytecode_matches_artifact'] == '1' and r['contract_name'] in cm and r['bytecode_hash'] == cm[r['contract_name']]['bytecode_hash']
        and int(r['bytecode_bytes']) == cm[r['contract_name']]['bytecode_bytes'] and r['factory_deps'] == '1')]
check(not badb, 'V8 deployed bytecode = compiled artifact (eth_getCode, versioned bytecode hash, size, one factory dependency)', str(badb[:5]))
check(all(c['eravm_size_ok'] for c in bm['contracts'].values()), f"V9 all {len(bm['contracts'])} compiled contracts within the EraVM bytecode limit")
badc = []
for cid, v in cells.items():
    t = [r for r in v if r['kind'] == 'tx']
    a0 = [int(r['nonce']) for r in t if r['from_account'] == 'A0']; a1 = [int(r['nonce']) for r in t if r['from_account'] == 'A1']
    blocks = [int(r['block_number']) for r in t]
    if a0 != list(range(len(a0))) or a1 != list(range(len(a1))) or blocks != sorted(set(blocks)) or len({r['tx_hash'] for r in t}) != len(t): badc.append(cid)
check(not badc, 'V10 fresh chain per cell: nonces from 0, strictly increasing blocks, distinct transaction hashes', str(badc))
tc = env['toolchain']
check(all(tc[b].get('sha256') == tc[b].get('pinned_sha256') for b in ('anvil_zksync', 'zksolc', 'era_solc')), 'V11 anvil-zksync, zksolc and era-solc binaries = pins')
check(envc.get('pass') is True and run.get('env_check_pass') is True, 'V12 environment check passed (system contracts, protocol, fee-accounting probe)')
sc = {c['check']: c for c in envc['checks']}
check(sc.get('bootloader hash', {}).get('got') == K['bootloader'] and sc.get('default AA hash', {}).get('got') == K['default_aa'], 'V13 base system contracts = anvil-zksync 0.6.11 built-in protocol v29')
res = {'run_id': run['run_id'], 'plan': run['plan'], 'pass': all(c['pass'] for c in checks), 'rules': len(checks), 'checks': checks,
       'counts': {'rows': len(rows), 'tx_rows': len(tx), 'call_rows': len(calls), 'cells': len(cells), 'proofs_per_cell': k}}
if out:
    json.dump(res, open(out, 'w'), indent=2); open(out, 'a').write('\n')
print('VALIDATION ' + ('PASS' if res['pass'] else 'FAIL') + f" ({sum(c['pass'] for c in checks)}/{len(checks)} rules)")
sys.exit(0 if res['pass'] else 1)
