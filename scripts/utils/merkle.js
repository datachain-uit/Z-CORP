const circomlibjs = require('circomlibjs');

async function hashDiploma(diploma, poseidon) {
    const inputs = [
        BigInt(diploma.nameHash),
        BigInt(diploma.majorCode),
        BigInt(diploma.studentId),
        BigInt(diploma.issueDate)
    ];
    return poseidon(inputs);
}

async function buildMerkleTree(diplomas) {
    const poseidon = await circomlibjs.buildPoseidon();
    
    // Hash all diplomas
    const leaves = await Promise.all(diplomas.map(d => hashDiploma(d, poseidon)));
    
    // Build tree
    const tree = [];
    const proofs = [];
    
    // Initialize tree with leaves
    tree.push(leaves);
    
    // Build tree levels
    let currentLevel = leaves;
    while (currentLevel.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = currentLevel[i + 1] || left;
            const hash = poseidon([left, right]);
            nextLevel.push(hash);
        }
        tree.push(nextLevel);
        currentLevel = nextLevel;
    }
    
    // Generate proofs
    for (let i = 0; i < leaves.length; i++) {
        const proof = {
            pathIndices: [],
            siblings: []
        };
        
        let currentIndex = i;
        for (let level = 0; level < tree.length - 1; level++) {
            const isRight = currentIndex % 2 === 1;
            const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
            
            proof.pathIndices.push(isRight ? 1 : 0);
            proof.siblings.push(tree[level][siblingIndex] || tree[level][currentIndex]);
            
            currentIndex = Math.floor(currentIndex / 2);
        }
        
        proofs.push(proof);
    }
    
    return {
        tree,
        root: tree[tree.length - 1][0],
        proofs
    };
}

module.exports = {
    buildMerkleTree,
    hashDiploma
}; 