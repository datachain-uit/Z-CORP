'use strict';
// CSI-CHAIN-PUBLIC-01: READ-ONLY RPC compatibility probe of an endpoint (engineering record, not session evidence).
// Every JSON-RPC method the public runner and the finality collector use is called read-only (plus historical-state
// reads, batch/finality fields and fee simulations of the exact frozen deployment shapes), with raw responses and sha256.
// Uses the adapter's own JSON-RPC client (https only, loopback refused; the URL is recorded only as host + sha256 unless
// it is public). It NEVER loads a key and NEVER signs or sends a transaction: eth_sendRawTransaction is not called.
// eth_estimateGas / zks_estimateFee are node-side simulations from a keyless probe address (no account, no funds).
//   node rpc_compat_public.js [--networks sepolia,era-sepolia] [--secondary] --out <file>
// --secondary probes the candidate secondary endpoints instead of the primaries: CHAINBENCH_PUBLIC_RPC_<NET>_SECONDARY and
// CHAINBENCH_PUBLIC_RPC_LABEL_<NET>_SECONDARY (NET = SEPOLIA | ERA_SEPOLIA), for read-only compatibility only.
// --errors adds read-only error-transport probes (an unknown method, an insufficient-funds simulation from the keyless
// probe address, a reverting eth_call) and records how the endpoint returns JSON-RPC errors (HTTP status, code, message):
// the runner's client treats any non-200 response as an HTTP error.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const AD = path.resolve(__dirname, '..');
const REPO = path.resolve(AD, '..', '..', '..');
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
const SECONDARY = argv.includes('--secondary');
const ERRORS = argv.includes('--errors');
const NETS = argv.includes('--networks') ? argv[argv.indexOf('--networks') + 1].split(',') : Object.keys(B.networks);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hex = (n) => '0x' + BigInt(n).toString(16);
const PROBE = ethers.getAddress('0x' + ethers.keccak256(ethers.toUtf8Bytes('CSI-CHAIN-PUBLIC-01 pre-flight probe address (no key exists)')).slice(-40));
const UNKNOWN_TX = '0x' + sha('CSI-CHAIN-PUBLIC-01 pre-flight: a transaction hash that does not exist');
const PLACEHOLDER_VERIFIER = ethers.getCreateAddress({ from: PROBE, nonce: 0 });
const SUF = SECONDARY ? '_SECONDARY' : '';
const ENV_URL = { sepolia: 'CHAINBENCH_PUBLIC_RPC_SEPOLIA' + SUF, 'era-sepolia': 'CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA' + SUF };
const ENV_LABEL = { sepolia: 'CHAINBENCH_PUBLIC_RPC_LABEL_SEPOLIA' + SUF, 'era-sepolia': 'CHAINBENCH_PUBLIC_RPC_LABEL_ERA_SEPOLIA' + SUF };
// the JSON-RPC methods the runner (run_public.js, txengine, feepolicy, observe) and collect_era_finality.js call
const REQUIRED = {
  evm: ['eth_chainId', 'web3_clientVersion', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getBalance',
    'eth_getTransactionCount', 'eth_getCode', 'eth_call', 'eth_getTransactionReceipt', 'eth_getTransactionByHash'],
  eravm: ['eth_chainId', 'web3_clientVersion', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_getBalance', 'eth_getTransactionCount', 'eth_getCode', 'eth_call',
    'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'zks_estimateFee', 'zks_getProtocolVersion', 'zks_getFeeParams', 'zks_L1BatchNumber', 'zks_getL1BatchDetails',
    'zks_getBlockDetails', 'zks_getTransactionDetails'],
};
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
  const url = process.env[ENV_URL[net]] || (SECONDARY ? null : (B.endpoints.public_defaults || {})[net]);
  const res = { network: net, role: SECONDARY ? 'candidate secondary (read-only compatibility)' : 'primary', chain_id_expected: prof.chain_id, endpoint: null, calls: [], stopped: null };
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
  if (n !== null) await c('callAtBlock', 'eth_call', [{ from: PROBE, to: PROBE, data: '0x' }, hex(n - 1n)], { note: 'historical eth_call (revert replay at the parent block)' });
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
  if (ERRORS) {
    const E = { optional: true, expected_error: true };
    await c('errUnknownMethod', 'chainbench_unknownMethod', [], { ...E, note: 'a method no endpoint implements' });
    if (prof.kind === 'evm') {
      await c('errInsufficientFunds', 'eth_estimateGas', [{ from: PROBE, to: PROBE, value: '0x1' }, 'latest'], { ...E, note: 'value > balance of the keyless probe address' });
      await c('errRevert', 'eth_call', [{ from: PROBE, data: '0x60006000fd' }, 'latest'], { ...E, note: 'creation code PUSH1 0 PUSH1 0 REVERT' });
    } else {
      const gpp = hex(B.fee_policy['era-sepolia'].estimate_gas_per_pubdata);
      await c('errInsufficientFunds', 'zks_estimateFee', [{ from: PROBE, to: PROBE, data: '0x', value: '0x1', type: hex(113), eip712Meta: { gasPerPubdata: gpp } }], { ...E, note: 'value > balance of the keyless probe address' });
      await c('errRevert', 'eth_call', [{ from: PROBE, to: zu.CONTRACT_DEPLOYER_ADDRESS, data: zu.CONTRACT_DEPLOYER.encodeFunctionData('create', [ethers.ZeroHash, '0x0100' + '11'.repeat(30), '0x']) }, 'latest'],
        { ...E, note: 'ContractDeployer.create of an unknown bytecode hash (reverts)' });
    }
  }
  res.coverage = coverage(res, prof);
  return res;
}
function coverage(res, prof) {
  const okm = (m) => res.calls.some((x) => x.method === m && x.ok && !x.optional) || res.calls.some((x) => x.method === m && x.ok);
  const req = REQUIRED[prof.kind];
  const missing = req.filter((m) => !okm(m));
  const get = (name) => { const x = res.calls.find((y) => y.name === name); if (!x || !x.ok) return undefined; try { return JSON.parse(x.response_raw).result; } catch (e) { return undefined; } };
  const cid = get('chainId');
  const out = { required_methods: req, methods_ok: req.filter((m) => okm(m)), missing, chain_id: cid ? Number(BigInt(cid)) : null,
    historical_state: ['balanceAtBlock', 'blockByNumber', 'callAtBlock'].every((nm) => res.calls.some((x) => x.name === nm && x.ok)),
    unknown_hash_returns_null: ['receiptUnknown', 'txUnknown'].concat(prof.kind === 'eravm' ? ['txDetailsUnknown'] : []).every((nm) => { const x = res.calls.find((y) => y.name === nm); return x && x.ok && JSON.parse(x.response_raw).result === null; }) };
  if (prof.kind === 'eravm') {
    const pv = get('protocolVersion'); out.protocol_version = pv ? pv.version_id : null;
    const fields = ['committedAt', 'provenAt', 'executedAt', 'commitTxHash', 'proveTxHash', 'executeTxHash', 'commitChainId', 'status'];
    const old = get('l1BatchDetailsOld') || get('l1BatchDetailsPrev');
    out.finality_fields = old ? Object.fromEntries(fields.map((f) => [f, old[f] !== undefined && old[f] !== null])) : null;
    out.finality_fields_complete = !!old && fields.every((f) => old[f] !== undefined && old[f] !== null);
    const est = res.calls.filter((x) => x.method === 'zks_estimateFee');
    out.fee_estimates_ok = est.length > 0 && est.every((x) => x.ok);
  }
  const errs = res.calls.filter((x) => x.expected_error);
  if (errs.length) {
    out.error_transport = errs.map((x) => { let body = null; try { body = JSON.parse(x.response_raw || 'null'); } catch (e) { body = null; }
      return { case: x.name, method: x.method, returned_error: !x.ok, http_status: x.ok ? x.http_status : (x.http_status || null), error_kind: x.ok ? null : x.error_kind,
        jsonrpc_code: body && body.error ? body.error.code : (x.error_code === undefined ? null : x.error_code),
        jsonrpc_message: body && body.error ? String(body.error.message).slice(0, 200) : (x.ok ? null : String(x.error_message).slice(0, 200)) }; });
    out.errors_as_http_200_jsonrpc = out.error_transport.every((e) => e.returned_error && e.error_kind === 'jsonrpc');
  }
  out.compatible = !res.stopped && missing.length === 0 && out.chain_id === prof.chain_id && out.historical_state && out.unknown_hash_returns_null
    && (prof.kind !== 'eravm' || (out.finality_fields_complete && out.fee_estimates_ok));
  return out;
}
async function main() {
  const started = new Date().toISOString();
  const nets = [];
  for (const net of NETS) nets.push(await probeNetwork(net));
  const body = { kind: 'rpc-compatibility-probe (pre-flight engineering record; not session evidence)', campaign_id: B.campaign_id, role: SECONDARY ? 'secondary endpoints (read-only compatibility)' : 'primary endpoints',
    tool: 'chainbench/adapters/public/tools/rpc_compat_public.js', image: require(path.join(AD, 'lib', 'imageid')).fromEnv(), started_utc: started, finished_utc: new Date().toISOString(),
    probe_address: PROBE, probe_address_rule: "last 20 bytes of keccak256('CSI-CHAIN-PUBLIC-01 pre-flight probe address (no key exists)')", unknown_tx_hash: UNKNOWN_TX,
    placeholder_manager_ctor_verifier: PLACEHOLDER_VERIFIER, node: process.version, inputs_manifest_sha256: inputs.manifest_sha256,
    never: 'no key loaded; nothing signed; eth_sendRawTransaction not called', networks: nets };
  const text = JSON.stringify(body, null, 2) + '\n';
  if (OUT) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, text); }
  for (const r of nets) {
    console.log(`== ${r.network} [${r.role}] (${r.endpoint ? `${r.endpoint.label} host ${r.endpoint.host}` : 'no endpoint'})${r.stopped ? ` STOPPED: ${r.stopped}` : ''}`);
    for (const x of r.calls) console.log(`  ${x.ok ? 'ok  ' : (x.optional ? 'miss' : 'FAIL')} ${x.method} [${x.name}]${x.ok ? '' : ` — ${x.error_kind} ${x.error_code === null ? '' : x.error_code} ${x.error_message}`}`);
  }
  for (const r of nets) if (r.coverage) console.log(`COVERAGE ${r.network} [${r.role}]: ${r.coverage.methods_ok.length}/${r.coverage.required_methods.length} required methods; chain id ${r.coverage.chain_id}; historical state ${r.coverage.historical_state}; unknown hash -> null ${r.coverage.unknown_hash_returns_null}${r.coverage.protocol_version !== undefined ? `; protocol ${r.coverage.protocol_version}; finality fields ${r.coverage.finality_fields_complete}; fee estimates ${r.coverage.fee_estimates_ok}` : ''}${r.coverage.error_transport ? `; errors: ${r.coverage.error_transport.map((e) => `${e.case}=${e.error_kind === 'http' ? 'HTTP ' + e.http_status : e.error_kind || 'no error'}/${e.jsonrpc_code}`).join(', ')}` : ''} -> ${r.coverage.compatible ? 'COMPATIBLE' : 'NOT COMPATIBLE: ' + r.coverage.missing.join(', ')}`);
  console.log(`RPC-PROBE: nothing was signed or sent; record ${OUT ? path.relative(REPO, OUT) : '(stdout only)'}`);
}
main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
