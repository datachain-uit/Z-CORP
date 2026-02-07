const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Danh sách độ sâu Merkle / circuit cần test
const DEPTHS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function ensureFileExists(filePath, message) {
    if (!fs.existsSync(filePath)) {
        console.error(`❌ ${message}`);
        console.error(`   Không tìm thấy: ${filePath}`);
        return false;
    }
    return true;
}

function exportVKeyIfNeeded(zkeyPath, vkeyPath) {
    if (fs.existsSync(vkeyPath)) {
        return;
    }
    console.log(`   - Chưa có verification key, đang export từ ${path.basename(zkeyPath)}...`);
    execSync(`snarkjs zkey export verificationkey ${zkeyPath} ${vkeyPath}`, {
        stdio: 'inherit',
    });
}

function main() {
    const index = process.argv[2] ? parseInt(process.argv[2]) : 0;
    const projectRoot = process.cwd();

    console.log(
        `=== Đo thời gian prove + verify cho các depth ${DEPTHS[0]}..${DEPTHS[DEPTHS.length - 1]} (index = ${index}) ===`
    );

    // Kiểm tra dữ liệu chung
    if (
        !ensureFileExists(
            path.join(projectRoot, 'processed_diplomas.json'),
            'Thiếu file processed_diplomas.json (dùng để tạo input)'
        )
    ) {
        process.exit(1);
    }

    for (const depth of DEPTHS) {
        console.log('\n=======================================================');
        console.log(`>>> ĐỘ SÂU MERKLE: ${depth}`);
        console.log('=======================================================');

        const merkleDepthFile = path.join(
            projectRoot,
            `merkle_tree_data_depth_${depth}.json`
        );
        if (
            !ensureFileExists(
                merkleDepthFile,
                `Thiếu file merkle_tree_data_depth_${depth}.json (hãy chạy scripts/create_merkle_tree_depth.js trước)`
            )
        ) {
            continue;
        }

        const wasmPath = path.join(
            projectRoot,
            `DiplomaVerifier_Depth${depth}`,
            `DiplomaVerifier_Depth${depth}_js`,
            `DiplomaVerifier_Depth${depth}.wasm`
        );
        if (
            !ensureFileExists(
                wasmPath,
                `Thiếu wasm cho depth ${depth}. Hãy chạy scripts/compile_depth_circuits.js (hoặc tự compile circom) trước.`
            )
        ) {
            continue;
        }

        const zkeyPath = path.join(
            projectRoot,
            `DiplomaVerifier_Depth${depth}_0001.zkey`
        );
        if (
            !ensureFileExists(
                zkeyPath,
                `Thiếu zkey cho depth ${depth}. Hãy chạy groth16 setup + contribute để tạo zkey này.`
            )
        ) {
            continue;
        }

        const vkeyPath = path.join(
            projectRoot,
            `DiplomaVerifier_Depth${depth}_vkey.json`
        );
        try {
            exportVKeyIfNeeded(zkeyPath, vkeyPath);
        } catch (err) {
            console.error(
                `❌ Lỗi khi export verification key cho depth ${depth}:`,
                err.message
            );
            continue;
        }

        const inputFile = `input_depth_${depth}_index_${index}.json`;
        const witnessFile = `witness_depth_${depth}_index_${index}.wtns`;
        const proofFile = `proof_depth_${depth}_index_${index}.json`;
        const publicFile = `public_depth_${depth}_index_${index}.json`;

        const tStartAll = Date.now();

        // 1. Tạo input
        console.log('\n[1] Tạo input...');
        const tStartInput = Date.now();
        try {
            execSync(
                `node scripts/generate_input_depth.js ${depth} ${index}`,
                { stdio: 'inherit' }
            );
        } catch (err) {
            console.error(
                `❌ Lỗi khi tạo input cho depth ${depth}:`,
                err.message
            );
            continue;
        }
        const tEndInput = Date.now();

        if (
            !ensureFileExists(
                path.join(projectRoot, inputFile),
                'Không tìm thấy file input sau khi generate_input_depth.js'
            )
        ) {
            continue;
        }

        // 2. Tạo witness
        console.log('\n[2] Tạo witness...');
        const tStartWitness = Date.now();
        try {
            execSync(
                `node DiplomaVerifier_js/generate_witness.js ${wasmPath} ${inputFile} ${witnessFile}`,
                { stdio: 'inherit' }
            );
        } catch (err) {
            console.error(
                `❌ Lỗi khi tạo witness cho depth ${depth}:`,
                err.message
            );
            continue;
        }
        const tEndWitness = Date.now();

        if (
            !ensureFileExists(
                path.join(projectRoot, witnessFile),
                'Không tìm thấy file witness sau khi generate_witness'
            )
        ) {
            continue;
        }

        // 3. Prove (groth16 prove)
        console.log('\n[3] Tạo proof (groth16 prove)...');
        const tStartProve = Date.now();
        try {
            execSync(
                `snarkjs groth16 prove ${zkeyPath} ${witnessFile} ${proofFile} ${publicFile}`,
                { stdio: 'inherit' }
            );
        } catch (err) {
            console.error(
                `❌ Lỗi khi tạo proof cho depth ${depth}:`,
                err.message
            );
            continue;
        }
        const tEndProve = Date.now();

        if (
            !ensureFileExists(
                path.join(projectRoot, proofFile),
                'Không tìm thấy file proof sau khi snarkjs groth16 prove'
            )
        ) {
            continue;
        }

        // 4. Verify proof
        console.log('\n[4] Verify proof...');
        const tStartVerify = Date.now();
        try {
            execSync(
                `snarkjs groth16 verify ${vkeyPath} ${publicFile} ${proofFile}`,
                { stdio: 'inherit' }
            );
        } catch (err) {
            console.error(
                `❌ Lỗi khi verify proof cho depth ${depth}:`,
                err.message
            );
            continue;
        }
        const tEndVerify = Date.now();

        const tEndAll = Date.now();

        const inputTime = (tEndInput - tStartInput) / 1000;
        const witnessTime = (tEndWitness - tStartWitness) / 1000;
        const proveTime = (tEndProve - tStartProve) / 1000;
        const verifyTime = (tEndVerify - tStartVerify) / 1000;
        const totalTime = (tEndAll - tStartAll) / 1000;

        console.log('\n--- KẾT QUẢ CHO DEPTH', depth, '---');
        console.log(`- Thời gian tạo input:    ${inputTime.toFixed(3)} s`);
        console.log(`- Thời gian tạo witness:  ${witnessTime.toFixed(3)} s`);
        console.log(`- Thời gian tạo proof:    ${proveTime.toFixed(3)} s`);
        console.log(`- Thời gian verify proof: ${verifyTime.toFixed(3)} s`);
        console.log(`- Tổng thời gian:         ${totalTime.toFixed(3)} s`);

        console.log('\n   File sinh ra:');
        console.log(`   - Input :  ${inputFile}`);
        console.log(`   - Witness: ${witnessFile}`);
        console.log(`   - Proof :  ${proofFile}`);
        console.log(`   - Public:  ${publicFile}`);
    }

    console.log('\n=== Hoàn thành đo thời gian cho tất cả depth ===');
}

main();

