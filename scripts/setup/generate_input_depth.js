const fs = require('fs');
const path = require('path');
const {
    PROCESSED_DIPLOMAS_FILE,
    leafCountForDepth,
    processedDiplomasFileForLeafCount,
    merkleTreeDepthFile,
    merkleTreeDepthFileLegacy,
    inputDepthFile,
} = require('./paths');

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

function resolveProcessedFile(depth, processedFile) {
    if (processedFile) {
        return path.resolve(processedFile);
    }
    const leafCountPath = processedDiplomasFileForLeafCount(leafCountForDepth(depth));
    if (fs.existsSync(leafCountPath)) {
        return leafCountPath;
    }
    return PROCESSED_DIPLOMAS_FILE;
}

function generateInputForDepth(depth, index, options = {}) {
    const processedFile = resolveProcessedFile(depth, options.processedFile);
    const merkleDataFile = options.merkleDataFile
        ? path.resolve(options.merkleDataFile)
        : resolveMerkleTreeFile(depth);
    const outputFile = options.outputFile
        ? path.resolve(options.outputFile)
        : inputDepthFile(depth, index);

    if (!fs.existsSync(processedFile)) {
        throw new Error(
            `Processed credentials file not found: ${processedFile}\n` +
                'Run prep_full_merkle_all_depths.js or prepare_diploma_data.js first.'
        );
    }
    if (!fs.existsSync(merkleDataFile)) {
        throw new Error(
            `Merkle tree file not found: ${merkleDataFile}\n` +
                'Run create_merkle_tree_depth.js or prep_full_merkle_all_depths.js first.'
        );
    }

    const processedData = JSON.parse(fs.readFileSync(processedFile, 'utf8'));
    const merkleData = JSON.parse(fs.readFileSync(merkleDataFile, 'utf8'));

    if (index < 0 || index >= processedData.length) {
        throw new Error(
            `Invalid index ${index}. Choose an index from 0 to ${processedData.length - 1}.`
        );
    }
    if (!merkleData.proofs || !merkleData.proofs[index]) {
        throw new Error(`Merkle file has no proof for index ${index}: ${merkleDataFile}`);
    }

    const diploma = processedData[index];
    const proof = merkleData.proofs[index];

    if (proof.pathIndices.length !== depth) {
        throw new Error(
            `Proof depth (${proof.pathIndices.length}) does not match requested depth (${depth}).`
        );
    }

    const input = {
        nameHash: diploma.nameHash,
        majorCode: diploma.majorCode,
        studentId: diploma.studentId,
        issueDate: diploma.issueDate,
        pathIndices: proof.pathIndices,
        siblings: proof.siblings,
        root: merkleData.root,
    };

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, JSON.stringify(input, null, 2));

    return {
        depth,
        index,
        processedFile,
        merkleDataFile,
        outputFile,
        root: merkleData.root,
        studentId: diploma.studentId,
        totalLeaves: merkleData.totalLeaves,
        realLeaves: merkleData.realLeaves,
    };
}

function main() {
    const depth = process.argv[2] ? parseInt(process.argv[2], 10) : 5;
    const index = process.argv[3] ? parseInt(process.argv[3], 10) : 0;
    const processedFile = process.argv[4] ? path.resolve(process.argv[4]) : undefined;
    const merkleDataFile = process.argv[5] ? path.resolve(process.argv[5]) : undefined;
    const outputFile = process.argv[6] ? path.resolve(process.argv[6]) : undefined;

    if (Number.isNaN(depth) || Number.isNaN(index)) {
        throw new Error(
            'Usage: node scripts/setup/generate_input_depth.js <depth> [index] [processedFile] [merkleFile] [outputFile]'
        );
    }

    console.log(`=== Generating circuit input for depth ${depth}, index ${index} ===`);

    const result = generateInputForDepth(depth, index, {
        processedFile,
        merkleDataFile,
        outputFile,
    });

    console.log(`Created ${result.outputFile}`);
    console.log('Processed file:', result.processedFile);
    console.log('Merkle file:', result.merkleDataFile);
    console.log('Leaf index:', result.index);
    console.log('studentId:', result.studentId);
    console.log('root:', result.root);
    console.log('totalLeaves:', result.totalLeaves);
    console.log('realLeaves:', result.realLeaves);
}

module.exports = { generateInputForDepth, resolveMerkleTreeFile, resolveProcessedFile };

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message || error);
        process.exit(1);
    }
}
