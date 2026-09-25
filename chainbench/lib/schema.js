'use strict';
// Raw schema of local_l1_ops.csv (CHAIN-PROTOCOL-v1 §8.1).
const COLUMNS = [
  'campaign_id', 'run_id', 'plan', 'env', 'client_version', 'hardfork', 'chain_id', 'profile', 'cell_id', 'backend', 'depth', 'partner_depth',
  'op_seq', 'op', 'kind', 'proof_id', 'proof_j', 'leaf_index', 'from_account', 'to_contract', 'contract_name', 'contract_address', 'nonce', 'gas_limit',
  'expected_status', 'status', 'expected_revert', 'revert_reason', 'expected_return', 'return_value', 'check_pass',
  'gas_used', 'calldata_bytes', 'calldata_zero_bytes', 'calldata_tokens', 'calldata_gas_standard', 'floor_gas_7623', 'create_gas', 'intrinsic_gas',
  'exec_gas_derived', 'floor_binding', 'code_deposit_gas', 'initcode_bytes', 'runtime_bytes', 'runtime_keccak', 'runtime_matches_artifact',
  'calldata_sha256', 'tx_hash', 'block_number', 'gas_price_wei', 'gas_price_semantics',
];
function csvCell(v) { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { return [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'; }
module.exports = { COLUMNS, toCsv };
