const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { buildPoseidon } = require('circomlibjs');
const {
    PROCESSED_DIPLOMAS_FILE,
    merkleTreeDepthFile,
    merkleTreesDir,
} = require('../setup/paths.js');

async function createMerkleTreeWithDepth(targetDepth, inputFile, outputFile, options = {}) {
    const strictNoPad = options.strictNoPad ?? process.env.NO_ZERO_PAD === '1';

    console.log(`\n=== Building Merkle tree at depth ${targetDepth} ===`);

    const poseidon = await buildPoseidon();
    const processedData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    const leaves = processedData.map((row) => row.leafHash);
    const requiredLeaves = 2 ** targetDepth;

    console.log(`Required leaves for depth ${targetDepth}: ${requiredLeaves}`);
    console.log(`Credential count in input file: ${leaves.length}`);

    if (leaves.length > requiredLeaves) {
        throw new Error(
            `Input has ${leaves.length} records but depth ${targetDepth} allows at most ${requiredLeaves}.`
        );
    }

    if (leaves.length < requiredLeaves) {
        if (strictNoPad) {
            throw new Error(
                `NO_ZERO_PAD: expected exactly ${requiredLeaves} credentials for depth ${targetDepth}, ` +
                    `got ${leaves.length}. Run prep_full_merkle_all_depths.js first.`
            );
        }

        const zeroValue = '0';
        while (leaves.length < requiredLeaves) {
            leaves.push(zeroValue);
        }
        console.log(`Padded with zero leaves to reach ${requiredLeaves} total.`);
    } else {
        console.log('Full tree: no zero padding.');
    }

    function hashPair(left, right) {
        const hash = poseidon([BigInt(left), BigInt(right)]);
        return poseidon.F.toString(hash);
    }

    const levels = [leaves];
    let currentLevel = leaves;
    while (currentLevel.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : '0';
            nextLevel.push(hashPair(left, right));
        }
        levels.push(nextLevel);
        currentLevel = nextLevel;
    }
    const root = currentLevel[0];

    function generateProof(leafIndex) {
        const proof = {
            leaf: leaves[leafIndex],
            pathIndices: [],
            siblings: [],
        };
        let idx = leafIndex;
        for (let d = 0; d < levels.length - 1; d++) {
            const level = levels[d];
            const isRight = idx % 2 === 1;
            const siblingIndex = isRight ? idx - 1 : idx + 1;
            proof.pathIndices.push(isRight ? 1 : 0);
            proof.siblings.push(level[siblingIndex]);
            idx = Math.floor(idx / 2);
        }
        return proof;
    }

    const proofCount = strictNoPad ? leaves.length : processedData.length;
    const proofs = [];
    for (let i = 0; i < proofCount; i++) {
        proofs.push(generateProof(i));
    }

    const merkleData = {
        depth: targetDepth,
        root,
        totalLeaves: leaves.length,
        realLeaves: processedData.length,
        leaves: leaves.slice(0, processedData.length),
        proofs,
    };

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, JSON.stringify(merkleData, null, 2));

    console.log(`Merkle tree saved to ${outputFile}`);
    console.log(`Root: ${root}`);
    console.log(`Real leaves: ${processedData.length}`);
    console.log(`Total leaves: ${leaves.length}`);
    console.log(`Proof count: ${proofs.length}`);

    return merkleData;
}

function parseArgs() {
    const args = process.argv.slice(2);
    let inputFile = PROCESSED_DIPLOMAS_FILE;
    let targetDepths = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    let outputOverride = null;

    if (args.length === 0) {
        return { inputFile, targetDepths, outputOverride };
    }

    const isDepth = (value) => /^\d+$/.test(value);

    if (isDepth(args[0])) {
        targetDepths = [parseInt(args[0], 10)];
        if (args[1] && !isDepth(args[1])) {
            inputFile = path.resolve(args[1]);
        }
        if (args[2]) {
            outputOverride = path.resolve(args[2]);
        }
    } else {
        inputFile = path.resolve(args[0]);
        if (args[1]) {
            if (!isDepth(args[1])) {
                throw new Error('Depth must be an integer, e.g. 11');
            }
            targetDepths = [parseInt(args[1], 10)];
        }
        if (args[2]) {
            outputOverride = path.resolve(args[2]);
        }
    }

    return { inputFile, targetDepths, outputOverride };
}

async function main() {
    const { inputFile, targetDepths, outputOverride } = parseArgs();

    if (targetDepths.some((d) => Number.isNaN(d))) {
        throw new Error('Depth must be an integer, e.g. 11');
    }

    if (!fs.existsSync(inputFile)) {
        throw new Error(`Input file not found: ${inputFile}`);
    }

    fs.mkdirSync(merkleTreesDir, { recursive: true });

    for (const depth of targetDepths) {
        try {
            const outputFile = outputOverride || merkleTreeDepthFile(depth);
            const t0 = performance.now();
            await createMerkleTreeWithDepth(depth, inputFile, outputFile);
            const sec = (performance.now() - t0) / 1000;
            console.log(`Merkle tree depth ${depth} built in ${sec.toFixed(3)} s`);
        } catch (error) {
            console.error(`Failed to build Merkle tree at depth ${depth}:`, error.message || error);
            process.exitCode = 1;
        }
    }

    console.log('\n=== Finished building Merkle trees ===');
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});

module.exports = { createMerkleTreeWithDepth };
