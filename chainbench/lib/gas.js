'use strict';
// Derived gas quantities (CHAIN-PROTOCOL-v1 §9; Prague+ rules, unchanged in Osaka).
function calldata(hex) {
  const b = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  let zero = 0; for (const x of b) if (x === 0) zero++;
  const tokens = zero + 4 * (b.length - zero);
  return { bytes: b.length, zero, tokens, standard: 4 * tokens, floor: 21000 + 10 * tokens };
}
function derive({ data, isCreate, gasUsed, runtimeBytes }) {
  const c = calldata(data);
  const createGas = isCreate ? 32000 + 2 * Math.ceil(c.bytes / 32) : 0;
  const intrinsic = 21000 + c.standard + createGas;
  return {
    calldata_bytes: c.bytes, calldata_zero_bytes: c.zero, calldata_tokens: c.tokens, calldata_gas_standard: c.standard,
    floor_gas_7623: c.floor, create_gas: createGas, intrinsic_gas: intrinsic,
    exec_gas_derived: gasUsed === '' ? '' : gasUsed - intrinsic,
    floor_binding: gasUsed === '' ? '' : (gasUsed === c.floor ? 1 : 0),
    code_deposit_gas: isCreate && runtimeBytes !== '' ? 200 * runtimeBytes : '',
  };
}
module.exports = { calldata, derive };
