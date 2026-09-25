'use strict';
// One cell of the L1 matrix on a fresh chain (CHAIN-PROTOCOL-v1 §7). Environment-independent: the caller
// provides a JSON-RPC handle (EDR in-process or geth HTTP), the chain id, fee fields and labels.
const { ethers } = require('ethers');
const C = require('./common');
const K = require('./constants');
const G = require('./gas');
const PS = require('./proofset');
const { rawCall, waitReceipt } = require('./rpc');

const coder = ethers.AbiCoder.defaultAbiCoder();
function decodeRevert(data) {
  if (!data || data === '0x') return 'EMPTY_REVERT_DATA';
  if (data.startsWith('0x08c379a0')) return coder.decode(['string'], '0x' + data.slice(10))[0];
  return `DATA:${data.slice(0, 74)}`;
}
function wallets() {
  return { A0: ethers.HDNodeWallet.fromPhrase(K.MNEMONIC, undefined, `${K.HD_BASE}/0`), A1: ethers.HDNodeWallet.fromPhrase(K.MNEMONIC, undefined, `${K.HD_BASE}/1`) };
}

async function runCell(ctx, cell, proofJs, ps) {
  const { rpc } = ctx;
  const W = wallets();
  const rows = [];
  let seq = 0;
  const nonce = { A0: 0, A1: 0 };
  const addr = {};
  const vArt = ctx.artifact(cell.profile, cell.verifier.source, cell.verifier.name);
  const mArt = ctx.artifact(cell.profile, cell.manager.source, cell.manager.name);
  const vI = new ethers.Interface(vArt.abi);
  const mI = new ethers.Interface(mArt.abi);
  const names = { verifier: cell.verifier.name, manager: cell.manager.name };
  const base = () => ({
    campaign_id: C.CAMPAIGN_ID, run_id: ctx.runId, plan: ctx.plan, env: ctx.env, client_version: ctx.clientVersion, hardfork: ctx.hardfork,
    chain_id: ctx.chainId, profile: cell.profile, cell_id: cell.cell_id, backend: cell.backend, depth: cell.depth, partner_depth: cell.partner_depth,
    gas_price_semantics: 'bookkeeping_only',
  });
  const proofCols = (p) => (p ? { proof_id: p.id, proof_j: p.j, leaf_index: p.leaf_index } : { proof_id: '', proof_j: '', leaf_index: '' });

  async function tx(op, o) {
    const from = o.from || 'A0';
    const w = W[from];
    const n = nonce[from]++;
    const gasLimit = K.GAS_LIMIT[op];
    const req = { type: 2, chainId: ctx.chainId, nonce: n, to: o.create ? null : addr[o.to], data: o.data, value: 0n, gasLimit: BigInt(gasLimit), ...ctx.fees };
    const raw = await w.signTransaction(req);
    const hash = await rpc.call('eth_sendRawTransaction', [raw]);
    const rc = await waitReceipt(rpc, hash);
    const status = Number(rc.status);
    const gasUsed = Number(rc.gasUsed);
    let revert = '';
    if (status === 0) {
      const prev = '0x' + (Number(rc.blockNumber) - 1).toString(16);
      const callReq = { from: w.address, data: o.data, gas: '0x' + gasLimit.toString(16) };
      if (!o.create) callReq.to = addr[o.to];
      const r = await rawCall(rpc, callReq, prev);
      revert = r.ok ? 'NO_REVERT_ON_REPLAY' : (r.data ? decodeRevert(r.data) : `MSG:${r.message}`);
    }
    let caddr = o.create ? '' : addr[o.to];
    let rtBytes = '', rtKeccak = '', rtMatch = '';
    if (o.create && status === 1) {
      caddr = ethers.getAddress(rc.contractAddress);
      addr[o.key] = caddr;
      const code = await rpc.call('eth_getCode', [caddr, 'latest']);
      rtBytes = (code.length - 2) / 2; rtKeccak = ethers.keccak256(code);
      rtMatch = code.toLowerCase() === o.artifact.deployedBytecode.toLowerCase() ? 1 : 0;
    }
    const d = G.derive({ data: o.data, isCreate: !!o.create, gasUsed, runtimeBytes: rtBytes });
    const pass = status === o.expected && (o.expected === 1 || revert === o.expectedRevert) && (!o.create || rtMatch === 1);
    rows.push({
      ...base(), op_seq: ++seq, op, kind: 'tx', ...proofCols(o.proof), from_account: from, to_contract: o.create ? '' : o.to,
      contract_name: o.create ? names[o.key] : names[o.to], contract_address: caddr, nonce: n, gas_limit: gasLimit,
      expected_status: o.expected, status, expected_revert: o.expectedRevert || '', revert_reason: revert, expected_return: '', return_value: '',
      check_pass: pass ? 1 : 0, gas_used: gasUsed, ...d, initcode_bytes: o.create ? d.calldata_bytes : '', runtime_bytes: rtBytes, runtime_keccak: rtKeccak,
      runtime_matches_artifact: rtMatch, calldata_sha256: C.sha256Buf(Buffer.from(o.data.slice(2), 'hex')), tx_hash: hash,
      block_number: Number(rc.blockNumber), gas_price_wei: rc.effectiveGasPrice ? BigInt(rc.effectiveGasPrice).toString() : '',
    });
  }
  async function call(op, o) {
    const r = await rawCall(rpc, { from: W.A0.address, to: addr[o.to], data: o.data }, 'latest');
    let ret;
    if (!r.ok) ret = `REVERT:${r.data ? decodeRevert(r.data) : r.message}`;
    else { try { ret = String(coder.decode(['bool'], r.data)[0]); } catch (e) { ret = `DATA:${r.data}`; } }
    const c = G.calldata(o.data);
    rows.push({
      ...base(), op_seq: ++seq, op, kind: 'call', ...proofCols(o.proof), from_account: 'A0', to_contract: o.to, contract_name: names[o.to],
      contract_address: addr[o.to], nonce: '', gas_limit: '', expected_status: 'call', status: 'call', expected_revert: '', revert_reason: '',
      expected_return: String(o.expected), return_value: ret, check_pass: ret === String(o.expected) ? 1 : 0,
      calldata_bytes: c.bytes, calldata_zero_bytes: c.zero, calldata_tokens: c.tokens, calldata_sha256: C.sha256Buf(Buffer.from(o.data.slice(2), 'hex')),
    });
  }
  const vc = (args) => mI.encodeFunctionData('verifyCredential', args);
  const vp = (args) => vI.encodeFunctionData('verifyProof', args);

  await tx('deploy_verifier', { create: true, key: 'verifier', data: vArt.bytecode, artifact: vArt, expected: 1 });
  await tx('deploy_manager', { create: true, key: 'manager', data: mArt.bytecode + coder.encode(['address'], [addr.verifier]).slice(2), artifact: mArt, expected: 1 });
  await tx('set_issuer', { to: 'manager', data: mI.encodeFunctionData('setIssuer', [W.A0.address, true]), expected: 1 });
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
module.exports = { runCell, wallets, decodeRevert };
