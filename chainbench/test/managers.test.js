'use strict';
// Unit tests (CHAIN-PROTOCOL-v1 §12.1): CredentialManagerGroth16 / CredentialManagerPlonk, profile `primary`.
// Uses frozen PS-01 proofs: depth 5 (p0, p1) and partner depth 10 (p0).
const assert = require('assert');
const { ethers } = require('hardhat');
const PS = require('../lib/proofset');

// The EDR network uses throwOnTransactionFailures: false (as in the runs), so a reverting transaction is mined
// with status 0. A revert is asserted twice: the reason via eth_call, and status 0 of the mined transaction.
async function expectRevert(fn, args, re) {
  await assert.rejects(fn.staticCall(...args), re);
  const tx = await fn(...args, { gasLimit: 3000000 });
  await assert.rejects(tx.wait(), /revert|CALL_EXCEPTION/i);
}

const CASES = [
  { backend: 'groth16', manager: 'CredentialManagerGroth16', verifier: 'Groth16LegacyVerifierDepth5' },
  { backend: 'plonk', manager: 'CredentialManagerPlonk', verifier: 'PlonkVerifierDepth5' },
];

describe('CHAIN-PROTOCOL-v1 §12.1 manager unit tests', function () {
  let ps;
  before(async () => { ps = await PS.load(); });
  for (const t of CASES) {
    describe(t.manager, function () {
      let owner, other, verifier, manager, p0, p1, partner;
      beforeEach(async () => {
        [owner, other] = await ethers.getSigners();
        verifier = await (await ethers.getContractFactory(t.verifier)).deploy();
        manager = await (await ethers.getContractFactory(t.manager)).deploy(await verifier.getAddress());
        p0 = await ps.get(t.backend, 5, 0); p1 = await ps.get(t.backend, 5, 1); partner = await ps.get(t.backend, 10, 0);
        await (await manager.setIssuer(owner.address, true)).wait();
        await (await manager.addRoot(p0.root)).wait();
      });
      it('accepts a valid proof (returns true, emits CredentialVerified)', async () => {
        assert.strictEqual(await manager.verifyCredential.staticCall(...p0.args), true);
        const rc = await (await manager.verifyCredential(...p1.args)).wait();
        const ev = rc.logs.map((l) => { try { return manager.interface.parseLog(l); } catch (e) { return null; } }).find((e) => e && e.name === 'CredentialVerified');
        assert.ok(ev && ev.args[0] === p1.root);
      });
      it('rejects a tampered proof (verifier false, manager reverts "Invalid proof")', async () => {
        const tam = PS.tamper(t.backend, p0.args);
        assert.strictEqual(await verifier.verifyProof(...tam), false);
        await expectRevert(manager.verifyCredential, tam, /Invalid proof/);
      });
      it('rejects an unknown root ("Invalid root")', async () => {
        await expectRevert(manager.verifyCredential, partner.args, /Invalid root/);
      });
      it('rejects root publication by a non-issuer', async () => {
        await expectRevert(manager.connect(other).addRoot, [partner.root], /CredentialManager: not issuer/);
      });
      it('rejects a cross-depth proof even when its root is registered', async () => {
        await (await manager.addRoot(partner.root)).wait();
        assert.strictEqual(await verifier.verifyProof(...partner.args), false);
        await expectRevert(manager.verifyCredential, partner.args, /Invalid proof/);
      });
      it('keeps owner-only and zero-address guards', async () => {
        await expectRevert(manager.connect(other).setIssuer, [other.address, true], /Ownable: caller is not the owner/);
        await expectRevert(manager.connect(other).setVerifier, [other.address], /Ownable: caller is not the owner/);
        await expectRevert(manager.setIssuer, [ethers.ZeroAddress, true], /CredentialManager: zero address/);
        await expectRevert(manager.setVerifier, [ethers.ZeroAddress], /CredentialManager: zero address/);
        await (await manager.setIssuer(owner.address, false)).wait();
        await expectRevert(manager.addRoot, [1n], /CredentialManager: not issuer/);
        assert.strictEqual(await manager.verifier(), await verifier.getAddress());
      });
    });
  }
});
