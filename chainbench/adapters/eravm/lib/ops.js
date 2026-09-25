'use strict';
// One cell of the local-EraVM matrix on a fresh node: the operation sequence of CHAIN-PROTOCOL-v1 §7 (via §16.4),
// sent as signed EIP-712 transactions with fixed fields. Accounts, proof set, tamper rule and revert decoding are the
// workload's (reused unchanged). Fee accounting is attached after the node has stopped (attachAccounting).
const { ethers } = require('ethers');
const { utils, EIP712Signer } = require('zksync-ethers');
const C = require('../../../lib/common');
const W = require('../../../core/workload');
const PS = W.module('proofset');
const { wallets, decodeRevert } = W.module('ops');
const { rawCall, waitReceipt } = require('../../../lib/rpc');
const E = require('./constants');

const coder = ethers.AbiCoder.defaultAbiCoder();
const lc = (a) => String(a || '').toLowerCase();
// The frame in which the sending account itself calls the target (below the bootloader's executeTransaction);
// the top-level frame is the node's summary of the whole transaction and is skipped.
function userFrame(top, from, to) {
  const walk = (f) => {
    if (lc(f.from) === lc(from) && lc(f.to) === lc(to)) return f;
    for (const c of f.calls || []) { const r = walk(c); if (r) return r; }
    return null;
  };
  for (const c of top.calls || []) { const r = walk(c); if (r) return r; }
  return null;
}
function decodeBool(hex) { try { return String(coder.decode(['bool'], hex)[0]); } catch (e) { return `DATA:${String(hex).slice(0, 74)}`; } }

