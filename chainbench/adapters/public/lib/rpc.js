'use strict';
// Minimal timed JSON-RPC client over node:https / node:http (no ethers provider, no WebSocket, no fetch/undici).
// Endpoint rule: live mode accepts only https URLs that are not loopback; dry mode accepts only http://127.0.0.1:<port>.
// Only a label, the host and the sha256 of the URL are recorded (a provider URL may contain an API key), unless the URL is
// declared public in the campaign binding.
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { Refusal } = require('./networks');
const { now } = require('./clock');

function endpointIdentity(url, label, publicUrls = []) {
  const u = new URL(url);
  return { label: label || u.host, host: u.host, scheme: u.protocol.replace(':', ''), url_sha256: crypto.createHash('sha256').update(url).digest('hex'),
    url: publicUrls.includes(url) ? url : null };
}
function checkEndpoint(url, mode) {
  let u;
  try { u = new URL(url); } catch (e) { throw new Refusal('bad_endpoint', 'endpoint is not a valid URL'); }
  const loop = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname);
  if (mode === 'live') {
    if (u.protocol !== 'https:') throw new Refusal('endpoint_not_https', `live endpoints must use https (got ${u.protocol}); ws/wss and http are refused`);
    if (loop) throw new Refusal('endpoint_loopback_live', 'a loopback endpoint is refused in live mode (it cannot be the public network)');
  } else if (mode === 'dry') {
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1') throw new Refusal('endpoint_not_loopback_dry', 'the dry run accepts only http://127.0.0.1:<port> endpoints (never a public network)');
  } else throw new Refusal('bad_mode', `unknown mode ${mode}`);
}
class RpcError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); this.name = 'RpcError'; }
}
class Rpc {
  constructor(url, { label, mode, timeoutMs = 30000, publicUrls = [] }) {
    checkEndpoint(url, mode);
    this.url = url; this.mode = mode; this.timeoutMs = timeoutMs;
    this.identity = endpointIdentity(url, label, publicUrls);
    this.id = 0; this.log = [];
  }
  redact(msg) { return String(msg || '').split(this.url).join('<endpoint>'); }
  // Returns { result, raw, t_req, t_res, ms, http_status }; throws RpcError(kind: http | jsonrpc | timeout | network | parse).
  request(method, params = []) {
    const body = JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params });
    const u = new URL(this.url);
    const lib = u.protocol === 'https:' ? https : http;
    const t_req = now();
    return new Promise((resolve, reject) => {
      const req = lib.request({ method: 'POST', hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: `${u.pathname}${u.search}`,
        headers: { 'content-type': 'application/json', accept: 'application/json', 'content-length': Buffer.byteLength(body), 'accept-encoding': 'identity' },
        timeout: this.timeoutMs }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const t_res = now(); const raw = Buffer.concat(chunks).toString('utf8');
          const entry = { method, t_req: t_req.utc, t_res: t_res.utc, ms: +(t_res.mono_ms - t_req.mono_ms).toFixed(3), http_status: res.statusCode };
          if (res.statusCode !== 200) { this.log.push({ ...entry, ok: false, error: `http ${res.statusCode}` }); return reject(new RpcError('http', `HTTP ${res.statusCode}`, { http_status: res.statusCode, raw, t_req, t_res })); }
          let j;
          try { j = JSON.parse(raw); } catch (e) { this.log.push({ ...entry, ok: false, error: 'parse' }); return reject(new RpcError('parse', 'response is not JSON', { raw, t_req, t_res })); }
          if (j.error) { this.log.push({ ...entry, ok: false, error: `jsonrpc ${j.error.code}` }); return reject(new RpcError('jsonrpc', this.redact(j.error.message), { code: j.error.code, data: j.error.data, raw, t_req, t_res })); }
          this.log.push({ ...entry, ok: true });
          resolve({ result: j.result, raw, t_req, t_res, ms: entry.ms, http_status: res.statusCode });
        });
      });
      req.on('timeout', () => { req.destroy(new RpcError('timeout', `no response within ${this.timeoutMs} ms`, { t_req })); });
      req.on('error', (e) => { const t_res = now(); this.log.push({ method, t_req: t_req.utc, t_res: t_res.utc, ok: false, error: e.kind || 'network' }); reject(e instanceof RpcError ? e : new RpcError('network', this.redact(e.message), { t_req, t_res })); });
      req.end(body);
    });
  }
  async call(method, params = []) { return (await this.request(method, params)).result; }
}
module.exports = { Rpc, RpcError, checkEndpoint, endpointIdentity };
