'use strict';
// Hardfork verification for L1-EDR (osaka + prague control) and optionally L1-geth (CHAIN-PROTOCOL-v1 §5.1, §11).
// Usage: node scripts/env_check.js [--geth-bin <path>] [--out <file>]
const { execFileSync } = require('child_process');
const path = require('path');
const { ethers } = require('ethers');
const C = require('../lib/common');
const K = require('../lib/constants');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };

async function inEdr() {
  // Called in a child process with CHAINBENCH_HARDFORK set.
  const hre = require('hardhat');
  const { EdrRpc } = require('../lib/rpc');
  const envcheck = require('../lib/envcheck');
  const rpc = new EdrRpc(hre.network.provider);
  const w = ethers.HDNodeWallet.fromPhrase(K.MNEMONIC, undefined, `${K.HD_BASE}/0`);
  const res = await envcheck.run(rpc, w, K.EDR_CHAIN_ID, K.FEES.edr);
  res.configured_hardfork = hre.network.config.hardfork;
  res.client_version = await rpc.call('web3_clientVersion');
  process.stdout.write(JSON.stringify(res));
}
async function main() {
  const out = { at_utc: C.nowUtc(), protocol: C.PROTOCOL_REL, edr: {} };
  for (const hf of ['osaka', 'prague']) {
    const s = execFileSync(process.execPath, [__filename, '--child'], { cwd: C.CHAINBENCH, env: { ...process.env, CHAINBENCH_HARDFORK: hf, CHAINBENCH_PROFILE: 'primary' }, encoding: 'utf8' });
    out.edr[hf] = JSON.parse(s);
  }
  out.edr_pass = out.edr.osaka.configured_hardfork === 'osaka' && out.edr.osaka.osaka_markers_all && out.edr.prague.osaka_markers_none;
  const gethBin = arg('--geth-bin');
  if (gethBin) {
    const G = require('../lib/geth');
    const envcheck = require('../lib/envcheck');
    const g = await G.startGeth(gethBin, 18545);
    try {
      const w = ethers.HDNodeWallet.fromPhrase(K.MNEMONIC, undefined, `${K.HD_BASE}/0`);
      await G.fundAccounts(g.rpc, [w.address]);
      const chainId = Number(await g.rpc.call('eth_chainId'));
      out.geth = await envcheck.run(g.rpc, w, chainId, K.FEES.geth);
      out.geth.client_version = await g.rpc.call('web3_clientVersion');
      out.geth.chain_id = chainId;
      out.geth.binary_sha256 = C.sha256File(gethBin);
    } finally { await G.stopGeth(g); }
    out.geth_pass = out.geth.osaka_markers_all;
  }
  out.pass = out.edr_pass && (gethBin ? out.geth_pass : true);
  const s = JSON.stringify(out, null, 2);
  if (arg('--out')) C.writeJson(path.resolve(arg('--out')), out);
  console.log(s);
  process.exit(out.pass ? 0 : 1);
}
if (process.argv.includes('--child')) inEdr().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2); });
else main().catch((e) => { console.error(e); process.exit(2); });
