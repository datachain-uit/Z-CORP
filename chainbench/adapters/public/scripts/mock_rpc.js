'use strict';
// Deterministic mock JSON-RPC endpoints for the engineering dry run (never a public network). One mock per chain kind:
//   evm   : an Ethereum-like chain (EIP-1559 blocks, receipts with effectiveGasPrice, eth_call, eth_getCode)
//   eravm : a ZKsync-Era-like chain (EIP-712 type-113 transactions, ContractDeployer deployments with factory
//           dependencies, zks_* methods, L1 batches with commit/prove/execute times)
// Contract behaviour is emulated from the frozen public inputs (artifacts, proof calldata, controlled-study gas), not
// executed: the dry run checks the harness paths (signing, serialisation, fees, timing, taxonomy, recording), while EVM and
// EraVM execution were measured in the controlled local arms. Faults are injected by a scenario object.
const http = require('http');
const crypto = require('crypto');
const { ethers } = require('ethers');
const { utils: zu } = require('zksync-ethers');

const coder = ethers.AbiCoder.defaultAbiCoder();
const hex = (n) => '0x' + BigInt(n).toString(16);
const errData = (msg) => '0x08c379a0' + coder.encode(['string'], [msg]).slice(2);
const SEL = (sig) => ethers.id(sig).slice(0, 10);
const S = { setIssuer: SEL('setIssuer(address,bool)'), addRoot: SEL('addRoot(uint256)'), verifier: SEL('verifier()'), owner: SEL('owner()'),
  isIssuer: SEL('isIssuer(address)'), isValidRoot: SEL('isValidRoot(uint256)') };
const DEPLOYED_TOPIC = ethers.id('ContractDeployed(address,bytes32,address)');

