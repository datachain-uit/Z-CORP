const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
<<<<<<< HEAD
=======
const {
    projectRoot,
    PROCESSED_DIPLOMAS_FILE,
    merkleTreeDepthFile,
    inputDepthFile,
} = require('./paths');
>>>>>>> a459fc8 (Refactor data layout into data/ and centralize paths)

function ensureFileExists(filePath, message) {
    if (!fs.existsSync(filePath)) {
        console.error(`❌ ${message}`);
        console.error(`   Không tìm thấy: ${filePath}`);
        process.exit(1);
    }
}

function main() {
    // Độ sâu cố định là 10, có thể sửa nếu cần
    const depth = 10;
    const index = process.argv[2] ? parseInt(process.argv[2]) : 0;

    console.log(`=== Đo thời gian tạo proof cho circuit depth ${depth} (index = ${index}) ===`);

    const projectRoot = process.cwd();

    // Các đường dẫn mặc định, chỉnh lại nếu bạn dùng tên khác
<<<<<<< HEAD
    const inputFile = `input_depth_${depth}_index_${index}.json`;
=======
    const inputFile = inputDepthFile(depth, index);
>>>>>>> a459fc8 (Refactor data layout into data/ and centralize paths)
    const witnessFile = `witness_depth_${depth}_index_${index}.wtns`;
    const proofFile = `proof_depth_${depth}_index_${index}.json`;
    const publicFile = `public_depth_${depth}_index_${index}.json`;

    const wasmPath = path.join(
        projectRoot,
        'DiplomaVerifier_Depth10',
        'DiplomaVerifier_Depth10_js',
        'DiplomaVerifier_Depth10.wasm'
    );

    // Giả định zkey cho depth10 tên là DiplomaVerifier_Depth10_0001.zkey
    // Nếu bạn dùng tên khác, chỉnh ở đây
    const zkeyPath = path.join(projectRoot, 'DiplomaVerifier_Depth10_0001.zkey');

    ensureFileExists(
<<<<<<< HEAD
        path.join(projectRoot, 'processed_diplomas.json'),
        'Thiếu file processed_diplomas.json (dùng để tạo input)'
    );

    const merkleDepthFile = path.join(
        projectRoot,
        `merkle_tree_data_depth_${depth}.json`
    );
    ensureFileExists(
        merkleDepthFile,
=======
        PROCESSED_DIPLOMAS_FILE,
        'Thiếu file processed_diplomas.json (dùng để tạo input)'
    );

    const merkleDepthPath = merkleTreeDepthFile(depth);
    ensureFileExists(
        merkleDepthPath,
>>>>>>> a459fc8 (Refactor data layout into data/ and centralize paths)
        `Thiếu file merkle_tree_data_depth_${depth}.json (vui lòng chạy scripts/create_merkle_tree_depth.js trước)`
    );

    ensureFileExists(
        wasmPath,
        'Thiếu wasm của circuit depth10. Hãy chạy scripts/compile_depth_circuits.js (hoặc tự compile circom) trước.'
    );

    ensureFileExists(
        zkeyPath,
        'Thiếu zkey cho circuit depth10. Hãy chạy snarkjs groth16 setup/contribute để tạo zkey này.'
    );

    const tStartAll = Date.now();

    // 1. Tạo input cho circuit depth 10
    console.log('\n[1] Tạo input cho circuit depth 10...');
    const tStartInput = Date.now();
    execSync(`node scripts/generate_input_depth.js ${depth} ${index}`, {
        stdio: 'inherit',
    });
    const tEndInput = Date.now();

    ensureFileExists(
<<<<<<< HEAD
        path.join(projectRoot, inputFile),
=======
        inputFile,
>>>>>>> a459fc8 (Refactor data layout into data/ and centralize paths)
        'Sau khi generate_input_depth.js chạy, không tìm thấy file input mong đợi.'
    );

    // 2. Tạo witness
    console.log('\n[2] Tạo witness...');
    const tStartWitness = Date.now();
    execSync(
<<<<<<< HEAD
        `node DiplomaVerifier_js/generate_witness.js ${wasmPath} ${inputFile} ${witnessFile}`,
=======
        `node DiplomaVerifier_js/generate_witness.js ${wasmPath} "${inputFile}" ${witnessFile}`,
>>>>>>> a459fc8 (Refactor data layout into data/ and centralize paths)
        { stdio: 'inherit' }
    );
    const tEndWitness = Date.now();

    ensureFileExists(
        path.join(projectRoot, witnessFile),
        'Không tìm thấy file witness sau khi generate_witness.'
    );

    // 3. Tạo proof (groth16 prove)
    console.log('\n[3] Tạo proof (groth16 prove)...');
    const tStartProof = Date.now();
    execSync(
        `snarkjs groth16 prove ${zkeyPath} ${witnessFile} ${proofFile} ${publicFile}`,
        { stdio: 'inherit' }
    );
    const tEndProof = Date.now();

    ensureFileExists(
        path.join(projectRoot, proofFile),
        'Không tìm thấy file proof sau khi snarkjs groth16 prove.'
    );

    const tEndAll = Date.now();

    const inputTime = (tEndInput - tStartInput) / 1000;
    const witnessTime = (tEndWitness - tStartWitness) / 1000;
    const proofTime = (tEndProof - tStartProof) / 1000;
    const totalTime = (tEndAll - tStartAll) / 1000;

    console.log('\n=== KẾT QUẢ ĐO THỜI GIAN (depth 10) ===');
    console.log(`- Thời gian tạo input:    ${inputTime.toFixed(3)} s`);
    console.log(`- Thời gian tạo witness:  ${witnessTime.toFixed(3)} s`);
    console.log(`- Thời gian tạo proof:    ${proofTime.toFixed(3)} s`);
    console.log(`- Tổng thời gian:         ${totalTime.toFixed(3)} s`);

    console.log('\n=== FILE ĐƯỢC TẠO ===');
    console.log(`- Input :  ${inputFile}`);
    console.log(`- Witness: ${witnessFile}`);
    console.log(`- Proof :  ${proofFile}`);
    console.log(`- Public:  ${publicFile}`);
}

main();

