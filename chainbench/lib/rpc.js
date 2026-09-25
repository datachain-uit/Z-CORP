'use strict';
// Minimal JSON-RPC access for the in-process EDR provider and for an HTTP endpoint (geth).
class EdrRpc {
  constructor(provider) { this.p = provider; this.kind = 'edr'; }
  async call(method, params = []) { return this.p.request({ method, params }); }
}
class HttpRpc {
  constructor(url) { this.url = url; this.kind = 'http'; this.id = 0; }
  async call(method, params = []) {
    const res = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }) });
    const j = await res.json();
    if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
    return j.result;
  }
}
// Extract revert data (hex) from an eth_call error of either client.
function errorData(e) {
  const cands = [e && e.data, e && e.data && e.data.data, e && e.error && e.error.data, e && e.info && e.info.error && e.info.error.data];
  for (const c of cands) if (typeof c === 'string' && /^0x[0-9a-fA-F]*$/.test(c)) return c;
  return null;
}
// eth_call returning { ok, data, message }
async function rawCall(rpc, tx, block = 'latest') {
  try { return { ok: true, data: await rpc.call('eth_call', [tx, block]) }; }
  catch (e) { return { ok: false, data: errorData(e), message: String(e.message || e) }; }
}
async function waitReceipt(rpc, hash, timeoutMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    let r = null;
    try { r = await rpc.call('eth_getTransactionReceipt', [hash]); }
    catch (e) { if (!/indexing is in progress/.test(String(e.message))) throw e; } // geth right after start
    if (r) return r;
    if (Date.now() - t0 > timeoutMs) throw new Error(`no receipt for ${hash}`);
    await new Promise((s) => setTimeout(s, 50));
  }
}
module.exports = { EdrRpc, HttpRpc, errorData, rawCall, waitReceipt };
