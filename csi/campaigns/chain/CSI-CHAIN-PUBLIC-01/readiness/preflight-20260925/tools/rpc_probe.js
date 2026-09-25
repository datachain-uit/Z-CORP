'use strict';
// CSI-CHAIN-PUBLIC-01 final pre-flight: READ-ONLY RPC compatibility probe (engineering record, not session evidence).
// Runs in the frozen chainbench-public image with the repository mounted read-only (preflight_mac.sh live).
// It uses the adapter's own JSON-RPC client (https only, loopback refused, URL recorded as sha256 unless public).
// It NEVER loads a key and NEVER signs or sends a transaction: eth_sendRawTransaction is deliberately not called.
// eth_estimateGas / zks_estimateFee are node-side simulations from a keyless probe address (no account, no funds).
//   node rpc_probe.js --out <file>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const REPO = path.resolve(__dirname, '..', '..', '..', '..', '..');
const AD = path.join(REPO, 'chainbench', 'adapters', 'public');
const areq = createRequire(path.join(AD, 'package.json'));
const { ethers } = areq('ethers');
const { utils: zu } = areq('zksync-ethers');
const { Rpc, checkEndpoint } = require(path.join(AD, 'lib', 'rpc'));
const { profile, checkChainId } = require(path.join(AD, 'lib', 'networks'));
const INP = require(path.join(AD, 'lib', 'inputs'));
for (const k of Object.keys(process.env)) if (/KEY/.test(k) && k.startsWith('CHAINBENCH_PUBLIC_')) { console.error(`[FAIL] ${k} is set; the probe never runs with a key`); process.exit(3); }
const B = JSON.parse(fs.readFileSync(path.join(REPO, 'chainbench', 'workloads', 'zcorp', 'campaigns', 'CSI-CHAIN-PUBLIC-01.json'), 'utf8'));
const PROC = JSON.parse(fs.readFileSync(path.join(REPO, 'chainbench', 'workloads', 'zcorp', 'public', 'procedure.json'), 'utf8'));
const inputs = INP.load(REPO, B);
const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? path.resolve(argv[argv.indexOf('--out') + 1]) : null;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hex = (n) => '0x' + BigInt(n).toString(16);
const PROBE = ethers.getAddress('0x' + ethers.keccak256(ethers.toUtf8Bytes('CSI-CHAIN-PUBLIC-01 pre-flight probe address (no key exists)')).slice(-40));
const UNKNOWN_TX = '0x' + sha('CSI-CHAIN-PUBLIC-01 pre-flight: a transaction hash that does not exist');
const PLACEHOLDER_VERIFIER = ethers.getCreateAddress({ from: PROBE, nonce: 0 });
const ENV_URL = { sepolia: 'CHAINBENCH_PUBLIC_RPC_SEPOLIA', 'era-sepolia': 'CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA' };
const ENV_LABEL = { sepolia: 'CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA', 'era-sepolia': 'CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA' };
// parameters are recorded with long hex strings replaced by their sha256 and length (reproducible from the frozen inputs)
function summarize(x) {
  if (typeof x === 'string' && /^0x[0-9a-fA-F]{130,}$/.test(x)) return { hex_sha256: sha(Buffer.from(x.slice(2), 'hex')), bytes: (x.length - 2) / 2 };
  if (Array.isArray(x)) return x.length > 64 && x.every((v) => typeof v === 'number') ? { byte_array_sha256: sha(Buffer.from(x)), bytes: x.length } : x.map(summarize);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, summarize(v)]));
  return x;
}
function deployments(venue) {
  const out = [];
  for (const backend of PROC.backends) {
    for (const role of ['verifier', 'manager']) {
      const art = inputs.artifacts[venue][PROC.contracts[backend][role]];
      const ctor = role === 'manager' ? ethers.AbiCoder.defaultAbiCoder().encode(['address'], [PLACEHOLDER_VERIFIER]) : '0x';
      out.push({ backend, role, name: art.name, art, ctor });
    }
  }
  return out;
}
async function probeNetwork(net) {
  const prof = profile(B, net);
  const url = process.env[ENV_URL[net]] || (B.endpoints.public_defaults || {})[net];
  const res = { network: net, chain_id_expected: prof.chain_id, endpoint: null, calls: [], stopped: null };
  if (!url) { res.stopped = `endpoint not configured (${ENV_URL[net]})`; return res; }
  try { checkEndpoint(url, 'live'); } catch (e) { res.stopped = `${e.code}: ${e.message}`; return res; }
  const rpc = new Rpc(url, { label: process.env[ENV_LABEL[net]] || '', mode: 'live', timeoutMs: B.timing.rpc_timeout_ms, publicUrls: Object.values(B.endpoints.public_defaults || {}) });
  res.endpoint = rpc.identity;
  async function c(name, method, params = [], meta = {}) {
    const t = new Date().toISOString();
    try {
      const r = await rpc.request(method, params);
      res.calls.push({ name, method, params: summarize(params), ...meta, t_request_utc: r.t_req.utc, t_response_utc: r.t_res.utc, ms: r.ms, http_status: r.http_status, ok: true, response_raw: r.raw, response_sha256: sha(r.raw) });
      return r.result;
    } catch (e) {
      res.calls.push({ name, method, params: summarize(params), ...meta, t_request_utc: t, t_response_utc: new Date().toISOString(), ok: false, error_kind: e.kind || 'error', error_code: e.code === undefined ? null : e.code, error_message: String(e.message).slice(0, 400), http_status: e.http_status || null, response_raw: e.raw ? String(e.raw).slice(0, 4000) : null });
      return undefined;
    }
  }
  const cid = await c('chainId', 'eth_chainId');
  try { checkChainId(B, prof, cid); } catch (e) { res.stopped = `chain id check failed: ${e.code || 'error'} ${e.message}`; return res; }
  await c('clientVersion', 'web3_clientVersion');
  const bn = await c('blockNumber', 'eth_blockNumber');
  const latest = await c('latestBlock', 'eth_getBlockByNumber', ['latest', false]);
  const n = latest && latest.number ? BigInt(latest.number) : (bn ? BigInt(bn) : null);
  if (n !== null) await c('blockByNumber', 'eth_getBlockByNumber', [hex(n - 1n), false]);
  await c('gasPrice', 'eth_gasPrice');
  await c('balanceLatest', 'eth_getBalance', [PROBE, 'latest']);
  if (n !== null) await c('balanceAtBlock', 'eth_getBalance', [PROBE, hex(n - 1n)]);
  await c('nonceLatest', 'eth_getTransactionCount', [PROBE, 'latest']);
  await c('noncePending', 'eth_getTransactionCount', [PROBE, 'pending']);
  await c('code', 'eth_getCode', [PROBE, 'latest']);
  await c('call', 'eth_call', [{ from: PROBE, to: PROBE, data: '0x' }, 'latest']);
  await c('receiptUnknown', 'eth_getTransactionReceipt', [UNKNOWN_TX]);
  await c('txUnknown', 'eth_getTransactionByHash', [UNKNOWN_TX]);
  await c('ethConfig', 'eth_config', [], { optional: true, note: 'EIP-7910 fork configuration; not used by the runner' });
  if (prof.kind === 'evm') {
    await c('maxPriorityFeePerGas', 'eth_maxPriorityFeePerGas');
    await c('feeHistory', 'eth_feeHistory', ['0x5', 'latest', [10, 50, 90]]);
    await c('feeHistory1024', 'eth_feeHistory', ['0x400', 'latest', [5, 10, 25, 50, 75, 90]], { optional: true, note: 'longer window for the P evaluation; not used by the runner' });
    const cap = B.fee_policy.sepolia.gas_limit;
    for (const d of deployments('evm')) {
      const op = d.role === 'verifier' ? 'deploy_verifier' : 'deploy_manager';
      await c(`estimateDeploy:${d.name}`, 'eth_estimateGas', [{ from: PROBE, data: d.art.bytecode + d.ctor.slice(2), gas: hex(cap[op]) }, 'latest'],
        { optional: true, note: `simulation only (no key, no funds): does the frozen init code execute within the frozen ${op} gas limit ${cap[op]}?`, frozen_gas_limit: cap[op], init_sha256: d.art.init_sha256 });
    }
  } else {
    await c('protocolVersion', 'zks_getProtocolVersion');
    await c('feeParams', 'zks_getFeeParams');
    const batch = await c('l1BatchNumber', 'zks_L1BatchNumber');
    if (batch !== undefined) {
      const b = Number(BigInt(batch));
      await c('l1BatchDetails', 'zks_getL1BatchDetails', [b]);
      await c('l1BatchDetailsPrev', 'zks_getL1BatchDetails', [b - 1]);
      await c('l1BatchDetailsOld', 'zks_getL1BatchDetails', [b - 1000], { optional: true, note: 'an older batch, to check that commit/prove/execute fields populate (post-hoc finality collection)' });
    }
    if (n !== null) await c('blockDetails', 'zks_getBlockDetails', [Number(n)]);
    await c('txDetailsUnknown', 'zks_getTransactionDetails', [UNKNOWN_TX]);
    const gpp = hex(B.fee_policy['era-sepolia'].estimate_gas_per_pubdata);
    await c('estimateFeeCall', 'zks_estimateFee', [{ from: PROBE, to: PROBE, data: '0x', value: '0x0', type: hex(113), eip712Meta: { gasPerPubdata: gpp } }], { note: 'simulation only (no key, no funds)' });
    for (const d of deployments('eravm')) {
      const data = zu.CONTRACT_DEPLOYER.encodeFunctionData('create', [ethers.ZeroHash, zu.hashBytecode(d.art.bytecode), d.ctor]);
      await c(`estimateDeploy:${d.name}`, 'zks_estimateFee', [{ from: PROBE, to: zu.CONTRACT_DEPLOYER_ADDRESS, data, value: '0x0', type: hex(113), eip712Meta: { gasPerPubdata: gpp, factoryDeps: [Array.from(ethers.getBytes(d.art.bytecode))] } }],
        { optional: true, note: 'simulation only (no key, no funds): the exact deployment shape of the frozen send policy, from the keyless probe address', bytecode_hash: d.art.bytecode_hash });
    }
  }
  return res;
}
async function main() {
  const started = new Date().toISOString();
  const nets = [];
  for (const net of Object.keys(B.networks)) nets.push(await probeNetwork(net));
  const body = { kind: 'rpc-compatibility-probe (pre-flight engineering record; not session evidence)', campaign_id: B.campaign_id, started_utc: started, finished_utc: new Date().toISOString(),
    probe_address: PROBE, probe_address_rule: "last 20 bytes of keccak256('CSI-CHAIN-PUBLIC-01 pre-flight probe address (no key exists)')", unknown_tx_hash: UNKNOWN_TX,
    placeholder_manager_ctor_verifier: PLACEHOLDER_VERIFIER, node: process.version, inputs_manifest_sha256: inputs.manifest_sha256,
    never: 'no key loaded; nothing signed; eth_sendRawTransaction not called', networks: nets };
  const text = JSON.stringify(body, null, 2) + '\n';
  if (OUT) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, text); }
  for (const r of nets) {
    console.log(`== ${r.network} (${r.endpoint ? `${r.endpoint.label} host ${r.endpoint.host}` : 'no endpoint'})${r.stopped ? ` STOPPED: ${r.stopped}` : ''}`);
    for (const x of r.calls) console.log(`  ${x.ok ? 'ok  ' : (x.optional ? 'miss' : 'FAIL')} ${x.method} [${x.name}]${x.ok ? '' : ` — ${x.error_kind} ${x.error_code === null ? '' : x.error_code} ${x.error_message}`}`);
  }
  console.log(`RPC-PROBE: nothing was signed or sent; record ${OUT ? path.relative(REPO, OUT) : '(stdout only)'}`);
}
main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
