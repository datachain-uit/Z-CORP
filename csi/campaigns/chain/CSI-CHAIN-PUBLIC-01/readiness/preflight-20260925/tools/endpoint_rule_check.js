'use strict';
// CSI-CHAIN-PUBLIC-01 final pre-flight: the runner's endpoint rule, exercised inside the final image (--network none).
// Live mode must accept only https://<non-loopback>; ws://, wss://, http:// and loopback must be refused.
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..', '..', '..');
const { checkEndpoint, Rpc } = require(path.join(REPO, 'chainbench', 'adapters', 'public', 'lib', 'rpc'));
const cases = [
  ['live', 'ws://rpc.example.org', 'refuse'], ['live', 'wss://rpc.example.org', 'refuse'], ['live', 'wss://sepolia.era.zksync.dev/ws', 'refuse'],
  ['live', 'http://rpc.example.org', 'refuse'], ['live', 'https://127.0.0.1:8545', 'refuse'], ['live', 'https://localhost:8545', 'refuse'],
  ['live', 'https://[::1]:8545', 'refuse'], ['live', 'ftp://rpc.example.org', 'refuse'], ['live', 'not a url', 'refuse'],
  ['live', 'https://sepolia.era.zksync.dev', 'accept'], ['live', 'https://rpc.example.org/v2/abc', 'accept'],
  ['dry', 'https://sepolia.era.zksync.dev', 'refuse'], ['dry', 'http://127.0.0.1:8545', 'accept'],
];
let bad = 0;
for (const [mode, url, want] of cases) {
  let got = 'accept'; let code = '';
  try { checkEndpoint(url, mode); new Rpc(url, { mode, label: 't' }); } catch (e) { got = 'refuse'; code = e.code || e.message; }
  const ok = got === want; if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${mode} ${url} -> ${got}${code ? ` (${code})` : ''}`);
}
console.log(`ENDPOINT-RULE: ${bad ? `${bad} FAIL` : 'all pass'} (${cases.length} cases)`);
process.exit(bad ? 1 : 0);
