const hre = require("hardhat");

async function main() {
    // Get contract instances
    const verifier = await hre.ethers.getContractAt("Groth16Verifier", "0x5FbDB2315678afecb367f032d93F642f64180aa3");
    const manager = await hre.ethers.getContractAt("DiplomaManager", "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");

    // Load proof and public signals
    const proof = require("../proof.json");
    const publicSignals = require("../public.json");

    // Format proof for contract
    const proofForContract = [
        [proof.pi_a[0], proof.pi_a[1]],
        [
            [proof.pi_b[0][1], proof.pi_b[0][0]],
            [proof.pi_b[1][1], proof.pi_b[1][0]]
        ],
        [proof.pi_c[0], proof.pi_c[1]]
    ];

    console.log("\n=== Starting Diploma Verification ===");
    console.log("Root to verify:", publicSignals[0]);
    
    // Verify proof using DiplomaManager
    console.log("\nVerifying proof...");
    const isValid = await manager.verifyDiploma(
        proofForContract[0],
        proofForContract[1],
        proofForContract[2],
        [publicSignals[0]]
    );
    
    if (isValid) {
        console.log("\n✅ Verification SUCCESSFUL!");
        console.log("The diploma is valid and verified on the blockchain.");
    } else {
        console.log("\n❌ Verification FAILED!");
        console.log("The diploma could not be verified.");
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}); 