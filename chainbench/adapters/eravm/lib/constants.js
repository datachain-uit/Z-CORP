'use strict';
// Fixed parameters of the local-EraVM arm (CHAIN-PROTOCOL-v1 §16, amendment A6). Venue-neutral EraVM settings only:
// the workload's own constants (depths, K, partner depths, tamper rule) stay in the workload (lib/constants.js).
const fs = require('fs');
const path = require('path');

const CHAIN_ID = 260;
const PROTOCOL_VERSION = 29;
const MNEMONIC = 'test test test test test test test test test test test junk';
const RPC_PORT = 18011;
const GENESIS_TIMESTAMP = 1000;
const BALANCE_ETH = 10000;
// Fresh node per cell. Only command-line options are used; nothing is read from a fork or the network.
function anvilArgs(port, logFile) {
  return ['--offline', '--timestamp', String(GENESIS_TIMESTAMP), '--protocol-version', String(PROTOCOL_VERSION),
    '--dev-system-contracts', 'built-in', '--enforce-bytecode-compression', 'false',
    '--host', '127.0.0.1', '--port', String(port), '--cache', 'none', '--chain-id', String(CHAIN_ID),
    '-m', MNEMONIC, '-a', '2', '--balance', String(BALANCE_ETH),
    '--show-gas-details', 'none', '--show-vm-details', 'none', '--show-storage-logs', 'none',
    '--log', 'info', '--log-file-path', logFile, 'run'];
}
// The node's own per-transaction fee computation (zksync-era multivm vm_latest utils/refund.rs, compute_refund) emits,
// at TRACE level, gas limit, gas spent on computation, gas spent on pubdata and pubdata published, keyed by tx hash.
const RUST_LOG = 'zksync_multivm::versions::vm_latest::utils::refund=trace';

// Transactions: EIP-712 (type 113) for every transaction, fixed fields, no estimation, no paymaster.
const TX_TYPE = 113;
const MAX_FEE_PER_GAS = 45250000n;          // = the fixed local base fee; the bootloader charges the base fee only
const MAX_PRIORITY_FEE_PER_GAS = 45250000n; // set equal (zksync-ethers treats 0 as "unset")
const GAS_PER_PUBDATA_LIMIT = 50000n;       // user limit (DEFAULT_GAS_PER_PUBDATA_LIMIT); the charged value is the batch's
const GAS_LIMIT = {
  deploy_verifier: 20000000, deploy_manager: 20000000, set_issuer: 2000000, add_root: 2000000,
  verify_credential: 10000000, verify_proof_direct: 10000000,
  neg_unknown_root: 10000000, neg_tampered: 10000000, neg_cross_depth_setup: 2000000, neg_cross_depth: 10000000, neg_non_issuer: 2000000,
};

// Fee input of every batch. anvil-zksync 0.6.11 without a fork builds its fee model from built-in defaults
// (crates/core/src/node/fee_model.rs, TestNodeFeeInputProvider::from_fork(None)); the --l1-gas-price, --l2-gas-price and
// --l1-pubdata-price options change only the start-up banner. FeeModelConfigV2 {minimal_l2_gas_price 45,250,000,
// compute_overhead_part 0, pubdata_overhead_part 1, batch_overhead_l1_gas 800,000, max_gas_per_batch 200,000,000,
// max_pubdata_per_batch 500,000}, l1_gas_price 2,365,348,956, l1_pubdata_price 1 give:
const FEE_INPUT = {
  l1_gas_price: 2365348956n, fair_l2_gas_price: 45250000n, fair_pubdata_price: 3784558330n, // 1 + 800000*l1_gas_price/500000
  base_fee: 45250000n,       // max(fair_l2_gas_price, ceil(fair_pubdata_price / 50000))
  gas_per_pubdata: 84n,      // ceil(fair_pubdata_price / base_fee)
};
// What the node's API reports (estimation-scaled by the node's price scale factor 2); recorded, never used as inputs.
const API_EXPECTED = { eth_gasPrice: 45250000n, zks_gasPerPubdata: 168n, client_version: 'zkSync/v2.0' };
// Built-in protocol-v29 base system contracts of anvil-zksync 0.6.11 (they differ from live Era Sepolia; see A6).
const SYSTEM_CONTRACTS = {
  protocol_version: 'Version29',
  bootloader: '0x0100092f045c41c21bd08a9c6fa909fa6a8b446e3f6cd9f08356352a3195a40c',
  default_aa: '0x010005f74935e95e527d18ea9bfc82906fb20903a5683c528ee7af404e9bd531',
  evm_emulator: null,
};

