const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

async function main() {
    try {
        // Lấy index từ command line arguments
        const index = process.argv[2] ? parseInt(process.argv[2]) : 5; // Mặc định là diploma thứ 5

        // 1. Tạo input mới từ diploma được chọn
        console.log(`\nTạo input cho diploma index ${index}...`);
        await execAsync(`node scripts/generate_input.js ${index}`);

        // 2. Generate witness
        console.log('\nGenerating witness...');
        await execAsync('node DiplomaVerifier_js/generate_witness.js DiplomaVerifier_js/DiplomaVerifier.wasm input.json witness.wtns');
        console.log('Witness generated successfully!');

        // 3. Generate proof
        console.log('\nGenerating proof...');
        await execAsync('snarkjs groth16 prove DiplomaVerifier_0001.zkey witness.wtns proof.json public.json');
        console.log('Proof generated successfully!');

        // 4. Verify proof
        console.log('\nVerifying proof...');
        const { stdout } = await execAsync('snarkjs groth16 verify verification_key.json public.json proof.json');
        console.log('Verification result:', stdout);

    } catch (error) {
        console.error('Error:', error);
    }
}

// Hiển thị hướng dẫn sử dụng
if (process.argv[2] === '--help' || process.argv[2] === '-h') {
    console.log('Usage: node scripts/test_another_diploma.js [index]');
    console.log('Example: node scripts/test_another_diploma.js 5');
    console.log('\nOptions:');
    console.log('  index: Index của diploma muốn test (0-19)');
    process.exit(0);
}

main(); 