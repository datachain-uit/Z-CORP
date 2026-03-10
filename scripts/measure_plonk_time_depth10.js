const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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
    console.error(`   Not found: ${filePath}`);
    return false;
  }
  return true;
}

function exportVKeyIfNeeded(zkeyPath, vkeyPath) {
  if (fs.existsSync(vkeyPath)) {
    return;
  }
  console.log(`   - No Plonk verification key yet, exporting from ${path.basename(zkeyPath)}...`);
  execSync(`snarkjs zkey export verificationkey ${zkeyPath} ${vkeyPath}`, {
    stdio: 'inherit',
  });
}

function main() {
  // Allow testing arbitrary depth; default to 5 so you can start with depth 5.
  // Usage:
  //   node scripts/measure_plonk_time_depth10.js           # depth = 5, index = 0
  //   node scripts/measure_plonk_time_depth10.js 10        # depth = 10, index = 0
  //   node scripts/measure_plonk_time_depth10.js 10 3      # depth = 10, index = 3
  const depth = process.argv[2] ? parseInt(process.argv[2]) : 5;
  const index = process.argv[3] ? parseInt(process.argv[3]) : 0;
<<<<<<< HEAD
  const projectRoot = process.cwd();
=======
>>>>>>> a459fc8 (Refactor data layout into data/ and centralize paths)

  console.log(`=== Measuring Plonk proving + verifying time (depth ${depth}, index = ${index}) ===`);

  // Common data requirements
  if (
    !ensureFileExists(
<<<<<<< HEAD
      path.join(projectRoot, 'processed_diplomas.json'),
=======
      PROCESSED_DIPLOMAS_FILE,
>>>>>>> a459fc8 (Refactor data layout into data/ and centralize paths)
      'Missing processed_diplomas.json (used to build inputs). Run scripts/prepare_diploma_data.js first.'
    )
  ) {
    process.exit(1);
  }

<<<<<<< HEAD
  const merkleDepthFile = path.join(
    projectRoot,
    `merkle_tree_data_depth_${depth}.json`
  );
  if (
    !ensureFileExists(
      merkleDepthFile,
=======
  const merkleDepthPath = merkleTreeDepthFile(depth);
  if (
    !ensureFileExists(
      merkleDepthPath,
>>>>>>> a459fc8 (Refactor data layout into data/ and centralize paths)
      `Missing merkle_tree_data_depth_${depth}.json. Run scripts/create_merkle_tree_depth.js first.`
    )
  ) {
    process.exit(1);
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
      `Missing WASM for depth ${depth}. Run scripts/compile_depth_circuits.js (or compile circom) first.`
    )
  ) {
    process.exit(1);
  }

  const zkeyPath = path.join(
    projectRoot,
    `DiplomaVerifier_Depth${depth}_plonk.zkey`
  );
  if (
    !ensureFileExists(
      zkeyPath,
      `Missing Plonk zkey for depth ${depth}. Run snarkjs plonk setup first (see Plonk/README.md).`
    )
  ) {
    process.exit(1);
  }

  const vkeyPath = path.join(
    projectRoot,
    `DiplomaVerifier_Depth${depth}_plonk_vkey.json`
  );
  try {
    exportVKeyIfNeeded(zkeyPath, vkeyPath);
  } catch (err) {
    console.error(
      `❌ Error exporting Plonk verification key for depth ${depth}:`,
      err.message
    );
    process.exit(1);
  }

<<<<<<< HEAD
  const inputFile = `input_depth_${depth}_index_${index}.json`;
=======
  const inputFile = inputDepthFile(depth, index);
>>>>>>> a459fc8 (Refactor data layout into data/ and centralize paths)
  const witnessFile = `plonk_witness_depth_${depth}_index_${index}.wtns`;
  const proofFile = `plonk_proof_depth_${depth}_index_${index}.json`;
  const publicFile = `plonk_public_depth_${depth}_index_${index}.json`;

  const tStartAll = Date.now();

  // 1. Generate input
  console.log('\n[1] Generating input...');
  const tStartInput = Date.now();
  try {
    execSync(
      `node scripts/generate_input_depth.js ${depth} ${index}`,
      { stdio: 'inherit' }
    );
  } catch (err) {
    console.error(
      `❌ Error generating input for depth ${depth}:`,
      err.message
    );
    process.exit(1);
  }
  const tEndInput = Date.now();

  if (
    !ensureFileExists(
<<<<<<< HEAD
      path.join(projectRoot, inputFile),
=======
      inputFile,
>>>>>>> a459fc8 (Refactor data layout into data/ and centralize paths)
      'Input file not found after generate_input_depth.js'
    )
  ) {
    process.exit(1);
  }

  // 2. Generate witness (WASM)
  console.log('\n[2] Generating witness...');
  const tStartWitness = Date.now();
  try {
    execSync(
<<<<<<< HEAD
      `node DiplomaVerifier_js/generate_witness.js ${wasmPath} ${inputFile} ${witnessFile}`,
=======
      `node DiplomaVerifier_js/generate_witness.js ${wasmPath} "${inputFile}" ${witnessFile}`,
>>>>>>> a459fc8 (Refactor data layout into data/ and centralize paths)
      { stdio: 'inherit' }
    );
  } catch (err) {
    console.error(
      `❌ Error generating witness for depth ${depth}:`,
      err.message
    );
    process.exit(1);
  }
  const tEndWitness = Date.now();

  if (
    !ensureFileExists(
      path.join(projectRoot, witnessFile),
      'Witness file not found after generate_witness'
    )
  ) {
    process.exit(1);
  }

  // 3. Plonk prove
  console.log('\n[3] Generating Plonk proof...');
  const tStartProve = Date.now();
  try {
    execSync(
      `snarkjs plonk prove ${zkeyPath} ${witnessFile} ${proofFile} ${publicFile}`,
      { stdio: 'inherit' }
    );
  } catch (err) {
    console.error(
      `❌ Error generating Plonk proof for depth ${depth}:`,
      err.message
    );
    process.exit(1);
  }
  const tEndProve = Date.now();

  if (
    !ensureFileExists(
      path.join(projectRoot, proofFile),
      'Plonk proof file not found after snarkjs plonk prove'
    )
  ) {
    process.exit(1);
  }

  // 4. Plonk verify
  console.log('\n[4] Verifying Plonk proof...');
  const tStartVerify = Date.now();
  try {
    execSync(
      `snarkjs plonk verify ${vkeyPath} ${publicFile} ${proofFile}`,
      { stdio: 'inherit' }
    );
  } catch (err) {
    console.error(
      `❌ Error verifying Plonk proof for depth ${depth}:`,
      err.message
    );
    process.exit(1);
  }
  const tEndVerify = Date.now();

  const tEndAll = Date.now();

  const inputTime = (tEndInput - tStartInput) / 1000;
  const witnessTime = (tEndWitness - tStartWitness) / 1000;
  const proveTime = (tEndProve - tStartProve) / 1000;
  const verifyTime = (tEndVerify - tStartVerify) / 1000;
  const totalTime = (tEndAll - tStartAll) / 1000;

  console.log(`\n--- Plonk timing results (depth ${depth}) ---`);
  console.log(`- Input generation time:    ${inputTime.toFixed(3)} s`);
  console.log(`- Witness generation time:  ${witnessTime.toFixed(3)} s`);
  console.log(`- Plonk proof time:         ${proveTime.toFixed(3)} s`);
  console.log(`- Plonk verify time:        ${verifyTime.toFixed(3)} s`);
  console.log(`- Total time:               ${totalTime.toFixed(3)} s`);

  console.log('\nGenerated files:');
  console.log(`- Input :  ${inputFile}`);
  console.log(`- Witness: ${witnessFile}`);
  console.log(`- Proof :  ${proofFile}`);
  console.log(`- Public:  ${publicFile}`);
}

main();