async function runCell(ctx, cell, proofJs, ps) {
  const { rpc } = ctx;
  const Wl = wallets();
  const signer = { A0: new EIP712Signer(Wl.A0, E.CHAIN_ID), A1: new EIP712Signer(Wl.A1, E.CHAIN_ID) };
  const rows = [];
  let seq = 0;
  const nonce = { A0: 0, A1: 0 };
  const addr = {};
  const vArt = ctx.artifact(cell.verifier.source, cell.verifier.name);
  const mArt = ctx.artifact(cell.manager.source, cell.manager.name);
  for (const a of [vArt, mArt]) if (ethers.hexlify(utils.hashBytecode(a.bytecode)) !== a.hash) throw new Error(`bytecode hash mismatch for ${a.name}`);
  const vI = new ethers.Interface(vArt.abi);
  const mI = new ethers.Interface(mArt.abi);
  const names = { verifier: cell.verifier.name, manager: cell.manager.name };
  const base = () => ({
    campaign_id: C.CAMPAIGN_ID, arm: 'L2-EraVM', run_id: ctx.runId, plan: ctx.plan, env: ctx.env, node_version: ctx.nodeVersion,
    protocol_version: ctx.protocolVersion, chain_id: E.CHAIN_ID, profile: cell.profile, cell_id: cell.cell_id, backend: cell.backend,
    depth: cell.depth, partner_depth: cell.partner_depth, fee_semantics: 'local_fixed_fee_input_derived',
  });
  const proofCols = (p) => (p ? { proof_id: p.id, proof_j: p.j, leaf_index: p.leaf_index } : { proof_id: '', proof_j: '', leaf_index: '' });

  async function tx(op, o) {
    const from = o.from || 'A0';
    const w = Wl[from];
    const n = nonce[from]++;
    const gasLimit = E.GAS_LIMIT[op];
    const art = o.create ? o.artifact : null;
    const to = o.create ? utils.CONTRACT_DEPLOYER_ADDRESS : addr[o.to];
    const data = o.create ? utils.CONTRACT_DEPLOYER.encodeFunctionData('create', [ethers.ZeroHash, art.hash, o.ctor || '0x']) : o.data;
    const req = {
      type: E.TX_TYPE, from: w.address, to, data, value: 0n, nonce: n, chainId: E.CHAIN_ID, gasLimit: BigInt(gasLimit),
      maxFeePerGas: E.MAX_FEE_PER_GAS, maxPriorityFeePerGas: E.MAX_PRIORITY_FEE_PER_GAS,
      customData: { gasPerPubdata: E.GAS_PER_PUBDATA_LIMIT, factoryDeps: o.create ? [art.bytecode] : [] },
    };
    req.customData.customSignature = await signer[from].sign(req);
    const raw = utils.serializeEip712(req);
    const hash = await rpc.call('eth_sendRawTransaction', [raw]);
    const rc = await waitReceipt(rpc, hash, 120000);
    const status = Number(rc.status);
    const blk = await rpc.call('eth_getBlockByNumber', [rc.blockNumber, false]);
    const trace = await rpc.call('debug_traceTransaction', [hash, { tracer: 'callTracer' }]);
    const uf = userFrame(trace, w.address, to);
    let revert = '';
    if (status === 0) revert = trace && trace.output ? decodeRevert(trace.output) : 'NO_TRACE_OUTPUT';
    let caddr = o.create ? '' : addr[o.to];
    let codeBytes = '', codeHash = '', codeMatch = '';
    if (o.create && status === 1) {
      caddr = ethers.getAddress(rc.contractAddress);
      addr[o.key] = caddr;
      const fromTrace = uf && uf.output ? ethers.getAddress(coder.decode(['address'], uf.output)[0]) : null;
      const code = await rpc.call('eth_getCode', [caddr, 'latest']);
      codeBytes = (code.length - 2) / 2; codeHash = ethers.hexlify(utils.hashBytecode(code));
      codeMatch = lc(code) === lc(art.bytecode) && codeHash === art.hash && fromTrace === caddr ? 1 : 0;
    }
    let ret = ''; let expRet = '';
    if (op === 'verify_credential' || op === 'verify_proof_direct') { expRet = 'true'; ret = status === 1 ? (uf ? decodeBool(uf.output) : 'NO_USER_FRAME') : 'REVERT'; }
    const pass = status === o.expected && (o.expected === 1 || revert === o.expectedRevert) && (!o.create || codeMatch === 1) && ret === expRet;
    rows.push({
      ...base(), op_seq: ++seq, op, kind: 'tx', ...proofCols(o.proof), from_account: from, to_contract: o.create ? '' : o.to,
      contract_name: o.create ? names[o.key] : names[o.to], contract_address: caddr, nonce: n,
      tx_type: E.TX_TYPE, gas_limit: gasLimit, gas_per_pubdata_limit: E.GAS_PER_PUBDATA_LIMIT.toString(), max_fee_per_gas_wei: E.MAX_FEE_PER_GAS.toString(),
      expected_status: o.expected, status, expected_revert: o.expectedRevert || '', revert_reason: revert, expected_return: expRet, return_value: ret,
      check_pass: pass ? 1 : 0, gas_used: Number(rc.gasUsed),
      calldata_bytes: (data.length - 2) / 2, calldata_sha256: C.sha256Buf(Buffer.from(data.slice(2), 'hex')), raw_tx_bytes: (raw.length - 2) / 2,
      factory_deps: o.create ? 1 : 0, bytecode_bytes: codeBytes, bytecode_hash: codeHash, bytecode_matches_artifact: codeMatch,
      tx_hash: hash, block_number: Number(rc.blockNumber), l1_batch_number: rc.l1BatchNumber === null || rc.l1BatchNumber === undefined ? '' : Number(rc.l1BatchNumber),
      block_timestamp: Number(blk.timestamp), effective_gas_price_wei: rc.effectiveGasPrice ? BigInt(rc.effectiveGasPrice).toString() : '',
    });
  }
  async function call(op, o) {
    const r = await rawCall(rpc, { from: Wl.A0.address, to: addr[o.to], data: o.data }, 'latest');
    let ret;
    if (!r.ok) ret = `REVERT:${r.data ? decodeRevert(r.data) : r.message}`;
    else ret = decodeBool(r.data);
    rows.push({
      ...base(), op_seq: ++seq, op, kind: 'call', ...proofCols(o.proof), from_account: 'A0', to_contract: o.to, contract_name: names[o.to],
      contract_address: addr[o.to], nonce: '', expected_status: 'call', status: 'call', expected_revert: '', revert_reason: '',
      expected_return: String(o.expected), return_value: ret, check_pass: ret === String(o.expected) ? 1 : 0,
      calldata_bytes: (o.data.length - 2) / 2, calldata_sha256: C.sha256Buf(Buffer.from(o.data.slice(2), 'hex')),
    });
  }
  const vc = (args) => mI.encodeFunctionData('verifyCredential', args);
  const vp = (args) => vI.encodeFunctionData('verifyProof', args);

  await tx('deploy_verifier', { create: true, key: 'verifier', artifact: vArt, expected: 1 });
  await tx('deploy_manager', { create: true, key: 'manager', artifact: mArt, ctor: coder.encode(['address'], [addr.verifier]), expected: 1 });
  await tx('set_issuer', { to: 'manager', data: mI.encodeFunctionData('setIssuer', [Wl.A0.address, true]), expected: 1 });
  const p0 = await ps.get(cell.backend, cell.depth, 0);
  await tx('add_root', { to: 'manager', data: mI.encodeFunctionData('addRoot', [p0.root]), expected: 1 });
  await call('precheck_call', { to: 'manager', data: vc(p0.args), expected: true, proof: p0 });
  const proofs = [];
  for (const j of proofJs) proofs.push(await ps.get(cell.backend, cell.depth, j));
  for (const p of proofs) await tx('verify_credential', { to: 'manager', data: vc(p.args), expected: 1, proof: p });
  for (const p of proofs) await call('verify_proof_call', { to: 'verifier', data: vp(p.args), expected: true, proof: p });
  for (const p of proofs) await tx('verify_proof_direct', { to: 'verifier', data: vp(p.args), expected: 1, proof: p });
  const pp = await ps.get(cell.backend, cell.partner_depth, 0);
  const tam = PS.tamper(cell.backend, p0.args);
  await tx('neg_unknown_root', { to: 'manager', data: vc(pp.args), expected: 0, expectedRevert: 'Invalid root', proof: pp });
  await call('neg_tampered_call', { to: 'verifier', data: vp(tam), expected: false, proof: p0 });
  await tx('neg_tampered', { to: 'manager', data: vc(tam), expected: 0, expectedRevert: 'Invalid proof', proof: p0 });
  await tx('neg_cross_depth_setup', { to: 'manager', data: mI.encodeFunctionData('addRoot', [pp.root]), expected: 1, proof: pp });
  await call('neg_cross_depth_call', { to: 'verifier', data: vp(pp.args), expected: false, proof: pp });
  await tx('neg_cross_depth', { to: 'manager', data: vc(pp.args), expected: 0, expectedRevert: 'Invalid proof', proof: pp });
  await tx('neg_non_issuer', { from: 'A1', to: 'manager', data: mI.encodeFunctionData('addRoot', [p0.root]), expected: 0, expectedRevert: 'CredentialManager: not issuer', proof: p0 });
  return rows;
}

