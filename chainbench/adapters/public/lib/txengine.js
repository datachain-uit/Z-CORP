'use strict';
// One planned operation -> one raw row (CHAIN-PUBLIC-PROTOCOL-v1 sections 8-11). Never throws for a network or client
// problem: every outcome is classified into one of the frozen states and recorded as it happened.
//   t_prepare: before the fee read / estimate and signing;  t0: immediately before eth_sendRawTransaction;
//   t_hash: when that call returns the hash;  t_receipt: when the first poll returns a receipt.
const crypto = require('crypto');
const { ethers } = require('ethers');
const { utils: zu } = require('zksync-ethers');
const { now } = require('./clock');
const S = require('./schema');
const FP = require('./feepolicy');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hexBytes = (h) => Buffer.from(h.replace(/^0x/, ''), 'hex');
const big = (x) => (x === null || x === undefined || x === '' ? null : BigInt(x));
const str = (x) => (x === null || x === undefined ? '' : x.toString());
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const coder = ethers.AbiCoder.defaultAbiCoder();
const INSUFFICIENT = /insufficient funds|insufficient balance|not enough balance|exceeds balance/i;
function decodeRevert(data) {
  if (!data || data === '0x') return 'EMPTY_REVERT_DATA';
  if (typeof data === 'string' && data.startsWith('0x08c379a0')) { try { return coder.decode(['string'], '0x' + data.slice(10))[0]; } catch (e) { /* fall through */ } }
  return `DATA:${String(data).slice(0, 74)}`;
}
function sendErrorClass(e) {
  if (e.kind === 'timeout') return 'send_timeout';
  if (e.kind === 'http') return 'send_http_error';
  if (e.kind === 'jsonrpc') return 'send_rpc_error';
  if (e.kind === 'parse') return 'send_parse_error';
  return 'send_network_error';
}

// ctx: { binding, proc, inputs, prof, rpc, signer, run, halted, nonce, deployments, timing, mode }
function resolveArg(ctx, a, backend) {
  if (a && typeof a === 'object' && a.ref) {
    if (a.ref === 'signer') return ctx.signer.address;
    if (a.ref === 'root') return BigInt(ctx.inputs.proofs.root);
    if (a.ref.startsWith('address:')) { const role = a.ref.split(':')[1]; return (ctx.deployments[backend] || {})[role] || null; }
    throw new Error(`unknown ref ${a.ref}`);
  }
  return a;
}
// Build { to, data, factoryDeps?, contract_role, contract_name, artifact_sha256, create } for a planned operation.
function buildRequest(ctx, o) {
  const st = o.step; const names = ctx.proc.contracts[o.backend];
  const venue = ctx.prof.kind;
  if (st.create) {
    const art = ctx.inputs.artifacts[venue][names[st.create]];
    const args = st.ctor.map((a) => resolveArg(ctx, a, o.backend));
    if (args.some((x) => x === null)) return { missing: 'dependency_missing' };
    const types = art.abi.find((x) => x.type === 'constructor') ? art.abi.find((x) => x.type === 'constructor').inputs.map((i) => i.type) : [];
    const ctor = types.length ? coder.encode(types, args) : '0x';
    if (venue === 'evm') {
      return { create: true, to: null, data: art.bytecode + ctor.slice(2), contract_role: st.create, contract_name: art.name, artifact_sha256: art.init_sha256, art };
    }
    const data = zu.CONTRACT_DEPLOYER.encodeFunctionData('create', [ethers.ZeroHash, zu.hashBytecode(art.bytecode), ctor]);
    return { create: true, to: zu.CONTRACT_DEPLOYER_ADDRESS, data, factoryDeps: [art.bytecode], contract_role: st.create, contract_name: art.name,
      artifact_sha256: art.bytecode_sha256, bytecode_hash: art.bytecode_hash, art };
  }
  const to = (ctx.deployments[o.backend] || {})[st.to];
  if (!to) return { missing: 'dependency_missing' };
  const art = ctx.inputs.artifacts[venue][names[st.to]];
  let data;
  if (st.frozen_calldata === 'add_root') data = ctx.inputs.proofs.add_root_calldata;
  else if (st.frozen_calldata === 'verify_credential') data = ctx.inputs.proofById[o.proof_id].verify_credential_calldata;
  else data = new ethers.Interface(art.abi).encodeFunctionData(st.fn, st.args.map((a) => resolveArg(ctx, a, o.backend)));
  return { create: false, to, data, contract_role: st.to, contract_name: art.name, artifact_sha256: '', art };
}
function baseRow(ctx, o) {
  const r = S.blank();
  Object.assign(r, {
    campaign_id: ctx.binding.campaign_id, run_id: ctx.run.run_id, mode: ctx.mode, protocol_sha256: ctx.run.protocol_sha256, harness_commit: ctx.run.harness_commit,
    inputs_manifest_sha256: ctx.run.inputs_manifest_sha256, session_id: o.session_id, phase: o.phase, block_id: o.block_id, block_position: o.block_position,
    pair_id: o.pair_id, schedule_id: o.schedule_id, op: o.op, backend: o.backend, depth: o.depth, proof_id: o.proof_id, network: ctx.prof.name,
    chain_id: ctx.prof.chain_id, provider_label: ctx.rpc.identity.label, endpoint_host: ctx.rpc.identity.host, endpoint_url_sha256: ctx.rpc.identity.url_sha256,
    observation_id: ctx.observation_id || '', signer_address: ctx.signer.address, poll_interval_ms: ctx.timing.poll_interval_ms,
  });
  return r;
}
function finish(r, state, errorClass = '', message = '') { r.state = state; r.error_class = errorClass; r.error_message = String(message || '').slice(0, 300); return r; }