class Mock {
  constructor({ kind, chainId, port = 0, blockTimeMs, inputs, account, balanceWei, scenario = {} }) {
    Object.assign(this, { kind, chainId, port, blockTimeMs, inputs, scenario });
    this.baseFee = kind === 'evm' ? 1500000000n : 25000000n; // 1.5 gwei / 0.025 gwei
    this.gasPerPubdata = 80n;
    this.blocks = []; this.txs = new Map(); this.receipts = new Map(); this.pending = [];
    this.balances = new Map(); this.history = []; this.nonces = new Map(); this.deployNonces = new Map(); this.code = new Map(); this.managers = new Map();
    this.sends = 0; this.estimates = 0; this.polls = new Map(); this.batches = [];
    this.balances.set(account.toLowerCase(), BigInt(balanceWei));
    this.t0 = Math.floor(Date.now() / 1000);
    this.mine(); // genesis
    this.verify = new Map(); // calldata (lowercase) -> { proof }
    for (const p of inputs.proofs.proofs) this.verify.set(p.verify_credential_calldata.toLowerCase(), p);
  }
  // ---- chain state
  mine() {
    const number = this.blocks.length;
    const included = this.pending.splice(0);
    const blockHash = ethers.id(`${this.kind}-${this.chainId}-block-${number}`);
    const ts = this.t0 + number * Math.max(1, Math.round(this.blockTimeMs / 1000));
    included.forEach((t, i) => this.execute(t, number, blockHash, i));
    this.blocks.push({ number, hash: blockHash, timestamp: ts, baseFeePerGas: this.baseFee, txs: included.map((t) => t.hash) });
    this.history.push(new Map(this.balances));
    if (this.kind === 'eravm' && number > 0 && number % 3 === 0) this.sealBatch(number);
  }
  sealBatch(lastBlock) {
    const n = this.batches.length + 1; const sealed = Date.now();
    this.batches.push({ number: n, lastBlock, sealedMs: sealed });
  }
  batchOf(block) { const b = this.batches.find((x) => x.lastBlock >= block); return b ? b.number : this.batches.length + 1; }
  balanceAt(addr, tag) {
    const a = addr.toLowerCase();
    if (tag === 'latest' || tag === 'pending' || tag === undefined) return this.balances.get(a) || 0n;
    const n = Number(BigInt(tag)); const h = this.history[Math.min(n, this.history.length - 1)];
    return (h && h.get(a)) || 0n;
  }
  gasFor(t) {
    // controlled-study reference gas where known (frozen inputs); otherwise a nominal value
    const ref = this.inputs.proofs.controlled_reference_setup;
    const pr = this.verify.get((t.data || '').toLowerCase());
    if (this.kind === 'evm') {
      if (pr) return BigInt(pr.controlled_reference.l1_gas_used);
      if (t.op && ref[t.backend] && ref[t.backend][t.op]) return BigInt(ref[t.backend][t.op].l1_gas_used);
      return 21000n + 16n * BigInt((t.data.length - 2) / 2);
    }
    const pd = (x) => BigInt(x.l2_computational_gas) + BigInt(x.l2_pubdata_bytes) * this.gasPerPubdata;
    if (pr) return pd(pr.controlled_reference);
    if (t.op && ref[t.backend] && ref[t.backend][t.op]) return pd(ref[t.backend][t.op]);
    return 200000n;
  }
  artifactsByVenue() { return this.inputs.artifacts[this.kind === 'evm' ? 'evm' : 'eravm']; }
  // what a transaction or call request means for the emulation: { create, art, ctorArgs, manager, sel }
  classify(req) {
    const data = (req.data || '0x').toLowerCase();
    if (this.kind === 'evm' && !req.to) {
      const art = Object.values(this.artifactsByVenue()).find((a) => data.startsWith(a.bytecode.toLowerCase()));
      return { create: true, art, ctorHex: art ? "0x" + data.slice(art.bytecode.length) : "0x" };
    }
    if (this.kind === 'eravm' && req.to && req.to.toLowerCase() === zu.CONTRACT_DEPLOYER_ADDRESS.toLowerCase()) {
      const [, bytecodeHash, input] = zu.CONTRACT_DEPLOYER.decodeFunctionData('create', data);
      const art = Object.values(this.artifactsByVenue()).find((a) => a.bytecode_hash.toLowerCase() === bytecodeHash.toLowerCase());
      return { create: true, art, ctorHex: input };
    }
    return { create: false, manager: req.to ? this.managers.get(req.to.toLowerCase()) : null, sel: data.slice(0, 10), data };
  }
  opOf(c) {
    if (c.create) return c.art ? { op: c.art.role === 'verifier' ? 'deploy_verifier' : 'deploy_manager', backend: c.art.backend } : { op: 'deploy_unknown', backend: '' };
    const backend = c.manager ? c.manager.backend : '';
    if (c.sel === S.setIssuer) return { op: 'set_issuer', backend };
    if (c.sel === S.addRoot) return { op: 'add_root', backend };
    return { op: 'verify_credential', backend };
  }
  // state transition of a call to a manager; returns { revert } or { ret }
  evaluate(c, from, apply) {
    const m = c.manager;
    if (!m) return { ret: '0x' };
    const sr = this.revertReasons && this.revertReasons.get(c.data);
    if (sr) return { revert: sr };
    if (c.sel === S.verifier) return { ret: coder.encode(['address'], [m.verifier]) };
    if (c.sel === S.owner) return { ret: coder.encode(['address'], [m.owner]) };
    if (c.sel === S.isIssuer) { const [a] = coder.decode(['address'], '0x' + c.data.slice(10)); return { ret: coder.encode(['bool'], [m.issuers.has(a.toLowerCase())]) }; }
    if (c.sel === S.isValidRoot) { const [r] = coder.decode(['uint256'], '0x' + c.data.slice(10)); return { ret: coder.encode(['bool'], [m.roots.has(r.toString())]) }; }
    if (c.sel === S.setIssuer) {
      if (from !== m.owner.toLowerCase()) return { revert: 'Ownable: caller is not the owner' };
      const [a, v] = coder.decode(['address', 'bool'], '0x' + c.data.slice(10));
      if (apply) { if (v) m.issuers.add(a.toLowerCase()); else m.issuers.delete(a.toLowerCase()); }
      return { ret: '0x' };
    }
    if (c.sel === S.addRoot) {
      if (!m.issuers.has(from)) return { revert: 'CredentialManager: not issuer' };
      const [r] = coder.decode(['uint256'], '0x' + c.data.slice(10));
      if (apply) m.roots.add(r.toString());
      return { ret: '0x' };
    }
    const root = BigInt('0x' + c.data.slice(-64)).toString();
    if (!m.roots.has(root)) return { revert: 'Invalid root' };
    if (!this.verify.has(c.data)) return { revert: 'Invalid proof' };
    return { ret: coder.encode(['bool'], [true]) };
  }
  execute(t, number, blockHash, index) {
    const from = t.from.toLowerCase();
    const c = this.classify(t);
    Object.assign(t, this.opOf(c));
    let status = 1; let contractAddress = null; const logs = [];
    if (c.create) {
      if (!c.art) status = 0;
      else {
        const addr = this.kind === 'evm' ? ethers.getCreateAddress({ from: t.from, nonce: t.nonce })
          : zu.createAddress(t.from, this.deployNonces.get(from) || 0);
        if (this.kind === 'eravm') this.deployNonces.set(from, (this.deployNonces.get(from) || 0) + 1);
        let code = this.kind === 'evm' ? c.art.deployedBytecode : c.art.bytecode;
        if (this.scenario.wrongCode === t.sendIndex) code = code.slice(0, -2) + (code.endsWith('00') ? '01' : '00');
        this.code.set(addr.toLowerCase(), code);
        if (c.art.role === 'manager') {
          const [verifier] = coder.decode(['address'], c.ctorHex);
          this.managers.set(addr.toLowerCase(), { backend: c.art.backend, verifier, owner: ethers.getAddress(t.from), issuers: new Set(), roots: new Set() });
        }
        contractAddress = addr;
        if (this.kind === 'eravm') logs.push({ address: zu.CONTRACT_DEPLOYER_ADDRESS, topics: [DEPLOYED_TOPIC, ethers.zeroPadValue(t.from, 32), c.art.bytecode_hash, ethers.zeroPadValue(addr, 32)], data: '0x' });
      }
    } else {
      const res = this.evaluate(c, from, true);
      if (res.revert) { status = 0; t.revert = res.revert; }
    }
    if (this.scenario.revertSend === t.sendIndex) { status = 0; t.revert = 'Invalid proof'; this.revertReasons = this.revertReasons || new Map(); this.revertReasons.set(c.data || '', 'Invalid proof'); }
    const gasUsed = this.gasFor(t);
    const egp = this.kind === 'evm' ? (t.maxFeePerGas < this.baseFee + t.maxPriorityFeePerGas ? t.maxFeePerGas : this.baseFee + t.maxPriorityFeePerGas) : this.baseFee;
    const fee = gasUsed * egp;
    this.balances.set(from, (this.balances.get(from) || 0n) - fee);
    this.nonces.set(from, (this.nonces.get(from) || 0) + 1);
    t.fee = fee; t.block = number;
    const rc = { transactionHash: t.hash, blockNumber: hex(number), blockHash, transactionIndex: hex(index), from: ethers.getAddress(t.from), to: t.to, status: hex(status),
      gasUsed: hex(gasUsed), cumulativeGasUsed: hex(gasUsed), effectiveGasPrice: hex(egp), contractAddress: status ? contractAddress : null, logs, type: hex(this.kind === 'evm' ? 2 : 113) };
    if (this.kind === 'eravm') { rc.l1BatchNumber = hex(this.batches.length + 1); rc.l1BatchTxIndex = hex(index); }
    this.receipts.set(t.hash, rc);
  }
  // ---- transactions
  decodeRaw(raw) {
    if (this.kind === 'evm') {
      const tx = ethers.Transaction.from(raw);
      return { hash: tx.hash, from: tx.from, nonce: tx.nonce, to: tx.to, data: tx.data, gasLimit: tx.gasLimit, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas, chainId: tx.chainId, type: tx.type };
    }
    const tx = zu.parseEip712(raw);
    // the node checks the EIP-712 signature: recover the signer and compare with `from`
    const digest = require('zksync-ethers').EIP712Signer.getSignedDigest(tx);
    const rec = ethers.recoverAddress(digest, tx.customData.customSignature);
    if (rec.toLowerCase() !== tx.from.toLowerCase()) throw { code: -32000, message: 'mock: invalid EIP-712 signature' };
    return { hash: tx.hash, from: tx.from, nonce: tx.nonce, to: tx.to, data: tx.data, gasLimit: tx.gasLimit, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      chainId: tx.chainId, type: 113, factoryDeps: tx.customData.factoryDeps || [], gasPerPubdata: tx.customData.gasPerPubdata };
  }
  pendingCount(a) { return this.pending.filter((t) => t.from.toLowerCase() === a).length + [...this.txs.values()].filter((t) => t.stuck && t.from.toLowerCase() === a).length; }
  send(raw) {
    this.sends++; const idx = this.sends; const sc = this.scenario;
    if (sc.sendJsonRpcError === idx) throw { code: -32000, message: 'mock: internal error (injected)' };
    if (sc.insufficientOnSend === idx) throw { code: -32000, message: 'insufficient funds for gas * price + value (injected)' };
    const t = this.decodeRaw(raw);
    if (BigInt(t.chainId) !== BigInt(this.chainId)) throw { code: -32000, message: 'invalid chain id' };
    const a = t.from.toLowerCase();
    const expected = (this.nonces.get(a) || 0) + this.pendingCount(a);
    if (t.nonce !== expected) throw { code: -32000, message: t.nonce < expected ? 'nonce too low' : 'nonce too high' };
    if (t.gasLimit * t.maxFeePerGas > (this.balances.get(a) || 0n)) throw { code: -32000, message: 'insufficient funds for gas * price + value' };
    Object.assign(t, { sendIndex: idx, receivedAt: new Date().toISOString() });
    this.txs.set(t.hash, t);
    if (sc.noReceipt === idx) t.stuck = true; else this.pending.push(t);
    if (sc.sendHttpErrorKnown === idx) throw { http: 502 };
    return t.hash;
  }
  // ---- JSON-RPC
  async handle(method, p) {
    const sc = this.scenario;
    const blk = (tag) => (tag === 'latest' || tag === 'pending' || tag === undefined ? this.blocks[this.blocks.length - 1] : this.blocks[Number(BigInt(tag))]);
    switch (method) {
      case 'eth_chainId': return hex(sc.chainIdOverride || this.chainId);
      case 'web3_clientVersion': return `chainbench-mock/${this.kind}`;
      case 'eth_blockNumber': return hex(this.blocks.length - 1);
      case 'eth_getBlockByNumber': { const b = blk(p[0]); if (!b) return null; return { number: hex(b.number), hash: b.hash, timestamp: hex(b.timestamp), baseFeePerGas: hex(b.baseFeePerGas), gasLimit: hex(60000000), transactions: b.txs }; }
      case 'eth_gasPrice': return hex(this.baseFee);
      case 'eth_maxPriorityFeePerGas': return hex(1000000000);
      case 'eth_feeHistory': return { oldestBlock: hex(Math.max(0, this.blocks.length - 5)), baseFeePerGas: Array(6).fill(hex(this.baseFee)), gasUsedRatio: Array(5).fill(0.5), reward: Array(5).fill([hex(1e9), hex(1e9), hex(2e9)]) };
      case 'eth_getBalance': {
        if ((p[1] === 'latest' || p[1] === undefined) && sc.lowBalanceAfterSends && this.sends >= sc.lowBalanceAfterSends) return hex(1);
        return hex(this.balanceAt(p[0], p[1]));
      }
      case 'eth_getTransactionCount': { const a = p[0].toLowerCase(); return hex((this.nonces.get(a) || 0) + (p[1] === 'pending' ? this.pendingCount(a) : 0)); }
      case 'eth_sendRawTransaction': return this.send(p[0]);
      case 'eth_getTransactionByHash': { const t = this.txs.get(p[0]); return t ? { hash: t.hash, from: t.from, nonce: hex(t.nonce), to: t.to, blockNumber: t.block === undefined ? null : hex(t.block) } : null; }
      case 'eth_getTransactionReceipt': {
        const t = this.txs.get(p[0]);
        if (t && sc.pollErrors && sc.pollErrors.send === t.sendIndex) { const n = (this.polls.get(p[0]) || 0) + 1; this.polls.set(p[0], n); if (n <= sc.pollErrors.n) throw { code: -32603, message: 'mock: receipt lookup failed (injected)' }; }
        return this.receipts.get(p[0]) || null;
      }
      case 'eth_getCode': return this.code.get(p[0].toLowerCase()) || '0x';
      case 'eth_call': {
        const c = this.classify(p[0]);
        const res = this.evaluate(c, (p[0].from || '').toLowerCase(), false);
        if (res.revert) throw { code: 3, message: `execution reverted: ${res.revert}`, data: errData(res.revert) };
        return res.ret;
      }
      case 'zks_getProtocolVersion': return { version_id: 29, minorVersion: 29, timestamp: 1757332047, base_system_contracts: { bootloader: '0x0100mock', default_aa: '0x0100mock' }, l2_system_upgrade_tx_hash: null };
      case 'zks_getFeeParams': return { V2: { config: { minimal_l2_gas_price: 25000000, compute_overhead_part: 0.0, pubdata_overhead_part: 1.0, batch_overhead_l1_gas: 800000, max_gas_per_batch: 200000000, max_pubdata_per_batch: 700000 }, l1_gas_price: 1500000000, l1_pubdata_price: 120000000, conversion_ratio: { numerator: 1, denominator: 1 } } };
      case 'zks_L1BatchNumber': return hex(this.batches.length);
      case 'zks_getL1BatchDetails': return this.batchDetails(Number(p[0]));
      case 'zks_getBlockDetails': { const b = blk(hex(p[0])); if (!b) return null; return { number: b.number, l1BatchNumber: this.batchOf(b.number), timestamp: b.timestamp, l1TxCount: 0, l2TxCount: b.txs.length, status: 'sealed', protocolVersion: 'Version29' }; }
      case 'zks_estimateFee': {
        this.estimates++;
        if (sc.estimateError === this.estimates) throw { code: -32000, message: 'mock: fee estimation failed (injected)' };
        const c = this.classify(p[0]); const g = this.gasFor({ data: p[0].data, ...this.opOf(c) });
        return { gas_limit: hex((g * 13n) / 10n), max_fee_per_gas: hex(this.baseFee), max_priority_fee_per_gas: '0x0', gas_per_pubdata_limit: hex(50000) };
      }
      case 'zks_getTransactionDetails': {
        const t = this.txs.get(p[0]); if (!t) return null;
        const rc = this.receipts.get(p[0]);
        return { isL1Originated: false, status: rc ? 'included' : 'pending', fee: rc ? hex(t.fee) : '0x0', gasPerPubdata: hex(this.gasPerPubdata), initiatorAddress: t.from, receivedAt: t.receivedAt, ethCommitTxHash: null, ethProveTxHash: null, ethExecuteTxHash: null };
      }
      default: throw { code: -32601, message: `mock: method ${method} not supported` };
    }
  }
  batchDetails(n) {
    const b = this.batches.find((x) => x.number === n); if (!b) return null;
    const at = (d) => (Date.now() >= b.sealedMs + d ? new Date(b.sealedMs + d).toISOString() : null);
    const c = at(2000); const pr = at(4000); const ex = at(6000);
    const h = (s) => (s ? ethers.id(`${s}-${n}`) : null);
    return { number: n, timestamp: Math.floor(b.sealedMs / 1000), l1TxCount: 0, l2TxCount: 0, status: ex ? 'verified' : 'sealed', commitTxHash: h(c && 'commit'), committedAt: c, commitChainId: 11155111,
      proveTxHash: h(pr && 'prove'), provenAt: pr, proveChainId: 11155111, executeTxHash: h(ex && 'execute'), executedAt: ex, executeChainId: 11155111,
      l1GasPrice: 1500000000, l2FairGasPrice: 25000000, fairPubdataPrice: 2000000000 };
  }
  start() {
    this.server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        let j; try { j = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end('bad json'); }
        try { const result = await this.handle(j.method, j.params || []); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result })); }
        catch (e) {
          if (e && e.http) { res.writeHead(e.http); return res.end('bad gateway (injected)'); }
          const err = e && e.code !== undefined ? e : { code: -32603, message: String(e && e.message ? e.message : e) };
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, error: err }));
        }
      });
    });
    this.timer = setInterval(() => this.mine(), this.blockTimeMs);
    return new Promise((r) => this.server.listen(this.port, '127.0.0.1', () => { this.port = this.server.address().port; r(`http://127.0.0.1:${this.port}`); }));
  }
  stop() { clearInterval(this.timer); return new Promise((r) => this.server.close(r)); }
}
module.exports = { Mock };