// Attach the node's own fee accounting (anvil.parseFeeTrace) to the transaction rows of one cell, and check it:
// exactly one record per transaction hash, the recorded gas limit equals the sent one, pubdata_gas = pubdata_bytes x the
// batch gas-per-pubdata, the effective gas price is the fixed base fee, and receipt gasUsed is reproduced exactly.
function attachAccounting(rows, traces) {
  for (const r of rows) {
    if (r.kind !== 'tx') continue;
    const recs = traces.get(r.tx_hash) || [];
    if (recs.length !== 1) { r.accounting_ok = 0; r.accounting_note = `fee records: ${recs.length}`; continue; }
    const t = recs[0];
    Object.assign(r, t);
    r.gas_per_pubdata = t.pubdata_bytes > 0 && t.pubdata_gas % t.pubdata_bytes === 0 ? t.pubdata_gas / t.pubdata_bytes : '';
    r.gas_used_derived = E.derivedGasUsed(r.gas_limit, t.computational_gas, t.pubdata_bytes);
    r.accounting_ok = t.fee_trace_gas_limit === r.gas_limit && BigInt(t.pubdata_gas) === BigInt(t.pubdata_bytes) * E.FEE_INPUT.gas_per_pubdata
      && r.gas_used_derived === r.gas_used && r.effective_gas_price_wei === E.FEE_INPUT.base_fee.toString() ? 1 : 0;
  }
  return rows;
}
module.exports = { runCell, attachAccounting, userFrame };
