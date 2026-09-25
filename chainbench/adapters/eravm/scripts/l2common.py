"""Shared helpers for the local-EraVM (L2) Python checks: schema, frozen constants (read from lib/constants.js), plans."""
import csv, json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
ADAPTER = os.path.dirname(HERE)

def schema_columns():
    src = open(os.path.join(ADAPTER, 'lib', 'schema.js')).read()
    return re.findall(r"'([a-z0-9_]+)'", src.split('const COLUMNS = [')[1].split('];')[0])

def constants():
    """The frozen numbers of lib/constants.js, parsed from its source (so Python and Node use one definition)."""
    src = open(os.path.join(ADAPTER, 'lib', 'constants.js')).read()
    num = lambda name: int(re.search(name + r"\s*[:=]\s*(\d+)n?", src).group(1))
    gl = re.search(r"const GAS_LIMIT = \{(.*?)\};", src, re.S).group(1)
    return {
        'chain_id': num('CHAIN_ID'), 'tx_type': num('TX_TYPE'), 'max_fee_per_gas': num('MAX_FEE_PER_GAS'),
        'gas_per_pubdata_limit': num('GAS_PER_PUBDATA_LIMIT'),
        'fair_l2_gas_price': num('fair_l2_gas_price'), 'fair_pubdata_price': num('fair_pubdata_price'),
        'base_fee': num('base_fee'), 'gas_per_pubdata': num('gas_per_pubdata'),
        'gas_limit': {k: int(v) for k, v in re.findall(r"(\w+): (\d+)", gl)},
        'protocol_version': re.search(r"protocol_version: '([^']+)'", src).group(1),
        'bootloader': re.search(r"bootloader: '(0x[0-9a-f]+)'", src).group(1),
        'default_aa': re.search(r"default_aa: '(0x[0-9a-f]+)'", src).group(1),
    }

def derived_gas_used(gl, comp, pd, K):
    per_byte = min(K['base_fee'] * K['gas_per_pubdata'], K['fair_pubdata_price'])
    refund_eth = gl * K['base_fee'] - (comp * K['fair_l2_gas_price'] + pd * per_byte)
    if refund_eth < 0:
        return None
    return gl - (-(-refund_eth // K['base_fee']))

def op_sequence(k):
    return (['deploy_verifier', 'deploy_manager', 'set_issuer', 'add_root', 'precheck_call'] + ['verify_credential'] * k
            + ['verify_proof_call'] * k + ['verify_proof_direct'] * k
            + ['neg_unknown_root', 'neg_tampered_call', 'neg_tampered', 'neg_cross_depth_setup', 'neg_cross_depth_call', 'neg_cross_depth', 'neg_non_issuer'])

EXPECT = {  # op -> (expected_status, expected_revert, expected_return)
    'deploy_verifier': ('1', '', ''), 'deploy_manager': ('1', '', ''), 'set_issuer': ('1', '', ''), 'add_root': ('1', '', ''),
    'precheck_call': ('call', '', 'true'), 'verify_credential': ('1', '', 'true'), 'verify_proof_call': ('call', '', 'true'),
    'verify_proof_direct': ('1', '', 'true'), 'neg_unknown_root': ('0', 'Invalid root', ''), 'neg_tampered_call': ('call', '', 'false'),
    'neg_tampered': ('0', 'Invalid proof', ''), 'neg_cross_depth_setup': ('1', '', ''), 'neg_cross_depth_call': ('call', '', 'false'),
    'neg_cross_depth': ('0', 'Invalid proof', ''), 'neg_non_issuer': ('0', 'CredentialManager: not issuer', ''),
}

def load_run(d):
    rd = csv.DictReader(open(os.path.join(d, 'local_l2_ops.csv'), newline=''))
    rows = list(rd)
    return rows, rd.fieldnames, json.load(open(os.path.join(d, 'run.json')))
