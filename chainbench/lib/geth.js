'use strict';
// Start/stop a fresh in-memory `geth --dev` process (CHAIN-PROTOCOL-v1 §11).
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HttpRpc, waitReceipt } = require('./rpc');
const { BLOCK_GAS_LIMIT } = require('./constants');
function gethVersion(bin) { return execFileSync(bin, ['version'], { encoding: 'utf8' }); }
async function startGeth(bin, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chainbench-geth-'));
  const args = ['--dev', '--dev.period', '0', '--dev.gaslimit', String(BLOCK_GAS_LIMIT),
    '--http', '--http.addr', '127.0.0.1', '--http.port', String(port), '--http.api', 'eth,net,web3,debug',
    '--ipcdisable', '--nodiscover', '--maxpeers', '0', '--port', String(port + 1), '--authrpc.port', String(port + 2),
    '--rpc.txfeecap', '0', '--verbosity', '2'];
  const logFile = path.join(dir, 'geth.log');
  const log = fs.openSync(logFile, 'w');
  const proc = spawn(bin, args, { stdio: ['ignore', log, log] });
  const rpc = new HttpRpc(`http://127.0.0.1:${port}`);
  const t0 = Date.now();
  for (;;) {
    try { await rpc.call('eth_chainId'); break; } catch (e) {
      if (proc.exitCode !== null) throw new Error(`geth exited: ${fs.readFileSync(logFile, 'utf8').slice(-2000)}`);
      if (Date.now() - t0 > 30000) throw new Error('geth did not start');
      await new Promise((s) => setTimeout(s, 200));
    }
  }
  return { proc, rpc, dir, logFile, args };
}
async function fundAccounts(rpc, addrs, weiHex = '0x3635c9adc5dea00000' /* 1000 ETH */) {
  const [dev] = await rpc.call('eth_accounts');
  for (const to of addrs) {
    const h = await rpc.call('eth_sendTransaction', [{ from: dev, to, value: weiHex }]);
    const r = await waitReceipt(rpc, h);
    if (r.status !== '0x1') throw new Error('funding failed');
  }
  return dev;
}
async function stopGeth(g) {
  if (g.proc.exitCode === null) {
    g.proc.kill('SIGTERM');
    await new Promise((res) => { const t = setTimeout(() => { try { g.proc.kill('SIGKILL'); } catch (e) {} res(); }, 10000); g.proc.on('exit', () => { clearTimeout(t); res(); }); });
  }
  fs.rmSync(g.dir, { recursive: true, force: true });
}
module.exports = { startGeth, stopGeth, fundAccounts, gethVersion };