async function nonceClean(ctx) {
  try {
    const [p, l] = await Promise.all([ctx.rpc.call('eth_getTransactionCount', [ctx.signer.address, 'pending']), ctx.rpc.call('eth_getTransactionCount', [ctx.signer.address, 'latest'])]);
    return Number(BigInt(p)) === ctx.nonce && Number(BigInt(l)) === ctx.nonce;
  } catch (e) { return false; }
}
async function afterUnsent(ctx) { if (!(await nonceClean(ctx))) ctx.halted = 'halted_nonce_uncertain'; }

async function execute(ctx, o) {
  const r = baseRow(ctx, o);
  const tp = now(); r.t_prepare_utc = tp.utc; r.t_prepare_mono_ms = tp.mono_ms;
  if (ctx.halted) return finish(r, 'unsent_preflight_failure', ctx.halted, 'an earlier operation of this block halted it');
  let q;
  try { q = buildRequest(ctx, o); } catch (e) { return finish(r, 'unsent_preflight_failure', 'build_error', e.message); }
  if (q.missing) return finish(r, 'unsent_preflight_failure', q.missing, 'a prerequisite deployment of this block is missing');
  Object.assign(r, { contract_role: q.contract_role, contract_name: q.contract_name, to_address: q.to || '', artifact_sha256: q.artifact_sha256,
    calldata_sha256: sha(hexBytes(q.data)), calldata_bytes: hexBytes(q.data).length, factory_deps: q.factoryDeps ? q.factoryDeps.length : 0, bytecode_hash: q.bytecode_hash || '' });
  const evm = ctx.prof.kind === 'evm';
  const nonce = ctx.nonce; r.nonce = nonce; r.tx_type = evm ? 2 : 113;
  // fees (frozen policy)
  let fee;
  try {
    fee = evm ? await FP.sepolia(ctx.rpc, ctx.binding.fee_policy.sepolia, o.op)
      : await FP.era(ctx.rpc, ctx.binding.fee_policy['era-sepolia'], { from: ctx.signer.address, to: q.to, data: q.data, factoryDeps: q.factoryDeps });
  } catch (e) {
    Object.assign(r, { notes: `fee step: ${e.kind || 'error'}` });
    if (INSUFFICIENT.test(e.message || '')) { await afterUnsent(ctx); return finish(r, 'unsent_insufficient_balance', 'estimate_insufficient_funds', e.message); }
    if (e.kind === 'jsonrpc' && /revert/i.test(e.message || '')) { await afterUnsent(ctx); return finish(r, 'unsent_preflight_failure', 'fee_estimate_revert', e.message); }
    await afterUnsent(ctx);
    return finish(r, 'unsent_client_error', e.kind ? `fee_rpc_${e.kind}` : 'fee_error', e.message);
  }
  Object.assign(r, fee.rec, { gas_limit: str(fee.tx.gasLimit), max_fee_per_gas: str(fee.tx.maxFeePerGas), max_priority_fee_per_gas: str(fee.tx.maxPriorityFeePerGas),
    gas_per_pubdata_limit: str(fee.tx.gasPerPubdata) });
  // balance rule
  let bal;
  try { bal = BigInt(await ctx.rpc.call('eth_getBalance', [ctx.signer.address, 'latest'])); } catch (e) { await afterUnsent(ctx); return finish(r, 'unsent_client_error', `balance_rpc_${e.kind || 'error'}`, e.message); }
  const required = fee.tx.gasLimit * fee.tx.maxFeePerGas;
  r.balance_before_latest = bal.toString(); r.balance_required = required.toString();
  if (bal < required) return finish(r, 'unsent_insufficient_balance', 'balance_below_required', `balance ${bal} < gasLimit*maxFeePerGas ${required}`);
  // sign
  let raw; let localHash;
  try {
    if (evm) {
      raw = await ctx.signer.signEvm({ type: 2, chainId: BigInt(ctx.prof.chain_id), nonce, to: q.to, data: q.data, value: 0n, ...fee.tx });
      localHash = ethers.Transaction.from(raw).hash;
    } else {
      raw = await ctx.signer.signEra({ type: 113, chainId: BigInt(ctx.prof.chain_id), nonce, from: ctx.signer.address, to: q.to, data: q.data, value: 0n,
        gasLimit: fee.tx.gasLimit, maxFeePerGas: fee.tx.maxFeePerGas, maxPriorityFeePerGas: fee.tx.maxPriorityFeePerGas,
        customData: { gasPerPubdata: fee.tx.gasPerPubdata, factoryDeps: q.factoryDeps || [] } });
      localHash = zu.parseEip712(raw).hash;
    }
  } catch (e) { return finish(r, 'unsent_preflight_failure', 'sign_error', e.message); }
  r.raw_tx_sha256 = sha(hexBytes(raw)); r.raw_tx_bytes = hexBytes(raw).length; r.tx_hash_local = localHash;
  // send
  const t0 = now(); r.t0_utc = t0.utc; r.t0_mono_ms = t0.mono_ms; r.prepare_to_send_ms = +(t0.mono_ms - tp.mono_ms).toFixed(3);
  let hash = null; let th = null;
  try {
    hash = await ctx.rpc.call('eth_sendRawTransaction', [raw]);
    th = now();
  } catch (e) {
    const te = now();
    if (INSUFFICIENT.test(e.message || '')) { r.notes = `send refused at ${te.utc}`; await afterUnsent(ctx); return finish(r, 'unsent_insufficient_balance', 'node_insufficient_funds', e.message); }
    let known = null;
    try { known = await ctx.rpc.call('eth_getTransactionByHash', [localHash]); } catch (e2) { known = null; }
    if (!known) { r.notes = `send failed at ${te.utc}`; await afterUnsent(ctx); return finish(r, 'unsent_client_error', sendErrorClass(e), e.message); }
    hash = localHash; r.error_class = 'send_error_tx_known'; r.error_message = String(e.message).slice(0, 300); r.notes = `send call failed (${sendErrorClass(e)}) but the transaction is known to the node`;
  }
  ctx.nonce = nonce + 1;
  r.tx_hash = hash; r.tx_hash_matches = String(hash).toLowerCase() === localHash.toLowerCase() ? 1 : 0;
  if (th) { r.t_hash_utc = th.utc; r.t_hash_mono_ms = th.mono_ms; r.send_to_hash_ms = +(th.mono_ms - t0.mono_ms).toFixed(3); }
  try { const b = await ctx.rpc.request('eth_blockNumber', []); r.block_at_hash = Number(BigInt(b.result)); r.block_at_hash_utc = b.t_res.utc; } catch (e) { r.block_at_hash = `error:${e.kind || 'error'}`; }
  // poll at a fixed interval
  const interval = ctx.timing.poll_interval_ms; const timeoutMs = ctx.timing.receipt_timeout_s * 1000;
  const pollStart = now(); let rc = null; let polls = 0; let perr = 0; let tr = null;
  for (;;) {
    const tq = now();
    polls++;
    try { const res = await ctx.rpc.request('eth_getTransactionReceipt', [hash]); if (res.result) { rc = res.result; tr = res.t_res; break; } } catch (e) { perr++; }
    const n = now();
    if (n.mono_ms - pollStart.mono_ms >= timeoutMs) break;
    await sleep(interval - (n.mono_ms - tq.mono_ms));
  }
  r.polls = polls; r.poll_errors = perr;
  if (!rc) { ctx.halted = 'halted_after_no_receipt'; return finish(r, 'submitted_no_receipt', r.error_class || 'receipt_timeout', `no receipt within ${ctx.timing.receipt_timeout_s} s`); }
  r.t_receipt_utc = tr.utc; r.t_receipt_mono_ms = tr.mono_ms;
  if (th) r.hash_to_receipt_ms = +(tr.mono_ms - th.mono_ms).toFixed(3);
  r.request_to_receipt_ms = +(tr.mono_ms - t0.mono_ms).toFixed(3);
  await receiptDetails(ctx, r, rc, q, fee, evm);
  return r;
}

