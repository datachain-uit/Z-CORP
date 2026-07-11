const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const snarkjs = require("snarkjs");
const {
    projectRoot,
    merkleTreeDepthFile,
    resolveMerkleTreeFile,
    proofDepthFile,
    publicDepthFile,
} = require("../setup/paths");

const DEFAULT_ITERATIONS = 50;
const RESULTS_DIR = path.join(projectRoot, "results", "blockchain");

function parseArgs() {
    const args = process.argv.slice(2);
    let managerAddress =
        process.env.CREDENTIAL_MANAGER_ADDRESS ||
        process.env.MANAGER_ADDRESS ||
        null;
    let depth = parseInt(process.env.VERIFICATION_DEPTH || process.env.DEPTH || "11", 10);
    let index = parseInt(process.env.VERIFICATION_INDEX || process.env.INDEX || "0", 10);
    let iterations = parseInt(
        process.env.VERIFICATION_ITERATIONS || process.env.ITERATIONS || String(DEFAULT_ITERATIONS),
        10
    );
    let proofFile = process.env.VERIFICATION_PROOF_FILE
        ? path.resolve(process.env.VERIFICATION_PROOF_FILE)
        : null;
    let publicFile = process.env.VERIFICATION_PUBLIC_FILE
        ? path.resolve(process.env.VERIFICATION_PUBLIC_FILE)
        : null;
    let merkleFile = process.env.VERIFICATION_MERKLE_FILE
        ? path.resolve(process.env.VERIFICATION_MERKLE_FILE)
        : null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--manager" && args[i + 1]) {
            managerAddress = args[++i];
        } else if (arg === "--depth" && args[i + 1]) {
            depth = parseInt(args[++i], 10);
        } else if (arg === "--index" && args[i + 1]) {
            index = parseInt(args[++i], 10);
        } else if ((arg === "--iterations" || arg === "-n") && args[i + 1]) {
            iterations = parseInt(args[++i], 10);
        } else if (arg === "--proof" && args[i + 1]) {
            proofFile = path.resolve(args[++i]);
        } else if (arg === "--public" && args[i + 1]) {
            publicFile = path.resolve(args[++i]);
        } else if (arg === "--merkle" && args[i + 1]) {
            merkleFile = path.resolve(args[++i]);
        } else if (arg.startsWith("0x")) {
            managerAddress = arg;
        }
    }

    if (!managerAddress) {
        throw new Error(
            "CredentialManager address required.\n\n" +
                "Hardhat task (recommended):\n" +
                "  npx hardhat credential-verification --network dockerHardhat \\\n" +
                "    --manager 0x... --depth 11 --iterations 50\n\n" +
                "Or environment variables:\n" +
                "  CREDENTIAL_MANAGER_ADDRESS=0x... VERIFICATION_DEPTH=11 VERIFICATION_ITERATIONS=50 \\\n" +
                "  npx hardhat run scripts/blockchain/verification.js --network dockerHardhat"
        );
    }

    if (Number.isNaN(depth) || Number.isNaN(index) || Number.isNaN(iterations) || iterations < 1) {
        throw new Error("depth, index, and iterations must be valid positive integers.");
    }

    merkleFile = merkleFile || resolveMerkleTreeFile(depth);
    proofFile = proofFile || proofDepthFile(depth, index);
    publicFile = publicFile || publicDepthFile(depth, index);

    return {
        managerAddress,
        depth,
        index,
        iterations,
        merkleFile,
        proofFile,
        publicFile,
    };
}

function formatTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return (
        `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
        `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
}

function buildResultsPath(depth, iterations, network) {
    const timestamp = formatTimestamp();
    const filename = `${timestamp}-${depth}-${iterations}-${network}.csv`;
    return path.join(RESULTS_DIR, filename);
}

