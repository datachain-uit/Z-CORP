const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { merkleTreeDepthFile, resolveMerkleTreeFile } = require("../setup/paths");

function parseArgs() {
    const args = process.argv.slice(2);
    let depth = 11;
    let merkleFile = null;
    let verifierAddress = process.env.VERIFIER_ADDRESS || null;
    let issuerAddress = null;
    let skipRoot = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--depth" && args[i + 1]) {
            depth = parseInt(args[++i], 10);
        } else if (arg === "--merkle" && args[i + 1]) {
            merkleFile = path.resolve(args[++i]);
        } else if (arg === "--verifier" && args[i + 1]) {
            verifierAddress = args[++i];
        } else if (arg === "--issuer" && args[i + 1]) {
            issuerAddress = args[++i];
        } else if (arg === "--no-root") {
            skipRoot = true;
        } else if (/^\d+$/.test(arg)) {
            depth = parseInt(arg, 10);
        }
    }

    if (!merkleFile) {
        merkleFile = resolveMerkleTreeFile(depth);
    }

    if (Number.isNaN(depth)) {
        throw new Error("Depth must be an integer, e.g. 11");
    }

    return { depth, merkleFile, verifierAddress, issuerAddress, skipRoot };
}

async function deployContract(hre, contractName, constructorArgs = []) {
    if (hre.network.zksync) {
        const contract = await hre.deployer.deploy(contractName, constructorArgs);
        await contract.waitForDeployment();
        return contract;
    }

    const Factory = await hre.ethers.getContractFactory(contractName);
    const contract = await Factory.deploy(...constructorArgs);
    await contract.waitForDeployment();
    return contract;
}

async function main() {
    const { depth, merkleFile, verifierAddress, issuerAddress, skipRoot } = parseArgs();
    const [deployer] = await hre.ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    const issuer = issuerAddress || deployerAddress;

    console.log(`=== Deploy CredentialManager (depth ${depth}) ===`);
    console.log("Deployer:", deployerAddress);

    let verifierAddr = verifierAddress;
    if (!verifierAddr) {
        const verifierName = `Groth16LegacyVerifierDepth${depth}`;
        const verifier = await deployContract(hre, verifierName);
        verifierAddr = await verifier.getAddress();
        console.log(`${verifierName} deployed to:`, verifierAddr);
    } else {
        console.log("Using existing verifier:", verifierAddr);
    }

    const manager = await deployContract(hre, "CredentialManager", [verifierAddr]);
    const managerAddress = await manager.getAddress();
    console.log("CredentialManager deployed to:", managerAddress);

    const setIssuerTx = await manager.setIssuer(issuer, true);
    await setIssuerTx.wait();
    console.log("Issuer enabled:", issuer);

    if (!skipRoot) {
        if (!fs.existsSync(merkleFile)) {
            throw new Error(
                `Merkle tree file not found: ${merkleFile}\n` +
                    "Run: node scripts/merkletree/prep_full_merkle_all_depths.js " + depth
            );
        }

        const merkleData = JSON.parse(fs.readFileSync(merkleFile, "utf8"));
        const root = merkleData.root;

        if (issuer.toLowerCase() !== deployerAddress.toLowerCase()) {
            console.log("Issuer is not the deployer — call addRoot() from the issuer account:");
            console.log(`  root: ${root}`);
        } else {
            const tx = await manager.addRoot(root);
            await tx.wait();
            console.log("Added root:", root);
        }
    }

    console.log("\nDeployment completed successfully!");
    console.log("Verifier:          ", verifierAddr);
    console.log("CredentialManager: ", managerAddress);
    console.log("Issuer:            ", issuer);
    console.log("\nExample:");
    console.log(
        `CREDENTIAL_MANAGER_ADDRESS=${managerAddress} npx hardhat run scripts/blockchain/deploy_credential_manager.js --network dockerHardhat`
    );
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
