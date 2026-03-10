const fs = require('fs');
const {
    PROCESSED_DIPLOMAS_FILE,
    MERKLE_TREE_FILE,
    INPUT_FILE,
} = require('./paths');

function main() {
    // Lấy index từ command line arguments
    const index = process.argv[2] ? parseInt(process.argv[2]) : 0;

    // Đọc dữ liệu đã xử lý
    const processedData = JSON.parse(fs.readFileSync(PROCESSED_DIPLOMAS_FILE, 'utf8'));
    const merkleData = JSON.parse(fs.readFileSync(MERKLE_TREE_FILE, 'utf8'));

    // Kiểm tra index hợp lệ
    if (index < 0 || index >= processedData.length) {
        console.error(`Index không hợp lệ. Vui lòng chọn index từ 0 đến ${processedData.length - 1}`);
        process.exit(1);
    }

    // Chọn diploma theo index
    const diploma = processedData[index];
    const proof = merkleData.proofs[index];

    // Tạo input cho circuit
    const input = {
        // Private inputs - thông tin của diploma
        nameHash: diploma.nameHash,
        majorCode: diploma.majorCode,
        studentId: diploma.studentId,
        issueDate: diploma.issueDate,

        // Public inputs - Merkle proof
        pathIndices: proof.pathIndices,
        siblings: proof.siblings,
        root: merkleData.root
    };

    // Lưu input vào file
    fs.writeFileSync(INPUT_FILE, JSON.stringify(input, null, 2));

    console.log(`Đã tạo xong input.json cho circuit (${INPUT_FILE})`);
    console.log('\nThông tin diploma được sử dụng:');
    console.log('- Index:', index);
    console.log('- nameHash:', diploma.nameHash);
    console.log('- majorCode:', diploma.majorCode);
    console.log('- studentId:', diploma.studentId);
    console.log('- issueDate:', diploma.issueDate);
    console.log('\nMerkle proof:');
    console.log('- pathIndices:', proof.pathIndices);
    console.log('- siblings:', proof.siblings);
    console.log('- root:', merkleData.root);
}

main(); 