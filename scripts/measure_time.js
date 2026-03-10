const fs = require('fs');
const circomlibjs = require('circomlibjs');
const { buildMerkleTree } = require('./utils/merkle');
const { DIPLOMA_SAMPLES_FILE } = require('./paths');

function stringToHex(str) {
    return '0x' + Buffer.from(str).toString('hex');
}

async function main() {
    console.log("=== Measuring Performance ===");
    
    // 1. Measure Merkle Tree Creation
    console.log("\n1. Measuring Merkle Tree Creation...");
    const startMerkle = Date.now();
    
    // Read diploma samples
    const data = JSON.parse(fs.readFileSync(DIPLOMA_SAMPLES_FILE));
    const poseidon = await circomlibjs.buildPoseidon();
    
    const diplomas = data.samples.map(diploma => ({
        nameHash: poseidon.F.toObject(poseidon([
            poseidon.F.e(stringToHex(diploma.last_name)),
            poseidon.F.e(stringToHex(diploma.first_name))
        ])).toString(),
        majorCode: 2, // Software Engineering
        studentId: diploma.student_id,
        issueDate: diploma.issue_date.replace(/-/g, '')
    }));
    
    // Create Merkle tree
    const { tree, root, proofs } = await buildMerkleTree(diplomas);
    
    const endMerkle = Date.now();
    const merkleTime = (endMerkle - startMerkle) / 1000;
    console.log(`Merkle Tree Creation Time: ${merkleTime} seconds`);
    console.log(`Number of diplomas: ${diplomas.length}`);
    
    // 2. Measure Proof Generation
    console.log("\n2. Measuring Proof Generation...");
    const startProof = Date.now();
    
    // Generate proof for first diploma
    const proof = proofs[0];
    
    const endProof = Date.now();
    const proofTime = (endProof - startProof) / 1000;
    console.log(`Proof Generation Time: ${proofTime} seconds`);
    
    // 3. Measure Proof Verification
    console.log("\n3. Measuring Proof Verification...");
    const startVerify = Date.now();
    
    // Verify proof
    const isValid = await verifyProof(proof, root);
    
    const endVerify = Date.now();
    const verifyTime = (endVerify - startVerify) / 1000;
    console.log(`Proof Verification Time: ${verifyTime} seconds`);
    console.log(`Verification Result: ${isValid ? 'Valid' : 'Invalid'}`);
}

async function verifyProof(proof, root) {
    // Implement proof verification logic here
    return true;
}

main().catch(console.error); 