// Receipt gasUsed as the bootloader derives it (vm_latest compute_refund): the operator refund is
// ceil((gas_limit*base_fee - (computational_gas*fair_l2_gas_price + pubdata_bytes*min(base_fee*gas_per_pubdata, fair_pubdata_price))) / base_fee).
function derivedGasUsed(gasLimit, computationalGas, pubdataBytes, F = FEE_INPUT) {
  const gl = BigInt(gasLimit); const comp = BigInt(computationalGas); const pd = BigInt(pubdataBytes);
  const perByte = F.base_fee * F.gas_per_pubdata < F.fair_pubdata_price ? F.base_fee * F.gas_per_pubdata : F.fair_pubdata_price;
  const refundEth = gl * F.base_fee - (comp * F.fair_l2_gas_price + pd * perByte);
  if (refundEth < 0n) return null;
  const refund = (refundEth + F.base_fee - 1n) / F.base_fee;
  return Number(gl - refund);
}

// Compiler settings (zksolc standard JSON). Bytecode is always emitted for EraVM; the selection adds ABI and metadata.
const ZKSOLC_SETTINGS = {
  optimizer: { enabled: true, mode: '3', fallback_to_optimizing_for_size: true },
  codegen: 'yul',
  evmVersion: 'paris',
  outputSelection: { '*': { '*': ['abi', 'evm.methodIdentifiers', 'metadata'] } },
};
const MAX_BYTECODE_BYTES = (2 ** 16 - 1) * 32; // EraVM bytecode length limit (words of 32 bytes, < 2^16 words)

// Pins (adapters/eravm/pins.env) for the running architecture.
function pins() {
  const txt = fs.readFileSync(path.join(__dirname, '..', 'pins.env'), 'utf8');
  const p = {};
  for (const l of txt.split('\n')) { const m = /^([A-Z0-9_]+)="(.*)"$/.exec(l.trim()); if (m) p[m[1]] = m[2]; }
  return p;
}
function archPins(arch = process.arch) {
  const p = pins(); const A = { arm64: 'ARM64', x64: 'AMD64' }[arch];
  if (!A) throw new Error(`unsupported architecture ${arch}`);
  return {
    anvil_zksync: { version: p.ANVIL_ZKSYNC_VERSION, sha256: p[`ANVIL_ZKSYNC_BIN_SHA256_${A}`], tgz_sha256: p[`ANVIL_ZKSYNC_TGZ_SHA256_${A}`], url: p[`ANVIL_ZKSYNC_URL_${A}`] },
    zksolc: { version: p.ZKSOLC_VERSION, sha256: p[`ZKSOLC_SHA256_${A}`], url: p[`ZKSOLC_URL_${A}`] },
    era_solc: { version: p.ERA_SOLC_VERSION, sha256: p[`ERA_SOLC_SHA256_${A}`], url: p[`ERA_SOLC_URL_${A}`] },
    base_image: `${p.BASE_IMAGE_REPO}@${p.BASE_IMAGE_DIGEST}`,
  };
}
function binaries() {
  return { anvil_zksync: process.env.CHAINBENCH_ANVIL_ZKSYNC_BIN, zksolc: process.env.CHAINBENCH_ZKSOLC_BIN, era_solc: process.env.CHAINBENCH_ERA_SOLC_BIN };
}

module.exports = {
  CHAIN_ID, PROTOCOL_VERSION, MNEMONIC, RPC_PORT, GENESIS_TIMESTAMP, BALANCE_ETH, anvilArgs, RUST_LOG,
  TX_TYPE, MAX_FEE_PER_GAS, MAX_PRIORITY_FEE_PER_GAS, GAS_PER_PUBDATA_LIMIT, GAS_LIMIT, FEE_INPUT, API_EXPECTED, SYSTEM_CONTRACTS,
  derivedGasUsed, ZKSOLC_SETTINGS, MAX_BYTECODE_BYTES, pins, archPins, binaries,
};
