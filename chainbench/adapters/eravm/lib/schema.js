'use strict';
// Raw schema of local_l2_ops.csv (CHAIN-PROTOCOL-v1 §16.5). One row per transaction or call.
// Units: every *_gas column is EraVM gas (ergs); it is never comparable with EVM gas in local_l1_ops.csv.
const COLUMNS = [
  'campaign_id', 'arm', 'run_id', 'plan', 'env', 'node_version', 'protocol_version', 'chain_id', 'profile', 'cell_id', 'backend', 'depth', 'partner_depth',
  'op_seq', 'op', 'kind', 'proof_id', 'proof_j', 'leaf_index', 'from_account', 'to_contract', 'contract_name', 'contract_address', 'nonce',
  'tx_type', 'gas_limit', 'gas_per_pubdata_limit', 'max_fee_per_gas_wei',
  'expected_status', 'status', 'expected_revert', 'revert_reason', 'expected_return', 'return_value', 'check_pass',
  'computational_gas', 'pubdata_bytes', 'pubdata_gas', 'gas_per_pubdata', 'gas_used', 'gas_used_derived', 'fee_trace_gas_limit', 'accounting_ok',
  'calldata_bytes', 'calldata_sha256', 'raw_tx_bytes', 'factory_deps', 'bytecode_bytes', 'bytecode_hash', 'bytecode_matches_artifact',
  'tx_hash', 'block_number', 'l1_batch_number', 'block_timestamp', 'effective_gas_price_wei', 'fee_semantics',
];
function csvCell(v) { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { return [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'; }
module.exports = { COLUMNS, toCsv };
