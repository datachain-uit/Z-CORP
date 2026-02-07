const fs = require('fs');
const { buildPoseidon } = require('circomlibjs');

async function createMerkleTreeWithDepth(targetDepth) {
    console.log(`\n=== Tạo Merkle Tree với độ sâu ${targetDepth} ===`);
    
    // Khởi tạo Poseidon hash function
    const poseidon = await buildPoseidon();
    
    // Đọc dữ liệu đã xử lý
    const processedData = JSON.parse(fs.readFileSync('processed_diplomas.json', 'utf8'));
    
    // Tạo leaf nodes từ dữ liệu
    const leaves = processedData.map(diploma => diploma.leafHash);
    
    // Tính số lượng leaves cần thiết cho độ sâu targetDepth
    const requiredLeaves = Math.pow(2, targetDepth);
    console.log(`Số lượng leaves cần thiết cho độ sâu ${targetDepth}: ${requiredLeaves}`);
    console.log(`Số lượng diplomas hiện có: ${leaves.length}`);
    
    // Đảm bảo số lượng leaves đủ cho độ sâu mong muốn
    const zeroValue = "0";
    while (leaves.length < requiredLeaves) {
        leaves.push(zeroValue);
    }
    
    console.log(`Tổng số leaves (bao gồm zeros): ${leaves.length}`);
    
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
    
    // Tạo proofs cho mỗi leaf thật (chỉ các diploma thật, không phải zeros)
    const proofs = [];
    for (let i = 0; i < processedData.length; i++) {
        proofs.push(generateProof(i));
    }
    
    // Lưu dữ liệu Merkle tree
    const merkleData = {
        depth: targetDepth,
        root: root,
        totalLeaves: leaves.length,
        realLeaves: processedData.length,
        leaves: leaves.slice(0, processedData.length), // Chỉ lưu các leaf thật
        proofs: proofs
    };
    
    const filename = `merkle_tree_data_depth_${targetDepth}.json`;
    fs.writeFileSync(filename, JSON.stringify(merkleData, null, 2));
    
    console.log(`Merkle tree độ sâu ${targetDepth} đã được tạo thành công!`);
    console.log(`File: ${filename}`);
    console.log(`Root: ${root}`);
    console.log(`Số lượng leaves thật: ${processedData.length}`);
    console.log(`Tổng số leaves (bao gồm zeros): ${leaves.length}`);
    console.log(`Độ sâu thực tế: ${Math.log2(leaves.length)}`);
    
    return merkleData;
}

async function main() {
    // Tạo Merkle tree cho nhiều độ sâu khác nhau từ cùng một tập diplomas
    // Giữ nguyên "nguyên lý cũ": 
    // - Bắt đầu từ processed_diplomas.json (ví dụ 20 văn bằng thật)
    // - Mỗi diploma đã có leafHash = Poseidon(hash(diploma))
    // - Với từng depth, pad thêm leaf = 0 cho đủ 2^depth rồi mới build cây
    const targetDepths = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    
    for (const depth of targetDepths) {
        try {
            await createMerkleTreeWithDepth(depth);
        } catch (error) {
            console.error(`Lỗi khi tạo Merkle tree độ sâu ${depth}:`, error);
        }
    }
    
    console.log('\n=== Hoàn thành tạo tất cả Merkle trees ===');
}

main().catch(console.error);