const hre = require("hardhat");

async function main() {
    // Deploy Verifier contract
    const Verifier = await hre.ethers.getContractFactory("Groth16Verifier");
    const verifier = await Verifier.deploy();
    await verifier.deployed();
    console.log("Verifier deployed to:", verifier.address);

    // Deploy DiplomaManager contract
    const DiplomaManager = await hre.ethers.getContractFactory("DiplomaManager");
    const diplomaManager = await DiplomaManager.deploy(verifier.address);
    await diplomaManager.deployed();
    console.log("DiplomaManager deployed to:", diplomaManager.address);

    // Lấy root từ merkle_tree_data.json
    const fs = require("fs");
    const { MERKLE_TREE_FILE } = require("./paths");
    const merkleData = JSON.parse(fs.readFileSync(MERKLE_TREE_FILE));
    const root = merkleData.root;

    // Thêm root vào DiplomaManager
    const tx = await diplomaManager.addRoot(root);
    await tx.wait();
    console.log("Added root:", root);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 