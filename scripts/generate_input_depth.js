const fs = require('fs');

function main() {
    // Lấy các tham số từ command line arguments
    const depth = process.argv[2] ? parseInt(process.argv[2]) : 5;
    const index = process.argv[3] ? parseInt(process.argv[3]) : 0;

    console.log(`=== Tạo input cho circuit độ sâu ${depth}, index ${index} ===`);

    // Đọc dữ liệu đã xử lý
    const processedData = JSON.parse(fs.readFileSync('processed_diplomas.json', 'utf8'));
    
    // Đọc dữ liệu Merkle tree tương ứng với độ sâu
    const merkleDataFile = `merkle_tree_data_depth_${depth}.json`;
    if (!fs.existsSync(merkleDataFile)) {
        console.error(`File ${merkleDataFile} không tồn tại!`);
        console.error('Vui lòng chạy script create_merkle_tree_depth.js trước.');
        process.exit(1);
    }
    
    const merkleData = JSON.parse(fs.readFileSync(merkleDataFile, 'utf8'));

    // Kiểm tra index hợp lệ
    if (index < 0 || index >= processedData.length) {
        console.error(`Index không hợp lệ. Vui lòng chọn index từ 0 đến ${processedData.length - 1}`);
        process.exit(1);
    }

    // Chọn diploma theo index
    const diploma = processedData[index];
    const proof = merkleData.proofs[index];

    // Kiểm tra độ sâu của proof
    if (proof.pathIndices.length !== depth) {
        console.error(`Độ sâu của proof (${proof.pathIndices.length}) không khớp với độ sâu yêu cầu (${depth})`);
        process.exit(1);
    }

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
    const inputFilename = `input_depth_${depth}_index_${index}.json`;
    fs.writeFileSync(inputFilename, JSON.stringify(input, null, 2));

    console.log(`Đã tạo xong ${inputFilename} cho circuit độ sâu ${depth}`);
    console.log('\nThông tin diploma được sử dụng:');
    console.log('- Index:', index);
    console.log('- nameHash:', diploma.nameHash);
    console.log('- majorCode:', diploma.majorCode);
    console.log('- studentId:', diploma.studentId);
    console.log('- issueDate:', diploma.issueDate);
    console.log('\nMerkle proof:');
    console.log('- Độ sâu:', depth);
    console.log('- pathIndices:', proof.pathIndices);
    console.log('- siblings:', proof.siblings);
    console.log('- root:', merkleData.root);
    console.log('\nThông tin Merkle tree:');
    console.log('- Tổng số leaves:', merkleData.totalLeaves);
    console.log('- Số leaves thật:', merkleData.realLeaves);
}

main();