const hre = require("hardhat");

async function main() {
    console.log("=== Testing on ZkSync Sepolia Testnet ===");
    
    // Get contract instance
    const manager = await hre.ethers.getContractAt(
        "DiplomaManager",
        "0x3D11895D0BB719AcF7B0D995ED19953388318B82"
    );

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
    
    // Start timing
    const startTime = Date.now();
    
    // Verify proof using DiplomaManager
    console.log("\nVerifying proof...");
    const tx = await manager.verifyDiploma(
        proofForContract[0],
        proofForContract[1],
        proofForContract[2],
        [publicSignals[0]]
    );
    
    // Wait for transaction to be mined
    const receipt = await tx.wait();
    
    // Calculate time and gas
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000; // in seconds
    const gasUsed = receipt.gasUsed.toString();
    const gasPrice = tx.gasPrice.toString();
    const gasCost = (BigInt(gasUsed) * BigInt(gasPrice)).toString();
    
    console.log("\n=== Performance Metrics ===");
    console.log(`Verification Time: ${duration} seconds`);
    console.log(`Gas Used: ${gasUsed}`);
    console.log(`Gas Price: ${gasPrice} wei`);
    console.log(`Total Gas Cost: ${gasCost} wei (${hre.ethers.formatEther(gasCost)} ETH)`);
    
    if (receipt.status === 1) {
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