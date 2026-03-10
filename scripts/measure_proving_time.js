const fs = require('fs');
const circomlibjs = require('circomlibjs');
const { buildMerkleTree } = require('./utils/merkle');
const { PROCESSED_DIPLOMAS_FILE, MERKLE_TREE_FILE, dataDir } = require('./paths');

async function hashName(lastName, firstName, poseidon) {
    // Tạo name từ last_name và first_name
    const name = `${lastName} ${firstName}`;
    
    // Chuyển name thành bytes
    const nameBytes = Buffer.from(name, 'utf8');
    
    // Chia nameBytes thành các chunk 32 bytes
    const chunks = [];
    for (let i = 0; i < nameBytes.length; i += 32) {
        chunks.push(nameBytes.slice(i, i + 32));
    }
    
    // Hash từng chunk và kết hợp
    let nameHash = BigInt(0);
    for (const chunk of chunks) {
        // Chuyển chunk thành số bigint
        const chunkBigInt = BigInt('0x' + chunk.toString('hex'));
        // Hash chunk
        const hash = poseidon([chunkBigInt]);
        // Kết hợp với hash hiện tại
        nameHash = poseidon([nameHash, hash]);
    }
    
    return poseidon.F.toString(nameHash);
}

async function main() {
    console.log("=== Measuring Proving Time ===");
    
    // 1. Load data
    console.log("\n1. Loading data...");
    const startLoad = Date.now();
    
    const processedDiplomas = JSON.parse(fs.readFileSync(PROCESSED_DIPLOMAS_FILE));
    const merkleData = JSON.parse(fs.readFileSync(MERKLE_TREE_FILE));
    
    const endLoad = Date.now();
    console.log(`Data loading time: ${(endLoad - startLoad) / 1000} seconds`);
    
    // 2. Get user input
    console.log("\n2. Getting user input...");
    const lastName = "Ly";  // Example input
    const firstName = "Hong Ngoc";  // Example input
    const studentId = "08520564";  // Example input
    
    // 3. Hash name
    console.log("\n3. Hashing name...");
    const startHash = Date.now();
    
    const poseidon = await circomlibjs.buildPoseidon();
    const nameHash = await hashName(lastName, firstName, poseidon);
    
    const endHash = Date.now();
    console.log(`Name hashing time: ${(endHash - startHash) / 1000} seconds`);
    
    // Debug: Print all diplomas
    // console.log("\n=== Debug Information ===");
    // console.log("Input nameHash:", nameHash);
    // console.log("Input studentId:", studentId);
    // console.log("\nAvailable diplomas:");
    // processedDiplomas.forEach((d, index) => {
    //     console.log(`\nDiploma ${index + 1}:`);
    //     console.log(`- nameHash: ${d.nameHash}`);
    //     console.log(`- studentId: ${d.studentId}`);
    //     console.log(`- leafHash: ${d.leafHash}`);
    //     console.log(`- nameHash match: ${d.nameHash === nameHash}`);
    //     console.log(`- studentId match: ${d.studentId === studentId}`);
    // });
    
    // 4. Find matching diploma
    console.log("\n4. Finding matching diploma...");
    const startFind = Date.now();
    
    // Convert nameHash to string for comparison
    const nameHashStr = nameHash.toString();
    
    const matchingDiploma = processedDiplomas.find(d => {
        const nameHashMatch = d.nameHash === nameHashStr;
        const studentIdMatch = d.studentId === studentId;
        console.log(`\nChecking diploma ${d.studentId}:`);
        console.log(`- nameHash match: ${nameHashMatch}`);
        console.log(`- studentId match: ${studentIdMatch}`);
        return nameHashMatch && studentIdMatch;
    });
    
    if (!matchingDiploma) {
        console.log("❌ No matching diploma found!");
        return;
    }
    
    const endFind = Date.now();
    console.log(`Finding time: ${(endFind - startFind) / 1000} seconds`);
    
    // 5. Get Merkle proof
    console.log("\n5. Getting Merkle proof...");
    const startProof = Date.now();
    
    // Find proof by matching leafHash with leaf in merkleData
    const proof = merkleData.proofs.find(p => p.leaf === matchingDiploma.leafHash);
    
    if (!proof) {
        console.log("❌ No proof found for this diploma!");
        console.log("LeafHash to find:", matchingDiploma.leafHash);
        console.log("Available leaves:", merkleData.proofs.map(p => p.leaf));
        return;
    }
    
    const endProof = Date.now();
    console.log(`Proof finding time: ${(endProof - startProof) / 1000} seconds`);
    
    // 6. Generate proof
    console.log("\n6. Generating proof...");
    const startGenerate = Date.now();
    
    const path = require('path');
    const inputFileName = path.join(dataDir, `input_${studentId}.json`);
    const input = {
        nameHash: matchingDiploma.nameHash,
        majorCode: matchingDiploma.majorCode,
        studentId: matchingDiploma.studentId,
        issueDate: matchingDiploma.issueDate,
        root: merkleData.root,
        pathIndices: proof.pathIndices,
        siblings: proof.siblings
    };
    
    fs.writeFileSync(inputFileName, JSON.stringify(input, null, 2));
    
    // Generate witness with studentId suffix
    const witnessFileName = `witness_${studentId}.wtns`;
    const { execSync } = require('child_process');
    execSync(`node DiplomaVerifier_js/generate_witness.js DiplomaVerifier_js/DiplomaVerifier.wasm ${inputFileName} ${witnessFileName}`);
    
    // Generate proof with studentId suffix
    const proofFileName = `proof_${studentId}.json`;
    const publicFileName = `public_${studentId}.json`;
    execSync(`snarkjs groth16 prove DiplomaVerifier_0001.zkey ${witnessFileName} ${proofFileName} ${publicFileName}`);
    
    const endGenerate = Date.now();
    console.log(`Proof generation time: ${(endGenerate - startGenerate) / 1000} seconds`);
    
    // 7. Summary
    console.log("\n=== Performance Summary ===");
    console.log(`Total proving time: ${(endGenerate - startLoad) / 1000} seconds`);
    console.log(`- Data loading: ${(endLoad - startLoad) / 1000} seconds`);
    console.log(`- Name hashing: ${(endHash - startHash) / 1000} seconds`);
    console.log(`- Finding diploma: ${(endFind - startFind) / 1000} seconds`);
    console.log(`- Getting proof: ${(endProof - startProof) / 1000} seconds`);
    console.log(`- Generating proof: ${(endGenerate - startGenerate) / 1000} seconds`);
    
    // 8. File information
    console.log("\n=== Generated Files ===");
    console.log(`Input file: ${inputFileName}`);
    console.log(`Witness file: ${witnessFileName}`);
    console.log(`Proof file: ${proofFileName}`);
    console.log(`Public file: ${publicFileName}`);
}

main().catch(console.error); 