const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
    if (fs.existsSync(vkeyPath)) return;
    console.log(`   - Chưa có Plonk verification key, đang export từ ${path.basename(zkeyPath)}...`);
    execSync(`snarkjs zkey export verificationkey ${zkeyPath} ${vkeyPath}`, { stdio: 'inherit' });
}

function main() {
    const index = process.argv[2] ? parseInt(process.argv[2]) : 0;
    const projectRoot = process.cwd();
    const results = [];

    console.log(
        `=== Đo thời gian Plonk (prove + verify) cho depth ${DEPTHS[0]}..${DEPTHS[DEPTHS.length - 1]} (index = ${index}) ===`
    );

    if (
        !ensureFileExists(
            path.join(projectRoot, 'processed_diplomas.json'),
            'Thiếu processed_diplomas.json. Chạy scripts/prepare_diploma_data.js trước.'
        )
    ) {
        process.exit(1);
    }

    for (const depth of DEPTHS) {
        console.log('\n=======================================================');
        console.log(`>>> ĐỘ SÂU MERKLE (Plonk): ${depth}`);
        console.log('=======================================================');

        const merkleDepthFile = path.join(projectRoot, `merkle_tree_data_depth_${depth}.json`);
        if (
            !ensureFileExists(
                merkleDepthFile,
                `Thiếu merkle_tree_data_depth_${depth}.json. Chạy scripts/create_merkle_tree_depth.js trước.`
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
                `Thiếu WASM depth ${depth}. Chạy scripts/compile_depth_circuits.js trước.`
            )
        ) {
            continue;
        }

        const zkeyPath = path.join(projectRoot, `DiplomaVerifier_Depth${depth}_plonk.zkey`);
        if (
            !ensureFileExists(
                zkeyPath,
                `Thiếu Plonk zkey depth ${depth}. Chạy: snarkjs plonk setup ... DiplomaVerifier_Depth${depth}_plonk.zkey`
            )
        ) {
            continue;
        }

        const vkeyPath = path.join(projectRoot, `DiplomaVerifier_Depth${depth}_plonk_vkey.json`);
        try {
            exportVKeyIfNeeded(zkeyPath, vkeyPath);
        } catch (err) {
            console.error(`❌ Lỗi export Plonk vkey depth ${depth}:`, err.message);
            continue;
        }

        const inputFile = `input_depth_${depth}_index_${index}.json`;
        const witnessFile = `plonk_witness_depth_${depth}_index_${index}.wtns`;
        const proofFile = `plonk_proof_depth_${depth}_index_${index}.json`;
        const publicFile = `plonk_public_depth_${depth}_index_${index}.json`;

        const tStartAll = Date.now();

        // 1. Input
        console.log('\n[1] Tạo input...');
        const tStartInput = Date.now();
        try {
            execSync(`node scripts/generate_input_depth.js ${depth} ${index}`, { stdio: 'inherit' });
        } catch (err) {
            console.error(`❌ Lỗi tạo input depth ${depth}:`, err.message);
            continue;
        }
        const tEndInput = Date.now();
        if (!ensureFileExists(path.join(projectRoot, inputFile), 'Không tìm thấy file input.')) continue;

        // 2. Witness
        console.log('\n[2] Tạo witness...');
        const tStartWitness = Date.now();
        try {
            execSync(
                `node DiplomaVerifier_js/generate_witness.js ${wasmPath} ${inputFile} ${witnessFile}`,
                { stdio: 'inherit' }
            );
        } catch (err) {
            console.error(`❌ Lỗi tạo witness depth ${depth}:`, err.message);
            continue;
        }
        const tEndWitness = Date.now();
        if (!ensureFileExists(path.join(projectRoot, witnessFile), 'Không tìm thấy witness.')) continue;

        // 3. Plonk prove
        console.log('\n[3] Tạo proof (Plonk prove)...');
        const tStartProve = Date.now();
        try {
            execSync(`snarkjs plonk prove ${zkeyPath} ${witnessFile} ${proofFile} ${publicFile}`, {
                stdio: 'inherit',
            });
        } catch (err) {
            console.error(`❌ Lỗi Plonk prove depth ${depth}:`, err.message);
            continue;
        }
        const tEndProve = Date.now();
        if (!ensureFileExists(path.join(projectRoot, proofFile), 'Không tìm thấy proof.')) continue;

        // 4. Plonk verify
        console.log('\n[4] Verify proof (Plonk verify)...');
        const tStartVerify = Date.now();
        try {
            execSync(`snarkjs plonk verify ${vkeyPath} ${publicFile} ${proofFile}`, {
                stdio: 'inherit',
            });
        } catch (err) {
            console.error(`❌ Lỗi Plonk verify depth ${depth}:`, err.message);
            continue;
        }
        const tEndVerify = Date.now();

        const tEndAll = Date.now();

        const inputTime = (tEndInput - tStartInput) / 1000;
        const witnessTime = (tEndWitness - tStartWitness) / 1000;
        const proveTime = (tEndProve - tStartProve) / 1000;
        const verifyTime = (tEndVerify - tStartVerify) / 1000;
        const totalTime = (tEndAll - tStartAll) / 1000;

        results.push({
            depth,
            input: inputTime,
            witness: witnessTime,
            prove: proveTime,
            verify: verifyTime,
            total: totalTime,
        });

        console.log('\n--- KẾT QUẢ PLONK CHO DEPTH', depth, '---');
        console.log(`- Thời gian tạo input:    ${inputTime.toFixed(3)} s`);
        console.log(`- Thời gian tạo witness:  ${witnessTime.toFixed(3)} s`);
        console.log(`- Thời gian tạo proof:    ${proveTime.toFixed(3)} s`);
        console.log(`- Thời gian verify proof: ${verifyTime.toFixed(3)} s`);
        console.log(`- Tổng thời gian:         ${totalTime.toFixed(3)} s`);
        console.log(`   File: ${proofFile}, ${publicFile}`);
    }

    // Bảng tổng kết Plonk
    if (results.length > 0) {
        console.log('\n\n========== BẢNG TỔNG KẾT PLONK (so sánh với Groth16) ==========');
        console.log(
            'Depth | Input (s) | Witness (s) | Prove (s) | Verify (s) | Total (s)'
        );
        console.log(
            '------+-----------+-------------+-----------+------------+----------'
        );
        for (const r of results) {
            console.log(
                `${String(r.depth).padStart(5)} | ${r.input.toFixed(3).padStart(9)} | ${r.witness.toFixed(3).padStart(11)} | ${r.prove.toFixed(3).padStart(9)} | ${r.verify.toFixed(3).padStart(10)} | ${r.total.toFixed(3).padStart(8)}`
            );
        }
    }

    console.log('\n=== Hoàn thành đo thời gian Plonk cho tất cả depth ===');
}

main();
