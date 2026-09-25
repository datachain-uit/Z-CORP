'use strict';
// Raw schema of CSI-CHAIN-PUBLIC-01 transaction records (CHAIN-PUBLIC-PROTOCOL-v1 section 13). One row per planned
// operation, whatever happened to it. No secret value is ever a column.
const STATES = ['unsent_preflight_failure', 'unsent_client_error', 'unsent_insufficient_balance', 'submitted_no_receipt', 'reverted', 'confirmed_success'];
const COLUMNS = [
  // identity
  'campaign_id', 'run_id', 'mode', 'protocol_sha256', 'harness_commit', 'inputs_manifest_sha256', 'session_id', 'phase', 'block_id', 'block_position',
  'pair_id', 'schedule_id', 'op', 'backend', 'depth', 'proof_id', 'network', 'chain_id', 'provider_label', 'endpoint_host', 'endpoint_url_sha256',
  'observation_id', 'signer_address', 'contract_role', 'contract_name', 'to_address', 'contract_address', 'artifact_sha256', 'calldata_sha256',
  'calldata_bytes', 'factory_deps', 'bytecode_hash',
  // transaction fields and send policy
  'tx_type', 'nonce', 'gas_limit', 'max_fee_per_gas', 'max_priority_fee_per_gas', 'gas_per_pubdata_limit', 'fee_rule', 'prep_block_number',
  'prep_base_fee_per_gas', 'est_gas_limit', 'est_max_fee_per_gas', 'est_max_priority_fee_per_gas', 'est_gas_per_pubdata_limit', 'rpc_gas_price',
  'fee_params_sha256', 'balance_before_latest', 'balance_required', 'raw_tx_sha256', 'raw_tx_bytes', 'tx_hash_local', 'tx_hash', 'tx_hash_matches',
  // timing (UTC wall clock and monotonic ms)
  't_prepare_utc', 't0_utc', 't_hash_utc', 't_receipt_utc', 't_prepare_mono_ms', 't0_mono_ms', 't_hash_mono_ms', 't_receipt_mono_ms',
  'prepare_to_send_ms', 'send_to_hash_ms', 'hash_to_receipt_ms', 'request_to_receipt_ms', 'poll_interval_ms', 'polls', 'poll_errors',
  'block_at_hash', 'block_at_hash_utc',
  // inclusion and fee
  'inclusion_block', 'inclusion_block_hash', 'inclusion_block_timestamp', 'inclusion_block_time_utc', 'inclusion_block_base_fee', 'receipt_status',
  'gas_used', 'effective_gas_price', 'receipt_fee_wei', 'expected_effective_gas_price', 'effective_price_ok', 'balance_before_block',
  'balance_after_block', 'balance_delta_wei', 'fee_consistency_diff_wei', 'fee_consistency_ok',
  // ZKsync Era
  'l1_batch_number', 'l1_batch_tx_index', 'era_details_status', 'era_details_fee', 'era_details_gas_per_pubdata', 'era_details_fee_ok',
  // outcome
  'runtime_code_sha256', 'runtime_matches_artifact', 'revert_reason', 'state', 'error_class', 'error_message', 'notes',
];
function blank() { return Object.fromEntries(COLUMNS.map((c) => [c, ''])); }
function csvCell(v) {
  const s = v === null || v === undefined ? '' : typeof v === 'bigint' ? v.toString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csv(rows) { return [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'; }
module.exports = { STATES, COLUMNS, blank, csv };