async function receiptDetails(ctx, r, rc, q, fee, evm) {
  const notes = r.notes ? [r.notes] : [];
  const blockNo = BigInt(rc.blockNumber);
  const status = Number(BigInt(rc.status));
  const gasUsed = BigInt(rc.gasUsed); const egp = big(rc.effectiveGasPrice);
  Object.assign(r, { inclusion_block: blockNo.toString(), inclusion_block_hash: rc.blockHash || '', receipt_status: status, gas_used: gasUsed.toString(),
    effective_gas_price: str(egp), receipt_fee_wei: egp === null ? '' : (gasUsed * egp).toString() });
  if (!evm) { r.l1_batch_number = rc.l1BatchNumber === null || rc.l1BatchNumber === undefined ? '' : Number(BigInt(rc.l1BatchNumber)); r.l1_batch_tx_index = rc.l1BatchTxIndex === null || rc.l1BatchTxIndex === undefined ? '' : Number(BigInt(rc.l1BatchTxIndex)); }
  try {
    const b = await ctx.rpc.call('eth_getBlockByNumber', ['0x' + blockNo.toString(16), false]);
    r.inclusion_block_timestamp = Number(BigInt(b.timestamp)); r.inclusion_block_time_utc = new Date(r.inclusion_block_timestamp * 1000).toISOString();
    r.inclusion_block_base_fee = b.baseFeePerGas ? BigInt(b.baseFeePerGas).toString() : '';
    if (evm && b.baseFeePerGas && egp !== null) {
      const base = BigInt(b.baseFeePerGas); const tipCap = fee.tx.maxPriorityFeePerGas; const cap = fee.tx.maxFeePerGas;
      const exp = base + (tipCap < cap - base ? tipCap : cap - base);
      r.expected_effective_gas_price = exp.toString(); r.effective_price_ok = exp === egp ? 1 : 0;
    }
  } catch (e) { notes.push(`inclusion block read failed (${e.kind || 'error'})`); }
  try {
    const before = BigInt(await ctx.rpc.call('eth_getBalance', [ctx.signer.address, '0x' + (blockNo - 1n).toString(16)]));
    const after = BigInt(await ctx.rpc.call('eth_getBalance', [ctx.signer.address, '0x' + blockNo.toString(16)]));
    r.balance_before_block = before.toString(); r.balance_after_block = after.toString(); r.balance_delta_wei = (before - after).toString();
    if (r.receipt_fee_wei !== '') { const d = before - after - BigInt(r.receipt_fee_wei); r.fee_consistency_diff_wei = d.toString(); r.fee_consistency_ok = d === 0n ? 1 : 0; }
  } catch (e) { notes.push(`balance-at-block read failed (${e.kind || 'error'})`); }
  if (!evm) {
    try {
      const d = await ctx.rpc.call('zks_getTransactionDetails', [r.tx_hash]);
      if (d) {
        r.era_details_status = d.status || ''; r.era_details_fee = d.fee ? BigInt(d.fee).toString() : ''; r.era_details_gas_per_pubdata = d.gasPerPubdata ? BigInt(d.gasPerPubdata).toString() : '';
        if (r.era_details_fee !== '' && r.receipt_fee_wei !== '') r.era_details_fee_ok = r.era_details_fee === r.receipt_fee_wei ? 1 : 0;
      }
    } catch (e) { notes.push(`zks_getTransactionDetails failed (${e.kind || 'error'})`); }
  }
  if (status === 0) {
    try {
      const callReq = { from: ctx.signer.address, data: q.data, gas: '0x' + BigInt(r.gas_limit).toString(16) };
      if (q.to) callReq.to = q.to;
      await ctx.rpc.call('eth_call', [callReq, '0x' + (blockNo - 1n).toString(16)]);
      r.revert_reason = 'NO_REVERT_ON_REPLAY';
    } catch (e) { r.revert_reason = e.kind === 'jsonrpc' ? (e.data ? decodeRevert(typeof e.data === 'string' ? e.data : e.data.data) : `MSG:${String(e.message).slice(0, 120)}`) : `REPLAY_${e.kind || 'error'}`; }
    r.notes = notes.join('; ');
    return finish(r, 'reverted', 'status_0', r.error_message);
  }
  if (q.create) {
    let addr = rc.contractAddress ? ethers.getAddress(rc.contractAddress) : '';
    if (!evm) {
      const dep = zu.getDeployedContracts({ logs: rc.logs || [] });
      if (dep.length) { const a = dep[dep.length - 1].deployedAddress; if (addr && a !== addr) notes.push('receipt.contractAddress differs from the ContractDeployed event'); addr = a; }
    }
    r.contract_address = addr;
    if (addr) {
      try {
        const code = await ctx.rpc.call('eth_getCode', [addr, 'latest']);
        const expected = evm ? q.art.deployedBytecode : q.art.bytecode;
        r.runtime_code_sha256 = sha(hexBytes(code));
        r.runtime_matches_artifact = code.toLowerCase() === expected.toLowerCase() ? 1 : 0;
      } catch (e) { notes.push(`eth_getCode failed (${e.kind || 'error'})`); }
      if (r.runtime_matches_artifact === 1) { ctx.deployments[r.backend] = ctx.deployments[r.backend] || {}; ctx.deployments[r.backend][q.contract_role] = addr; }
      else notes.push('deployed code not verified against the artifact: later operations that need it are not sent');
    } else notes.push('no deployed address found');
  }
  r.notes = notes.join('; ');
  return finish(r, 'confirmed_success', r.error_class || '', r.error_message);
}

