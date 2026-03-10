const hre = require("hardhat");
const fs = require("fs");
const { ethers } = require("hardhat");
const { MERKLE_TREE_FILE } = require("./paths");

async function main() {
    // Kết nối với DiplomaManager contract đã deploy
    const diplomaManager = await hre.ethers.getContractAt(
        "DiplomaManager",
        "0x09635F643e140090A9A8Dcd712eD6285858ceBef" // Địa chỉ contract sau khi deploy
    );

    console.log("Connected to DiplomaManager at:", await diplomaManager.getAddress());

    // Đọc merkle tree data
    const merkleData = JSON.parse(fs.readFileSync(MERKLE_TREE_FILE));
    console.log("\nMerkle root:", merkleData.root);

    // Kiểm tra root có hợp lệ không
    const isValid = await diplomaManager.isValidRoot(merkleData.root);
    console.log("Is root valid?", isValid);

    // Test case 1: Verify diploma hợp lệ
    console.log("\n=== Test Case 1: Verify diploma hợp lệ ===");
    try {
        // Đọc proof và public inputs từ file
        const proof = JSON.parse(fs.readFileSync("proof.json"));
        const publicSignals = JSON.parse(fs.readFileSync("public.json"));

        // Format proof cho contract và chuyển thành BigInt
        const formattedProof = {
            a: proof.pi_a.slice(0, 2).map(x => BigInt(x)),
            b: [
                [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
                [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])]
            ],
            c: proof.pi_c.slice(0, 2).map(x => BigInt(x))
        };

        // Convert public signals to BigInt
        const formattedPublicSignals = publicSignals.map(x => BigInt(x));

        console.log("Verifying diploma with:");
        console.log("- Formatted proof:", {
            a: formattedProof.a.map(x => x.toString()),
            b: formattedProof.b.map(row => row.map(x => x.toString())),
            c: formattedProof.c.map(x => x.toString())
        });
        console.log("- Public signals:", formattedPublicSignals.map(x => x.toString()));

        // Verify diploma
        console.log("Sending transaction...");
        const tx = await diplomaManager.verifyDiploma(
            formattedProof.a,
            formattedProof.b,
            formattedProof.c,
            formattedPublicSignals
        );
        
        console.log("Transaction hash:", tx.hash);
        console.log("Waiting for confirmation...");
        
        const receipt = await tx.wait();
        console.log("Transaction confirmed in block:", receipt.blockNumber);
        
        // Tính toán gas
        const gasUsed = receipt.gasUsed;
        const gasPrice = receipt.gasPrice;
        const gasCost = gasUsed * gasPrice;
        
        console.log("\nGas Usage:");
        console.log("- Gas Used:", gasUsed.toString());
        console.log("- Gas Price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");
        console.log("- Gas Cost:", ethers.formatEther(gasCost), "ETH");
        
        if (receipt.status === 1) {
            console.log("Diploma verified successfully!");
            
            // Log all events
            for (const event of receipt.logs) {
                try {
                    const decodedEvent = diplomaManager.interface.parseLog(event);
                    if (decodedEvent) {
                        console.log("Event:", decodedEvent.name);
                        console.log("Args:", decodedEvent.args);
                    }
                } catch (e) {
                    // Skip events that can't be decoded
                }
            }
        } else {
            console.log("Transaction failed!");
            
            // Tính toán gas cho transaction thất bại
            const gasUsed = receipt.gasUsed;
            const gasPrice = receipt.gasPrice;
            const gasCost = gasUsed * gasPrice;
            
            console.log("\nGas Usage (Failed Transaction):");
            console.log("- Gas Used:", gasUsed.toString());
            console.log("- Gas Price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");
            console.log("- Gas Cost:", ethers.formatEther(gasCost), "ETH");
            
            console.log("WARNING: Invalid diploma was verified!");
        }
    } catch (error) {
        console.error("Error verifying valid diploma:", error.message);
    }

    // Test case 2: Verify diploma không hợp lệ
    console.log("\n=== Test Case 2: Verify diploma không hợp lệ ===");
    try {
        // Tạo proof không hợp lệ với BigInt
        const invalidProof = {
            a: [BigInt(0), BigInt(0)],
            b: [[BigInt(0), BigInt(0)], [BigInt(0), BigInt(0)]],
            c: [BigInt(0), BigInt(0)]
        };
        const invalidPublicSignals = [BigInt(0)];

        console.log("Verifying invalid diploma...");
        
        // Verify diploma
        const tx = await diplomaManager.verifyDiploma(
            invalidProof.a,
            invalidProof.b,
            invalidProof.c,
            invalidPublicSignals
        );
        
        await tx.wait();
        console.log("WARNING: Invalid diploma was verified!");
    } catch (error) {
        console.log("Expected error occurred:", error.message);
        console.log("Invalid diploma was correctly rejected!");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 