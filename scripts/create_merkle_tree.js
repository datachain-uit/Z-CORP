const fs = require('fs');
const { buildPoseidon } = require('circomlibjs');
const {
    PROCESSED_DIPLOMAS_FILE,
    MERKLE_TREE_FILE,
} = require('./paths');

async function main() {
    // Khởi tạo Poseidon hash function
    const poseidon = await buildPoseidon();
    
    // Đọc dữ liệu đã xử lý
    const processedData = JSON.parse(fs.readFileSync(PROCESSED_DIPLOMAS_FILE, 'utf8'));
    
    // Tạo leaf nodes từ dữ liệu
    const leaves = processedData.map(diploma => diploma.leafHash);
    
    // Đảm bảo số lượng leaves là lũy thừa của 2
    const zeroValue = "0";
    while (leaves.length & (leaves.length - 1)) {
        leaves.push(zeroValue);
    }
    
    // Hàm tính hash của 2 node
    function hashPair(left, right) {
        const hash = poseidon([BigInt(left), BigInt(right)]);
        return poseidon.F.toString(hash);
    }
    
    // Hàm tạo Merkle proof cho một leaf
    function generateProof(leafIndex) {
        const proof = {
            leaf: leaves[leafIndex],
            pathIndices: [],
            siblings: []
        };
        
        let currentIndex = leafIndex;
        let currentLevel = leaves;
        
        while (currentLevel.length > 1) {
            const isRight = currentIndex % 2 === 1;
            const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
            
            proof.pathIndices.push(isRight ? 1 : 0);
            proof.siblings.push(currentLevel[siblingIndex]);
            
            // Tạo level tiếp theo
            const nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : zeroValue;
                nextLevel.push(hashPair(left, right));
            }
            
            currentLevel = nextLevel;
            currentIndex = Math.floor(currentIndex / 2);
        }
        
        return proof;
    }
    
    // Tính Merkle root
    let currentLevel = leaves;
    while (currentLevel.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : zeroValue;
            nextLevel.push(hashPair(left, right));
        }
        currentLevel = nextLevel;
    }
    const root = currentLevel[0];
    
    // Tạo proofs cho mỗi leaf thật
    const proofs = [];
    for (let i = 0; i < processedData.length; i++) {
        proofs.push(generateProof(i));
    }
    
    // Lưu dữ liệu Merkle tree
    const merkleData = {
        root: root,
        leaves: leaves.slice(0, processedData.length), // Chỉ lưu các leaf thật
        proofs: proofs
    };
    
    fs.writeFileSync(MERKLE_TREE_FILE, JSON.stringify(merkleData, null, 2));
    
    console.log('Merkle tree đã được tạo thành công!');
    console.log('Root:', root);
    console.log('Số lượng leaves thật:', processedData.length);
    console.log('Tổng số leaves (bao gồm zeros):', leaves.length);
}

main().catch(console.error); 