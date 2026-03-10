const { exec } = require('child_process');
const fs = require('fs');
const util = require('util');
const execAsync = util.promisify(exec);
const { INPUT_FILE } = require('./paths');

async function main() {
    try {
        // 1. Compile circuit
        console.log('Compiling circuit...');
        await execAsync('circom circuits/DiplomaVerifier.circom --r1cs --wasm --sym --c -l node_modules/circomlib/circuits');
        console.log('Circuit compiled successfully!');

        // 2. Generate ptau file
        console.log('Generating ptau file...');
        // Start a new powers of tau ceremony
        await execAsync('snarkjs powersoftau new bn128 12 pot12_0000.ptau -v');
        // Contribute to the ceremony
        await execAsync('snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name="First contribution" -v -e="random text"');
        // Phase 2
        await execAsync('snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau -v');
        console.log('Ptau file generated successfully!');

        // 3. Generate zkey
        console.log('Generating zkey...');
        await execAsync('snarkjs groth16 setup DiplomaVerifier.r1cs pot12_final.ptau DiplomaVerifier_0000.zkey');
        await execAsync('snarkjs zkey contribute DiplomaVerifier_0000.zkey DiplomaVerifier_0001.zkey --name="First contribution" -v -e="random text"');
        await execAsync('snarkjs zkey export verificationkey DiplomaVerifier_0001.zkey verification_key.json');
        console.log('Zkey generated successfully!');

        // 4. Generate witness
        console.log('Generating witness...');
        await execAsync(`node DiplomaVerifier_js/generate_witness.js DiplomaVerifier_js/DiplomaVerifier.wasm "${INPUT_FILE}" witness.wtns`);
        console.log('Witness generated successfully!');

        // 5. Generate proof
        console.log('Generating proof...');
        await execAsync('snarkjs groth16 prove DiplomaVerifier_0001.zkey witness.wtns proof.json public.json');
        console.log('Proof generated successfully!');

        // 6. Verify proof
        console.log('Verifying proof...');
        const { stdout } = await execAsync('snarkjs groth16 verify verification_key.json public.json proof.json');
        console.log('Verification result:', stdout);

        // 7. Cleanup temporary files
        console.log('Cleaning up...');
        await execAsync('rm pot12_0000.ptau pot12_0001.ptau');
        console.log('Cleanup completed!');

    } catch (error) {
        console.error('Error:', error);
    }
}

main(); 