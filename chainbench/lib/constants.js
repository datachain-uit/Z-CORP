'use strict';
// Fixed parameters of CHAIN-PROTOCOL-v1 (§5, §6, §7).
const MNEMONIC = 'test test test test test test test test test test test junk';
const HD_BASE = "m/44'/60'/0'/0";
const HARDFORK = 'osaka';
const EDR_CHAIN_ID = 31337;
const BLOCK_GAS_LIMIT = 60000000;
const INITIAL_DATE = '2026-01-01T00:00:00.000Z';
const DEPTHS = [5, 10, 11, 15];
const K = 8;
const PARTNER = { 5: 10, 10: 11, 11: 15, 15: 5 };
// Leaf-index rule (§3.1): i_j = (2j+1) * 2^(d-4), j = 0..7
function leafIndex(d, j) { return (2 * j + 1) * 2 ** (d - 4); }
const GAS_LIMIT = {
  deploy_verifier: 6000000, deploy_manager: 6000000, set_issuer: 300000, add_root: 300000,
  verify_credential: 1000000, verify_proof_direct: 1000000,
  neg_unknown_root: 3000000, neg_tampered: 3000000, neg_cross_depth_setup: 300000, neg_cross_depth: 3000000, neg_non_issuer: 300000,
};
const FEES = {
  edr: { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n },
  geth: { maxFeePerGas: 100000000000n, maxPriorityFeePerGas: 0n },
};
// BN254 moduli
const BN254_Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583n; // base field
const BN254_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n; // scalar field
const EDR_NETWORK = {
  hardfork: process.env.CHAINBENCH_HARDFORK || HARDFORK, // override only for the env_check control
  chainId: EDR_CHAIN_ID,
  initialBaseFeePerGas: 0,
  blockGasLimit: BLOCK_GAS_LIMIT,
  allowUnlimitedContractSize: false,
  allowBlocksWithSameTimestamp: false,
  initialDate: INITIAL_DATE,
  mining: { auto: true, interval: 0 },
  accounts: { mnemonic: MNEMONIC, path: HD_BASE, count: 2, accountsBalance: '10000000000000000000000' },
  throwOnTransactionFailures: false,
  throwOnCallFailures: true,
  loggingEnabled: false,
};
module.exports = { MNEMONIC, HD_BASE, HARDFORK, EDR_CHAIN_ID, BLOCK_GAS_LIMIT, INITIAL_DATE, DEPTHS, K, PARTNER, leafIndex, GAS_LIMIT, FEES, BN254_Q, BN254_R, EDR_NETWORK };
