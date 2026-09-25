'use strict';
// Read-only network observation before (and after) each block (CHAIN-PUBLIC-PROTOCOL-v1 section 7). Every response is kept
// byte-for-byte; interpretations (fork names, protocol meaning) are never mixed into it.
const crypto = require('crypto');
const { now } = require('./clock');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function observe(rpc, prof, { signer, label } = {}) {
  const started = now();
  const calls = [];
  async function c(name, method, params = []) {
    const t = now();
    try {
      const r = await rpc.request(method, params);
      calls.push({ name, method, params, t_request_utc: r.t_req.utc, t_response_utc: r.t_res.utc, ms: r.ms, http_status: r.http_status, ok: true, response_raw: r.raw, response_sha256: sha(r.raw) });
      return r.result;
    } catch (e) {
      calls.push({ name, method, params, t_request_utc: t.utc, t_response_utc: now().utc, ok: false, error_kind: e.kind || 'error', error_code: e.code === undefined ? null : e.code, error_message: String(e.message).slice(0, 300), response_raw: e.raw || null });
      return undefined;
    }
  }
  const chainId = await c('chainId', 'eth_chainId');
  const client = await c('clientVersion', 'web3_clientVersion');
  const latest = await c('latestBlock', 'eth_getBlockByNumber', ['latest', false]);
  await c('gasPrice', 'eth_gasPrice');
  if (prof.kind === 'evm') {
    await c('maxPriorityFeePerGas', 'eth_maxPriorityFeePerGas');
    await c('feeHistory', 'eth_feeHistory', ['0x5', 'latest', [10, 50, 90]]);
  } else {
    await c('protocolVersion', 'zks_getProtocolVersion');
    await c('feeParams', 'zks_getFeeParams');
    const batch = await c('l1BatchNumber', 'zks_L1BatchNumber');
    if (batch !== undefined) {
      await c('l1BatchDetails', 'zks_getL1BatchDetails', [Number(BigInt(batch))]);
      await c('l1BatchDetailsPrev', 'zks_getL1BatchDetails', [Number(BigInt(batch)) - 1]);
    }
    if (latest && latest.number) await c('blockDetails', 'zks_getBlockDetails', [Number(BigInt(latest.number))]);
  }
  if (signer) {
    await c('balance', 'eth_getBalance', [signer, 'latest']);
    await c('nonceLatest', 'eth_getTransactionCount', [signer, 'latest']);
    await c('noncePending', 'eth_getTransactionCount', [signer, 'pending']);
  }
  const finished = now();
  const summary = {
    chain_id: chainId !== undefined ? Number(BigInt(chainId)) : null, client_version: client || null,
    latest_block: latest ? Number(BigInt(latest.number)) : null, latest_block_timestamp: latest ? Number(BigInt(latest.timestamp)) : null,
    latest_base_fee_per_gas: latest && latest.baseFeePerGas ? BigInt(latest.baseFeePerGas).toString() : null,
    calls_ok: calls.filter((x) => x.ok).length, calls_failed: calls.filter((x) => !x.ok).length,
  };
  const body = { kind: 'network-observation', label: label || '', network: prof.name, chain_id_expected: prof.chain_id, endpoint: rpc.identity,
    signer_address: signer || null, started_utc: started.utc, finished_utc: finished.utc, calls, summary };
  const id = sha(JSON.stringify(body)).slice(0, 16);
  return { observation_id: id, ...body };
}
module.exports = { observe };
