const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { projectRoot, resolveMerkleTreeFile } = require("../setup/paths");

const DEPLOY_RESULTS_DIR = path.join(projectRoot, "results", "blockchain", "deploy");

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

function formatTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return (
        `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
        `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
}

function pickGasPrice(receipt, tx) {
    if (receipt.gasPrice != null) return BigInt(receipt.gasPrice);
    if (receipt.effectiveGasPrice != null) return BigInt(receipt.effectiveGasPrice);
    if (tx?.gasPrice != null) return BigInt(tx.gasPrice);
    return 0n;
}

function summarizeReceipt(step, receipt, tx) {
    const gasUsed = BigInt(receipt.gasUsed);
    const gasPrice = pickGasPrice(receipt, tx);
    const feeWei = gasUsed * gasPrice;

    return {
        step,
        txHash: receipt.hash || receipt.transactionHash || tx?.hash || "",
        status: receipt.status === 1 || receipt.status === true ? "success" : "fail",
        gasUsed: gasUsed.toString(),
        gasPriceWei: gasPrice.toString(),
        gasPriceGwei: ethers.formatUnits(gasPrice, "gwei"),
        feeWei: feeWei.toString(),
        feeEth: ethers.formatEther(feeWei),
    };
}

function printGasRow(row) {
    console.log(
        `  ${row.step}: gasUsed=${row.gasUsed}, gasPrice=${Number(row.gasPriceGwei).toFixed(6)} gwei, fee=${row.feeEth} ETH`
    );
}

function writeDeployCsv(filePath, rows, meta) {
    const header = [
        "network",
        "depth",
        "step",
        "txHash",
        "status",
        "gasUsed",
        "gasPriceWei",
        "gasPriceGwei",
        "feeWei",
        "feeEth",
        "verifier",
        "credentialManager",
    ];
    const lines = [header.join(",")];

    for (const row of rows) {
        lines.push(
            [
                meta.network,
                meta.depth,
                `"${row.step}"`,
                row.txHash,
                row.status,
                row.gasUsed,
                row.gasPriceWei,
                row.gasPriceGwei,
                row.feeWei,
                row.feeEth,
                meta.verifier,
                meta.manager,
            ].join(",")
        );
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function deployContract(hre, contractName, constructorArgs = []) {
    if (hre.network.zksync) {
        const contract = await hre.deployer.deploy(contractName, constructorArgs);
        await contract.waitForDeployment();
        const tx = contract.deploymentTransaction();
        const receipt = tx ? await tx.wait() : null;
        return { contract, tx, receipt };
    }

    const Factory = await hre.ethers.getContractFactory(contractName);
    const contract = await Factory.deploy(...constructorArgs);
    await contract.waitForDeployment();
    const tx = contract.deploymentTransaction();
    const receipt = tx ? await tx.wait() : null;
    return { contract, tx, receipt };
}

async function sendAndWait(txPromise) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    return { tx, receipt };
}

async function main() {
    const { depth, merkleFile, verifierAddress, issuerAddress, skipRoot } = parseArgs();
    const [deployer] = await hre.ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    const issuer = issuerAddress || deployerAddress;
    const network = hre.network.name;
    const gasRows = [];

    console.log(`=== Deploy CredentialManager (depth ${depth}) ===`);
    console.log("Network:", network);
    console.log("Deployer:", deployerAddress);

    let verifierAddr = verifierAddress;
    if (!verifierAddr) {
        const verifierName = `Groth16LegacyVerifierDepth${depth}`;
        const { contract: verifier, tx, receipt } = await deployContract(hre, verifierName);
        verifierAddr = await verifier.getAddress();
        console.log(`${verifierName} deployed to:`, verifierAddr);

        if (receipt) {
            const row = summarizeReceipt("deploy Verifier", receipt, tx);
            gasRows.push(row);
            printGasRow(row);
        }
    } else {
        console.log("Using existing verifier:", verifierAddr);
    }

    const { contract: manager, tx: managerTx, receipt: managerReceipt } = await deployContract(
        hre,
        "CredentialManager",
        [verifierAddr]
    );
    const managerAddress = await manager.getAddress();
    console.log("CredentialManager deployed to:", managerAddress);

    if (managerReceipt) {
        const row = summarizeReceipt("deploy CredentialManager", managerReceipt, managerTx);
        gasRows.push(row);
        printGasRow(row);
    }

    const { tx: setIssuerTx, receipt: setIssuerReceipt } = await sendAndWait(
        manager.setIssuer(issuer, true)
    );
    console.log("Issuer enabled:", issuer);
    {
        const row = summarizeReceipt("setIssuer", setIssuerReceipt, setIssuerTx);
        gasRows.push(row);
        printGasRow(row);
    }

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
            const { tx: addRootTx, receipt: addRootReceipt } = await sendAndWait(
                manager.addRoot(root)
            );
            console.log("Added root:", root);
            const row = summarizeReceipt("addRoot", addRootReceipt, addRootTx);
            gasRows.push(row);
            printGasRow(row);
        }
    }

    const csvPath = path.join(
        DEPLOY_RESULTS_DIR,
        `${formatTimestamp()}-deploy-${network}.csv`
    );
    writeDeployCsv(csvPath, gasRows, {
        network,
        depth,
        verifier: verifierAddr,
        manager: managerAddress,
    });

    console.log("\nDeployment completed successfully!");
    console.log("Verifier:          ", verifierAddr);
    console.log("CredentialManager: ", managerAddress);
    console.log("Issuer:            ", issuer);
    console.log("Gas CSV:           ", csvPath);
    console.log("\nExample:");
    console.log(
        `npx hardhat credential-verification --network ${network} ` +
            `--manager ${managerAddress} --depth ${depth} --index 0 --iterations 50`
    );
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
