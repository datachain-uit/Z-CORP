const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..', '..');
const dataDir = path.join(projectRoot, 'data');

const DIPLOMA_SAMPLES_FILE = path.join(dataDir, 'diploma_samples.json');
const PROCESSED_DIPLOMAS_FILE = path.join(dataDir, 'processed_diplomas.json');
const MERKLE_TREE_FILE = path.join(dataDir, 'merkle_tree_data.json');
const INPUT_FILE = path.join(dataDir, 'input.json');
const merkleTreesDir = path.join(dataDir, 'merkle-trees');
const inputsDir = path.join(dataDir, 'inputs');
const groth16WitnessDir = path.join(dataDir, 'groth16-witness');
const groth16PublicProofDir = path.join(dataDir, 'groth16-public-proof');
const groth16VkeysDir = path.join(dataDir, 'groth16-vkeys');
const plonkZkeysDir = path.join(dataDir, 'plonk-zkeys');
const plonkVkeysDir = path.join(dataDir, 'plonk-vkeys');
const plonkWitnessDir = path.join(dataDir, 'plonk-witness');
const plonkPublicProofDir = path.join(dataDir, 'plonk-public-proof');
const defaultPtauFile = path.join(projectRoot, 'pot16_final.ptau');

function leafCountForDepth(depth) {
    return 2 ** depth;
}

function merkleTreeDepthFile(depth) {
    return path.join(merkleTreesDir, `merkle_tree_data_depth_${depth}.json`);
}

function diplomaSamplesMinFile(leafCount) {
    return path.join(merkleTreesDir, `diploma_samples_min_${leafCount}.json`);
}

function processedDiplomasFileForLeafCount(leafCount) {
    return path.join(merkleTreesDir, `processed_diplomas_${leafCount}.json`);
}

// Legacy path kept for older scripts that wrote directly under data/
function merkleTreeDepthFileLegacy(depth) {
    return path.join(dataDir, `merkle_tree_data_depth_${depth}.json`);
}

// Circuit input files per depth and leaf index
function inputDepthFile(depth, index) {
    return path.join(inputsDir, `input_depth_${depth}_index_${index}.json`);
}

function proofDepthFile(depth, index) {
    return path.join(groth16PublicProofDir, `proof_depth_${depth}_index_${index}.json`);
}

function publicDepthFile(depth, index) {
    return path.join(groth16PublicProofDir, `public_depth_${depth}_index_${index}.json`);
}

const circuitsDir = path.join(projectRoot, 'circuits');
const zkpCircuitsDir = path.join(dataDir, 'zkp-circuits');
const constraintsResultsDir = path.join(projectRoot, 'results', 'constraints');
const provingResultsDir = path.join(projectRoot, 'results', 'proving');

function credentialVerifierBaseName(depth) {
    return `CredentialVerifier_Depth${depth}`;
}

function circuitDepthOutputDir(depth) {
    return path.join(zkpCircuitsDir, credentialVerifierBaseName(depth));
}

function circuitDepthFile(depth) {
    return path.join(circuitsDir, `${credentialVerifierBaseName(depth)}.circom`);
}

function circuitDepthR1csFile(depth) {
    const baseName = credentialVerifierBaseName(depth);
    return path.join(circuitDepthOutputDir(depth), `${baseName}.r1cs`);
}

function wasmDepthFile(depth) {
    const baseName = credentialVerifierBaseName(depth);
    return path.join(circuitDepthOutputDir(depth), `${baseName}_js`, `${baseName}.wasm`);
}

function wasmDepthCandidates(depth) {
    const baseName = credentialVerifierBaseName(depth);
    return [
        wasmDepthFile(depth),
        // legacy locations (before data/zkp-circuits/)
        path.join(circuitsDir, baseName, `${baseName}_js`, `${baseName}.wasm`),
        path.join(projectRoot, baseName, `${baseName}_js`, `${baseName}.wasm`),
    ];
}

function zkeyDepthFile(depth, variant = '0001') {
    const baseName = credentialVerifierBaseName(depth);
    return path.join(circuitDepthOutputDir(depth), `${baseName}_${variant}.zkey`);
}

function zkey0DepthFile(depth) {
    return zkeyDepthFile(depth, '0000');
}

function vkeyDepthFile(depth) {
    const baseName = credentialVerifierBaseName(depth);
    return path.join(groth16VkeysDir, `${baseName}_vkey.json`);
}

function witnessDepthFile(depth, index) {
    return path.join(groth16WitnessDir, `witness_depth_${depth}_index_${index}.wtns`);
}

function generateWitnessScript(depth) {
    const baseName = credentialVerifierBaseName(depth);
    return path.join(circuitDepthOutputDir(depth), `${baseName}_js`, 'generate_witness.js');
}

function plonkZkeyDepthFile(depth) {
    const baseName = credentialVerifierBaseName(depth);
    return path.join(plonkZkeysDir, `${baseName}_plonk.zkey`);
}

function plonkVkeyDepthFile(depth) {
    const baseName = credentialVerifierBaseName(depth);
    return path.join(plonkVkeysDir, `${baseName}_plonk_vkey.json`);
}

function plonkWitnessDepthFile(depth, index) {
    return path.join(plonkWitnessDir, `witness_depth_${depth}_index_${index}.wtns`);
}

function plonkProofDepthFile(depth, index) {
    return path.join(plonkPublicProofDir, `proof_depth_${depth}_index_${index}.json`);
}

function plonkPublicDepthFile(depth, index) {
    return path.join(plonkPublicProofDir, `public_depth_${depth}_index_${index}.json`);
}

function resolveMerkleTreeFile(depth) {
    const canonical = merkleTreeDepthFile(depth);
    if (fs.existsSync(canonical)) {
        return canonical;
    }
    const legacy = merkleTreeDepthFileLegacy(depth);
    if (fs.existsSync(legacy)) {
        return legacy;
    }
    return canonical;
}

module.exports = {
    projectRoot,
    dataDir,
    merkleTreesDir,
    inputsDir,
    groth16WitnessDir,
    groth16PublicProofDir,
    groth16VkeysDir,
    plonkZkeysDir,
    plonkVkeysDir,
    plonkWitnessDir,
    plonkPublicProofDir,
    defaultPtauFile,
    DIPLOMA_SAMPLES_FILE,
    PROCESSED_DIPLOMAS_FILE,
    MERKLE_TREE_FILE,
    INPUT_FILE,
    circuitsDir,
    zkpCircuitsDir,
    constraintsResultsDir,
    provingResultsDir,
    leafCountForDepth,
    merkleTreeDepthFile,
    merkleTreeDepthFileLegacy,
    resolveMerkleTreeFile,
    diplomaSamplesMinFile,
    processedDiplomasFileForLeafCount,
    inputDepthFile,
    proofDepthFile,
    publicDepthFile,
    circuitDepthFile,
    circuitDepthOutputDir,
    circuitDepthR1csFile,
    credentialVerifierBaseName,
    wasmDepthFile,
    wasmDepthCandidates,
    zkeyDepthFile,
    zkey0DepthFile,
    vkeyDepthFile,
    witnessDepthFile,
    generateWitnessScript,
    plonkZkeyDepthFile,
    plonkVkeyDepthFile,
    plonkWitnessDepthFile,
    plonkProofDepthFile,
    plonkPublicDepthFile,
};
