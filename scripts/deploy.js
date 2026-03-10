const hre = require("hardhat");

async function main() {
    // Deploy DiplomaVerifier
    const DiplomaVerifier = await hre.ethers.getContractFactory("Groth16Verifier");
    const verifier = await DiplomaVerifier.deploy();
    await verifier.waitForDeployment();
    console.log("DiplomaVerifier deployed to:", await verifier.getAddress());

    // Deploy DiplomaManager
    const DiplomaManager = await hre.ethers.getContractFactory("DiplomaManager");
    const manager = await DiplomaManager.deploy(await verifier.getAddress());
    await manager.waitForDeployment();
    console.log("DiplomaManager deployed to:", await manager.getAddress());

    // Add root from public.json
    const publicSignals = require("../public.json");
    const tx = await manager.addRoot(publicSignals[0]);
    await tx.wait();
    console.log("Added root:", publicSignals[0]);

    console.log("\nDeployment completed successfully!");
    console.log("Now you can run the test script to verify proofs:");
    console.log("npx hardhat run scripts/test.js --network localhost");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 