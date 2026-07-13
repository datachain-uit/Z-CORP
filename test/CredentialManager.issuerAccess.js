const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CredentialManager issuer access", function () {
  const SAMPLE_ROOT = 12345n;

  async function deployManager() {
    const [owner, account2] = await ethers.getSigners();

    // Verifier is unused in these tests (addRoot does not call verifyProof).
    const dummyVerifier = ethers.ZeroAddress;

    const CredentialManager = await ethers.getContractFactory("CredentialManager");
    const manager = await CredentialManager.deploy(dummyVerifier);
    await manager.waitForDeployment();

    return { manager, owner, account2 };
  }

  it("reverts addRoot when caller is not an issuer", async function () {
    const { manager, account2 } = await deployManager();

    expect(await manager.isIssuer(account2.address)).to.equal(false);

    await expect(manager.connect(account2).addRoot(SAMPLE_ROOT)).to.be.revertedWith(
      "CredentialManager: not issuer"
    );
  });

  it("reverts addRoot for owner until setIssuer grants issuer role", async function () {
    const { manager, owner } = await deployManager();

    expect(await manager.isIssuer(owner.address)).to.equal(false);

    await expect(manager.connect(owner).addRoot(SAMPLE_ROOT)).to.be.revertedWith(
      "CredentialManager: not issuer"
    );
  });

  it("allows addRoot after setIssuer for that account", async function () {
    const { manager, owner, account2 } = await deployManager();

    await manager.connect(owner).setIssuer(account2.address, true);
    expect(await manager.isIssuer(account2.address)).to.equal(true);

    await expect(manager.connect(account2).addRoot(SAMPLE_ROOT)).to.not.be.reverted;
    expect(await manager.isValidRoot(SAMPLE_ROOT)).to.equal(true);
  });

  it("still reverts for a non-issuer after another account was set as issuer", async function () {
    const { manager, owner, account2 } = await deployManager();
    const [, , account3] = await ethers.getSigners();

    await manager.connect(owner).setIssuer(account2.address, true);

    await expect(manager.connect(account3).addRoot(SAMPLE_ROOT)).to.be.revertedWith(
      "CredentialManager: not issuer"
    );
  });
});
