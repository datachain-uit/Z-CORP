'use strict';
// Local EraVM node: a fresh anvil-zksync process per cell (offline, fixed options), and the node's own per-transaction
// fee accounting read back from its log (see constants.js RUST_LOG). Venue- and workload-neutral.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { HttpRpc } = require('../../../lib/rpc');
const E = require('./constants');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function bin() {
  const b = E.binaries().anvil_zksync;
  if (!b || !fs.existsSync(b)) throw new Error(`anvil-zksync not found (CHAINBENCH_ANVIL_ZKSYNC_BIN=${b || 'unset'})`);
  return b;
}
function version(b = bin()) { return execFileSync(b, ['--version'], { encoding: 'utf8' }).trim(); }
function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

async function start(dir, { port = E.RPC_PORT, timeoutMs = 240000 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const logFile = path.join(dir, 'anvil.log');
  const fd = fs.openSync(path.join(dir, 'anvil.stdout'), 'w');
  const args = E.anvilArgs(port, logFile);
  const proc = spawn(bin(), args, { env: { ...process.env, RUST_LOG: E.RUST_LOG, NO_COLOR: '1' }, stdio: ['ignore', fd, fd] });
  let exited = null;
  proc.on('exit', (code, signal) => { exited = { code, signal }; });
  const rpc = new HttpRpc(`http://127.0.0.1:${port}`);
  const t0 = Date.now();
  for (;;) {
    if (exited) { fs.closeSync(fd); throw new Error(`anvil-zksync exited during start-up (${JSON.stringify(exited)}); see ${path.join(dir, 'anvil.stdout')}`); }
    let id = null;
    try { id = await rpc.call('eth_chainId'); } catch (e) { id = null; }
    if (id !== null) {
      if (Number(id) !== E.CHAIN_ID) { proc.kill('SIGKILL'); fs.closeSync(fd); throw new Error(`unexpected chain id ${id}`); }
      break;
    }
    if (Date.now() - t0 > timeoutMs) { proc.kill('SIGKILL'); fs.closeSync(fd); throw new Error(`anvil-zksync did not answer within ${timeoutMs} ms`); }
    await sleep(100);
  }
  return { proc, rpc, dir, logFile, port, args, fd, startup_ms: Date.now() - t0, exited: () => exited };
}
async function stop(node) {
  if (!node.exited()) {
    node.proc.kill('SIGTERM');
    for (let i = 0; i < 200 && !node.exited(); i++) await sleep(50);
    if (!node.exited()) { node.proc.kill('SIGKILL'); for (let i = 0; i < 200 && !node.exited(); i++) await sleep(50); }
  }
  try { fs.closeSync(node.fd); } catch (e) { /* already closed */ }
  return node.exited();
}

// Per-transaction fee records from the node log: exactly the four TRACE lines that follow each
// "Fee benchmark for transaction with hash <h>" line, in this order. Anything else is an error, never skipped.
const KEYS = [['Gas Limit', 'fee_trace_gas_limit'], ['Gas spent on computation', 'computational_gas'], ['Gas spent on pubdata', 'pubdata_gas'], ['Pubdata published', 'pubdata_bytes']];
function parseFeeTrace(text) {
  const L = text.split('\n');
  const recs = new Map();
  for (let i = 0; i < L.length; i++) {
    const m = /^\s*TRACE Fee benchmark for transaction with hash ([0-9a-f]{64})\s*$/.exec(L[i]);
    if (!m) continue;
    const rec = {};
    KEYS.forEach(([k, name], j) => {
      const mm = new RegExp(`^\\s*TRACE ${k}: (\\d+)\\s*$`).exec(L[i + 1 + j] || '');
      if (!mm) throw new Error(`fee trace for 0x${m[1]}: log line ${i + 2 + j} is not "${k}: <n>"`);
      rec[name] = Number(mm[1]);
    });
    const h = `0x${m[1]}`;
    if (!recs.has(h)) recs.set(h, []);
    recs.get(h).push(rec);
    i += KEYS.length;
  }
  return recs;
}
module.exports = { bin, version, sha256File, start, stop, parseFeeTrace };