function csvEscape(value) {
    const text = String(value);
    if (text.includes(",") || text.includes('"') || text.includes("\n")) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function writeCsv(filePath, rows) {
    const header = ["iteration", "gas", "gasPrice", "latency_ms", "status", "error"];
    const lines = [header.join(",")];

    for (const row of rows) {
        lines.push(
            [
                row.iteration,
                row.gas,
                row.gasPrice,
                row.latencyMs,
                row.status,
                row.error || "",
            ]
                .map(csvEscape)
                .join(",")
        );
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function getCredentialManager(hre, managerAddress) {
    if (!hre.network.zksync) {
        return hre.ethers.getContractAt("CredentialManager", managerAddress);
    }

    const { Contract } = require("zksync-ethers");
    const artifact = await hre.deployer.loadArtifact("CredentialManager");
    const zkWallet = await hre.deployer.getWallet();
    return new Contract(managerAddress, artifact.abi, zkWallet);
}

async function assertManagerCallable(hre, manager, managerAddress) {
    try {
        await manager.owner.staticCall();
    } catch (error) {
        const isEmptyResponse =
            error.code === "BAD_DATA" ||
            error.value === "0x" ||
            /could not decode result data/i.test(error.shortMessage || error.message || "");

        if (!isEmptyResponse) {
            throw error;
        }

        throw new Error(
            `CredentialManager at ${managerAddress} is not readable on ${hre.network.name}.\n` +
                (hre.network.zksync
                    ? "On zkSync, deploy with hre.deployer.deploy() (scripts/blockchain/deploy_credential_manager.js). " +
                      "hre.ethers.getContractFactory().deploy() creates addresses that accept transactions but do not execute contract code.\n"
                    : "") +
                "Use the manager address from the same network where you deployed (dockerHardhat vs zkSyncSepolia vs sepolia)."
        );
    }
}

async function proofToCalldata(proof, publicSignals) {
    const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const argv = calldata
        .replace(/["[\]\s]/g, "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

    return {
        a: [argv[0], argv[1]],
        b: [
            [argv[2], argv[3]],
            [argv[4], argv[5]],
        ],
        c: [argv[6], argv[7]],
        input: [argv[8]],
    };
}

async function runVerification(manager, calldata, iterations) {
    const rows = [];

    for (let i = 0; i < iterations; i++) {
        const iteration = i + 1;
        const startedAt = performance.now();
        let row = {
            iteration,
            gas: "",
            gasPrice: "",
            latencyMs: "",
            status: "fail",
            error: "",
        };

        try {
            const tx = await manager.verifyCredential(
                calldata.a,
                calldata.b,
                calldata.c,
                calldata.input
            );
            const receipt = await tx.wait();
            const latencyMs = (performance.now() - startedAt).toFixed(2);

            row.gas = receipt.gasUsed.toString();
            row.gasPrice = (
                receipt.gasPrice ??
                receipt.effectiveGasPrice ??
                tx.gasPrice ??
                0n
            ).toString();
            row.latencyMs = latencyMs;
            row.status = receipt.status === 1 ? "success" : "fail";
            if (receipt.status !== 1) {
                row.error = "transaction reverted";
            }
        } catch (error) {
            row.latencyMs = (performance.now() - startedAt).toFixed(2);
            row.error = error.shortMessage || error.message || String(error);
        }

        rows.push(row);

        if (iteration % 10 === 0 || iteration === iterations) {
            console.log(`  completed ${iteration}/${iterations}`);
        }
    }

    return rows;
}

async function main() {
    const startedAt = new Date();
    const {
        managerAddress,
        depth,
        index,
        iterations,
        merkleFile,
        proofFile,
        publicFile,
    } = parseArgs();

    const network = hre.network.name;
    const resultsPath = buildResultsPath(depth, iterations, network);

    console.log(`=== Credential verification (${iterations} iterations) ===`);
    console.log("Network:", network);
    console.log("CredentialManager:", managerAddress);
    console.log("Depth:", depth, "| Index:", index);
    console.log("Merkle file:", merkleFile);
    console.log("Proof file:", proofFile);
    console.log("Public file:", publicFile);
    console.log("Results file:", resultsPath);

    if (!fs.existsSync(merkleFile)) {
        throw new Error(`Merkle tree file not found: ${merkleFile}`);
    }
    if (!fs.existsSync(proofFile)) {
        throw new Error(`Proof file not found: ${proofFile}`);
    }
    if (!fs.existsSync(publicFile)) {
        throw new Error(`Public signals file not found: ${publicFile}`);
    }

    const merkleData = JSON.parse(fs.readFileSync(merkleFile, "utf8"));
    const root = BigInt(merkleData.root);
    const proof = JSON.parse(fs.readFileSync(proofFile, "utf8"));
    const publicSignals = JSON.parse(fs.readFileSync(publicFile, "utf8"));
    const calldata = await proofToCalldata(proof, publicSignals);

    if (BigInt(calldata.input[0]) !== root) {
        throw new Error("Public root does not match Merkle tree root.");
    }

    const manager = await getCredentialManager(hre, managerAddress);
    await assertManagerCallable(hre, manager, managerAddress);

    const isValidRoot = await manager.isValidRoot.staticCall(root);
    if (!isValidRoot) {
        throw new Error("Root is not registered on CredentialManager. Run addRoot first.");
    }

    const rows = await runVerification(manager, calldata, iterations);
    writeCsv(resultsPath, rows);

    const successCount = rows.filter((row) => row.status === "success").length;
    const failCount = rows.length - successCount;

    console.log("\nVerification finished.");
    console.log("Success:", successCount);
    console.log("Fail:", failCount);
    console.log("CSV saved:", resultsPath);
    console.log("Started at:", startedAt.toISOString());

    return failCount > 0 ? 1 : 0;
}

module.exports = { main, getCredentialManager };

if (require.main === module) {
    main()
        .then((exitCode) => {
            process.exit(exitCode ?? 0);
        })
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}
