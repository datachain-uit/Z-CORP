'use strict';
// Behavioural hardfork verification (CHAIN-PROTOCOL-v1 §5.1).
const crypto = require('crypto');
const { ethers } = require('ethers');
const { rawCall } = require('./rpc');
function b64u(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }
async function p256Checks(rpc) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const msg = Buffer.from('chainbench env_check');
  const h = crypto.createHash('sha256').update(msg).digest();
  const sig = crypto.sign('sha256', msg, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  const jwk = publicKey.export({ format: 'jwk' });
  const input = Buffer.concat([h, sig, b64u(jwk.x), b64u(jwk.y)]);
  const bad = Buffer.from(input); bad[40] ^= 1;
  const to = '0x0000000000000000000000000000000000000100';
  const good = await rawCall(rpc, { to, data: '0x' + input.toString('hex') });
  const neg = await rawCall(rpc, { to, data: '0x' + bad.toString('hex') });
  return { valid_sig_result: good.ok ? good.data : `error:${good.message}`, invalid_sig_result: neg.ok ? neg.data : `error:${neg.message}` };
}
async function clzCheck(rpc) {
  // initcode: PUSH1 1; CLZ; PUSH1 0; MSTORE; PUSH1 32; PUSH1 0; RETURN  -> expects 255
  const r = await rawCall(rpc, { data: '0x60011e60005260206000f3' });
  return r.ok ? r.data : `error:${r.message}`;
}
async function txGasCapCheck(rpc, wallet, chainId, fees) {
  const nonce = Number(await rpc.call('eth_getTransactionCount', [wallet.address, 'pending']));
  const raw = await wallet.signTransaction({ type: 2, chainId, nonce, to: wallet.address, value: 0n, data: '0x', gasLimit: 16777217n, ...fees });
  try { const h = await rpc.call('eth_sendRawTransaction', [raw]); return `accepted:${h}`; } catch (e) { return `rejected:${String(e.message).slice(0, 160)}`; }
}
async function run(rpc, wallet, chainId, fees) {
  const p = await p256Checks(rpc);
  const clz = await clzCheck(rpc);
  const cap = await txGasCapCheck(rpc, wallet, chainId, fees);
  const one = '0x' + '00'.repeat(31) + '01';
  const r255 = '0x' + '00'.repeat(31) + 'ff';
  const markers = {
    p256verify_valid_returns_1: p.valid_sig_result === one,
    p256verify_invalid_returns_empty: p.invalid_sig_result === '0x',
    clz_returns_255: clz === r255,
    tx_gas_cap_2p24_plus_1_rejected: cap.startsWith('rejected') && /cap|limit/i.test(cap) && !/fee/i.test(cap),
  };
  return { raw: { p256: p, clz, tx_gas_cap: cap }, markers, osaka_markers_all: Object.values(markers).every(Boolean), osaka_markers_none: !markers.p256verify_valid_returns_1 && !markers.clz_returns_255 && !markers.tx_gas_cap_2p24_plus_1_rejected };
}
module.exports = { run };