// eth_call check of a view function (post-setup identity checks, pre-verification checks). Read-only.
async function viewCheck(ctx, backend, spec) {
  const names = ctx.proc.contracts[backend];
  const venue = ctx.prof.kind;
  const to = (ctx.deployments[backend] || {})[spec.to];
  const art = ctx.inputs.artifacts[venue][names[spec.to]];
  const I = new ethers.Interface(art.abi);
  const out = { backend, check: spec.check || spec.fn, to: to || null, fn: spec.fn };
  if (!to) return { ...out, pass: false, error: 'not deployed' };
  try {
    const data = spec.frozen_calldata === 'verify_credential' ? ctx.inputs.proofById[spec.proof_id].verify_credential_calldata
      : I.encodeFunctionData(spec.fn, (spec.args || []).map((a) => resolveArg(ctx, a, backend)));
    const ret = await ctx.rpc.call('eth_call', [{ from: ctx.signer.address, to, data }, 'latest']);
    const got = I.decodeFunctionResult(spec.fn, ret)[0];
    const exp = resolveArg(ctx, spec.expect, backend);
    const norm = (v) => (typeof v === 'string' ? v.toLowerCase() : typeof v === 'bigint' ? v.toString() : v);
    return { ...out, proof_id: spec.proof_id || '', expected: String(exp), got: String(got), pass: norm(got) === norm(exp) };
  } catch (e) { return { ...out, pass: false, error: `${e.kind || 'error'}: ${String(e.message).slice(0, 160)}` }; }
}
module.exports = { execute, viewCheck, nonceClean, decodeRevert };
