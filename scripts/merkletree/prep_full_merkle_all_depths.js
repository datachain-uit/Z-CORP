/**
 * Build full Merkle trees (depths 5-15) with exactly 2^depth real leaves — no zero padding.
 *
 * Pipeline per depth:
 *   1. generate_min_diploma_samples.js  -> data/merkle-trees/diploma_samples_min_{2^D}.json
 *   2. prepare_diploma_data.js          -> data/merkle-trees/processed_diplomas_{2^D}.json
 *   3. create_merkle_tree_depth.js      -> data/merkle-trees/merkle_tree_data_depth_{D}.json
 *
 * Usage:
 *   node scripts/merkletree/prep_full_merkle_all_depths.js
 *   node scripts/merkletree/prep_full_merkle_all_depths.js 11
 *   DEPTHS=5,6,7 node scripts/merkletree/prep_full_merkle_all_depths.js
 *
 *   SKIP_SAMPLES=1  — reuse existing diploma_samples_min_{N}.json
 *   SKIP_PROCESS=1  — reuse existing processed_diplomas_{N}.json
 *   SKIP_MERKLE=1   — skip Merkle build (samples + process only)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { performance } = require('perf_hooks');
const {
    projectRoot,
    merkleTreesDir,
    DIPLOMA_SAMPLES_FILE,
    leafCountForDepth,
    diplomaSamplesMinFile,
    processedDiplomasFileForLeafCount,
    merkleTreeDepthFile,
} = require('./paths');

const DEFAULT_DEPTHS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function parseDepths() {
    if (process.env.DEPTHS) {
        return process.env.DEPTHS.split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((d) => !Number.isNaN(d));
    }

    const arg = process.argv[2];
    if (arg && /^\d+$/.test(arg)) {
        return [parseInt(arg, 10)];
    }

    return DEFAULT_DEPTHS;
}

function runNode(scriptArgs, env = {}) {
    execSync(`node ${scriptArgs}`, {
        cwd: projectRoot,
        stdio: 'inherit',
        env: { ...process.env, ...env },
    });
}

function validateProcessedFile(processedPath, leafCount) {
    const rows = JSON.parse(fs.readFileSync(processedPath, 'utf8'));

    if (!Array.isArray(rows)) {
        throw new Error(`${processedPath}: expected a JSON array`);
    }
    if (rows.length !== leafCount) {
        throw new Error(
            `${processedPath}: expected ${leafCount} records, got ${rows.length}. ` +
                'Zero-padding would occur in create_merkle_tree_depth.js — aborting.'
        );
    }

    const requiredFields = ['nameHash', 'majorCode', 'studentId', 'issueDate', 'leafHash'];
    for (let i = 0; i < rows.length; i++) {
        for (const field of requiredFields) {
            if (rows[i][field] === undefined || rows[i][field] === null) {
                throw new Error(`${processedPath}: row ${i} missing field "${field}"`);
            }
        }
    }

    const studentIds = new Set(rows.map((r) => r.studentId));
    if (studentIds.size !== rows.length) {
        throw new Error(`${processedPath}: duplicate studentId values detected`);
    }
}

function validateMerkleFile(merklePath, depth, leafCount) {
    const data = JSON.parse(fs.readFileSync(merklePath, 'utf8'));

    if (data.depth !== depth) {
        throw new Error(`${merklePath}: depth ${data.depth} !== expected ${depth}`);
    }
    if (data.realLeaves !== leafCount) {
        throw new Error(
            `${merklePath}: realLeaves ${data.realLeaves} !== expected ${leafCount}`
        );
    }
    if (data.totalLeaves !== leafCount) {
        throw new Error(
            `${merklePath}: totalLeaves ${data.totalLeaves} !== ${leafCount} — ` +
                'tree was built with zero-padded leaves'
        );
    }
    if (!Array.isArray(data.proofs) || data.proofs.length !== leafCount) {
        throw new Error(
            `${merklePath}: expected ${leafCount} proofs, got ${data.proofs?.length ?? 0}`
        );
    }
    if (data.proofs[0].pathIndices.length !== depth) {
        throw new Error(
            `${merklePath}: proof path length ${data.proofs[0].pathIndices.length} !== depth ${depth}`
        );
    }
    if (!data.root) {
        throw new Error(`${merklePath}: missing root`);
    }
}

function prepareDepth(depth) {
    const leafCount = leafCountForDepth(depth);
    const samplesPath = diplomaSamplesMinFile(leafCount);
    const processedPath = processedDiplomasFileForLeafCount(leafCount);
    const merklePath = merkleTreeDepthFile(depth);

    console.log(`\n${'='.repeat(72)}`);
    console.log(`Depth ${depth} | ${leafCount} real leaves (2^${depth}) | no zero padding`);
    console.log('='.repeat(72));

    if (process.env.SKIP_SAMPLES !== '1') {
        console.log(`\n[1/3] Raw samples -> ${path.relative(projectRoot, samplesPath)}`);
        runNode(`scripts/merkletree/generate_min_diploma_samples.js --depth ${depth}`);
        if (!fs.existsSync(samplesPath)) {
            throw new Error(`Missing ${samplesPath} after sample generation`);
        }
    } else {
        console.log(`\n[1/3] SKIP_SAMPLES=1 — reusing ${path.basename(samplesPath)}`);
        if (!fs.existsSync(samplesPath)) {
            throw new Error(`SKIP_SAMPLES=1 but file not found: ${samplesPath}`);
        }
    }

    if (process.env.SKIP_PROCESS !== '1') {
        console.log(`\n[2/3] Process credentials -> ${path.relative(projectRoot, processedPath)}`);
        runNode(
            `scripts/setup/prepare_diploma_data.js "${samplesPath}" "${processedPath}"`,
            { DETERMINISTIC_MAJOR: '1' }
        );
    } else {
        console.log(`\n[2/3] SKIP_PROCESS=1 — reusing ${path.basename(processedPath)}`);
    }

    if (!fs.existsSync(processedPath)) {
        throw new Error(`Missing ${processedPath}`);
    }
    validateProcessedFile(processedPath, leafCount);
    console.log(`      OK: ${leafCount} processed credentials (unique studentId)`);

    if (process.env.SKIP_MERKLE === '1') {
        console.log('\n[3/3] SKIP_MERKLE=1 — Merkle build skipped');
        return { depth, leafCount, merklePath, skippedMerkle: true };
    }

    console.log(`\n[3/3] Merkle tree -> ${path.relative(projectRoot, merklePath)}`);
    const t0 = performance.now();
    runNode(
        `scripts/merkletree/create_merkle_tree_depth.js ${depth} "${processedPath}"`,
        { NO_ZERO_PAD: '1' }
    );
    const sec = (performance.now() - t0) / 1000;

    if (!fs.existsSync(merklePath)) {
        throw new Error(`Missing ${merklePath} after Merkle build`);
    }
    validateMerkleFile(merklePath, depth, leafCount);

    console.log(`      OK: root validated, no zero padding (${sec.toFixed(3)} s)`);
    return { depth, leafCount, merklePath, seconds: sec };
}

function main() {
    if (!fs.existsSync(DIPLOMA_SAMPLES_FILE)) {
        throw new Error(
            `Missing seed file: ${DIPLOMA_SAMPLES_FILE}\n` +
                'Add diploma_samples.json under data/ before running this script.'
        );
    }

    fs.mkdirSync(merkleTreesDir, { recursive: true });

    const depths = parseDepths();
    if (depths.length === 0) {
        throw new Error('No depths to process. Use DEPTHS=5,6,7 or pass a single depth argument.');
    }
    if (depths.some((d) => d < 5 || d > 15)) {
        throw new Error('Supported depths: 5..15');
    }

    console.log('Full Merkle prep (real leaves only, no zero padding)');
    console.log('Output directory:', merkleTreesDir);
    console.log('Depths:', depths.join(', '));

    const results = [];
    const failures = [];

    for (const depth of depths) {
        try {
            results.push(prepareDepth(depth));
        } catch (err) {
            failures.push({ depth, error: err.message });
            console.error(`\nERROR: depth ${depth} failed: ${err.message}`);
        }
    }

    console.log(`\n${'='.repeat(72)}`);
    console.log('Summary');
    console.log('='.repeat(72));
    console.log('Depth | Leaves | Merkle file                              | Status');
    console.log('------|--------|------------------------------------------|--------');

    for (const r of results) {
        const status = r.skippedMerkle
            ? 'samples+process only'
            : `${r.seconds.toFixed(2)}s`;
        console.log(
            `${String(r.depth).padStart(5)} | ${String(r.leafCount).padStart(6)} | ${path.basename(r.merklePath).padEnd(40)} | ${status}`
        );
    }

    for (const f of failures) {
        console.log(
            `${String(f.depth).padStart(5)} | ${'n/a'.padStart(6)} | ${'n/a'.padEnd(40)} | FAILED: ${f.error}`
        );
    }

    if (failures.length > 0) {
        process.exit(1);
    }

    console.log(
        '\nDone. All Merkle trees use only real leaves (totalLeaves === realLeaves).'
    );
}

main();
