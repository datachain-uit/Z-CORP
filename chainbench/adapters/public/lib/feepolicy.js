'use strict';
// Frozen send policy (CHAIN-PUBLIC-PROTOCOL-v1 section 8). Nothing is retried, re-priced or replaced.
//   Ethereum Sepolia: EIP-1559 (type 2); gasLimit = the controlled study's fixed limit for the operation;
//     maxPriorityFeePerGas = P (fixed, frozen); maxFeePerGas = 2 * baseFeePerGas(latest block at preparation) + P.
//   ZKsync Era Sepolia: EIP-712 (type 113); zks_estimateFee on the exact transaction; the returned gasLimit, maxFeePerGas,
//     maxPriorityFeePerGas and gasPerPubdata are used unchanged; eth_gasPrice and zks_getFeeParams are recorded.
const crypto = require('crypto');
const { ethers } = require('ethers');
const hex = (n) => '0x' + BigInt(n).toString(16);

async function sepolia(rpc, policy, op) {
  const gasLimit = policy.gas_limit[op];
  if (!gasLimit) throw new Error(`no frozen gas limit for ${op}`);
  const blk = await rpc.call('eth_getBlockByNumber', ['latest', false]);
  const base = BigInt(blk.baseFeePerGas);
  const P = BigInt(policy.max_priority_fee_per_gas_wei);
  return {
    tx: { gasLimit: BigInt(gasLimit), maxFeePerGas: 2n * base + P, maxPriorityFeePerGas: P },
    rec: { fee_rule: 'sepolia: maxFee = 2*baseFee(latest) + P; gasLimit fixed', prep_block_number: Number(BigInt(blk.number)), prep_base_fee_per_gas: base.toString() },
  };
}
async function era(rpc, policy, req) {
  const meta = { gasPerPubdata: hex(policy.estimate_gas_per_pubdata) };
  if (req.factoryDeps) meta.factoryDeps = req.factoryDeps.map((d) => Array.from(ethers.getBytes(d)));
  const est = await rpc.call('zks_estimateFee', [{ from: req.from, to: req.to, data: req.data, value: '0x0', type: hex(113), eip712Meta: meta }]);
  let gasPrice = ''; let feeParamsSha = '';
  try { gasPrice = BigInt(await rpc.call('eth_gasPrice', [])).toString(); } catch (e) { gasPrice = `error:${e.kind || 'error'}`; }
  try { const r = await rpc.request('zks_getFeeParams', []); feeParamsSha = crypto.createHash('sha256').update(r.raw).digest('hex'); } catch (e) { feeParamsSha = `error:${e.kind || 'error'}`; }
  const g = (k) => BigInt(est[k]);
  return {
    tx: { gasLimit: g('gas_limit'), maxFeePerGas: g('max_fee_per_gas'), maxPriorityFeePerGas: g('max_priority_fee_per_gas'), gasPerPubdata: g('gas_per_pubdata_limit') },
    rec: { fee_rule: 'era: zks_estimateFee values unchanged', est_gas_limit: g('gas_limit').toString(), est_max_fee_per_gas: g('max_fee_per_gas').toString(),
      est_max_priority_fee_per_gas: g('max_priority_fee_per_gas').toString(), est_gas_per_pubdata_limit: g('gas_per_pubdata_limit').toString(),
      rpc_gas_price: gasPrice, fee_params_sha256: feeParamsSha },
  };
}
module.exports = { sepolia, era };
