const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { performance } = require('perf_hooks');
const snarkjs = require('snarkjs');
const {
    projectRoot,
    provingResultsDir,
    leafCountForDepth,
    processedDiplomasFileForLeafCount,
    resolveMerkleTreeFile,
    inputDepthFile,
    wasmDepthCandidates,
    plonkZkeyDepthFile,
    plonkVkeyDepthFile,
    plonkWitnessDepthFile,
    plonkProofDepthFile,
    plonkPublicDepthFile,
    plonkZkeysDir,
    plonkVkeysDir,
    plonkWitnessDir,
    plonkPublicProofDir,
} = require('../setup/paths');

const DEPTHS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function parseArgs() {
    const args = process.argv.slice(2);
    let index = 0;
    let depths = [...DEPTHS];
    let from = null;
    let to = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--index' && args[i + 1]) {
            index = parseInt(args[++i], 10);
        } else if (arg === '--depths' && args[i + 1]) {
            depths = args[++i]
                .split(',')
                .map((value) => parseInt(value.trim(), 10));
        } else if (arg === '--from' && args[i + 1]) {
            from = parseInt(args[++i], 10);
        } else if (arg === '--to' && args[i + 1]) {
            to = parseInt(args[++i], 10);
        } else if (/^\d+$/.test(arg)) {
            index = parseInt(arg, 10);
        }
    }

    if (from !== null && to !== null) {
        depths = [];
        for (let depth = from; depth <= to; depth++) {
            depths.push(depth);
        }
    }

    if (Number.isNaN(index) || depths.some((depth) => Number.isNaN(depth))) {
        throw new Error('index and depths must be valid integers.');
    }

    return { index, depths };
}

function formatTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return (
        `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
        `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
}

function buildResultsPath(depths, index) {
    const minDepth = Math.min(...depths);
    const maxDepth = Math.max(...depths);
    const filename = `${formatTimestamp()}-depth${minDepth}-${maxDepth}-plonk-index${index}.csv`;
    return path.join(provingResultsDir, filename);
}

function csvEscape(value) {
    const text = String(value);
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

const TABLE_COLUMNS = [
    { key: 'depth', header: 'Depth' },
    { key: 'input_s', header: 'Input(s)' },
    { key: 'witness_s', header: 'Witness(s)' },
    { key: 'prove_s', header: 'Prove(s)' },
    { key: 'verify_s', header: 'Verify(s)' },
    { key: 'total_s', header: 'Total(s)' },
    { key: 'status', header: 'Status' },
];

function writeCsv(filePath, rows) {
    const lines = [TABLE_COLUMNS.map((column) => column.header).join(',')];

    for (const row of rows) {
        lines.push(TABLE_COLUMNS.map((column) => csvEscape(row[column.key])).join(','));
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function logStep(depth, message) {
    console.log(`  [depth ${depth}] ${message}`);
}

function printTable(rows) {
    const widths = TABLE_COLUMNS.map((column) => {
        const values = rows.map((row) => String(row[column.key]));
        return Math.max(column.header.length, ...values.map((value) => value.length));
    });

    const separator = `+-${widths.map((width) => '-'.repeat(width)).join('-+-')}-+`;
    const headerLine = `| ${TABLE_COLUMNS.map((column, index) =>
        column.header.padEnd(widths[index])
    ).join(' | ')} |`;
    const bodyLines = rows.map((row) => {
        return `| ${TABLE_COLUMNS.map((column, index) =>
            String(row[column.key]).padEnd(widths[index])
        ).join(' | ')} |`;
    });

    console.log(separator);
    console.log(headerLine);
    console.log(separator);
    for (const line of bodyLines) {
        console.log(line);
    }
    console.log(separator);
}

function ensureFileExists(filePath, message) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`${message}\nMissing: ${filePath}`);
    }
}

function resolveWasmPath(depth) {
    const candidates = wasmDepthCandidates(depth);
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) {
        throw new Error(
            `Missing wasm for depth ${depth}. Run compile_depth_circuits.js first.\n` +
                `Checked:\n${candidates.map((candidate) => `  - ${candidate}`).join('\n')}`
        );
    }
    return found;
}

async function exportPlonkVKeyIfNeeded(depth, zkeyPath, vkeyPath) {
    if (fs.existsSync(vkeyPath)) {
        return JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
    }

    logStep(depth, `exporting Plonk verification key from ${path.basename(zkeyPath)}...`);
    const vkey = await snarkjs.zKey.exportVerificationKey(zkeyPath);
    fs.writeFileSync(vkeyPath, JSON.stringify(vkey, null, 2), 'utf8');
    return vkey;
}

function generateInput(depth, index) {
    execSync(`node scripts/setup/generate_input_depth.js ${depth} ${index}`, {
        cwd: projectRoot,
        stdio: 'pipe',
    });
}

async function benchmarkDepth(depth, index) {
    const processedFile = processedDiplomasFileForLeafCount(leafCountForDepth(depth));
    const merkleFile = resolveMerkleTreeFile(depth);

    ensureFileExists(processedFile, `Missing processed credentials for depth ${depth}`);
    ensureFileExists(merkleFile, `Missing merkle_tree_data_depth_${depth}.json`);

    const wasmPath = resolveWasmPath(depth);
    const zkeyPath = plonkZkeyDepthFile(depth);
    const vkeyPath = plonkVkeyDepthFile(depth);
    const inputFile = inputDepthFile(depth, index);
    const witnessFile = plonkWitnessDepthFile(depth, index);
    const proofFile = plonkProofDepthFile(depth, index);
    const publicFile = plonkPublicDepthFile(depth, index);

    fs.mkdirSync(plonkZkeysDir, { recursive: true });
    fs.mkdirSync(plonkVkeysDir, { recursive: true });
    fs.mkdirSync(plonkWitnessDir, { recursive: true });
    fs.mkdirSync(plonkPublicProofDir, { recursive: true });

    ensureFileExists(
        zkeyPath,
        `Missing Plonk zkey for depth ${depth}. Run prove_all_depths-plonk.js first, e.g.:\n` +
            `  node scripts/proving/prove_all_depths-plonk.js --from ${depth} --to ${depth}`
    );

    const row = {
        depth,
        input_s: '',
        witness_s: '',
        prove_s: '',
        verify_s: '',
        total_s: '',
        status: 'fail',
    };

    const totalStart = performance.now();

    try {
        logStep(depth, 'generating input...');
        const inputStart = performance.now();
        generateInput(depth, index);
        ensureFileExists(inputFile, 'Input file was not created');
        row.input_s = ((performance.now() - inputStart) / 1000).toFixed(3);

        const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

        logStep(depth, 'calculating witness...');
        const witnessStart = performance.now();
        await snarkjs.wtns.calculate(input, wasmPath, witnessFile);
        row.witness_s = ((performance.now() - witnessStart) / 1000).toFixed(3);

        logStep(depth, 'proving (this may take a while)...');
        const proveStart = performance.now();
        const { proof, publicSignals } = await snarkjs.plonk.prove(zkeyPath, witnessFile);
        row.prove_s = ((performance.now() - proveStart) / 1000).toFixed(3);

        logStep(depth, 'writing proof files...');
        fs.writeFileSync(proofFile, JSON.stringify(proof, null, 2), 'utf8');
        fs.writeFileSync(publicFile, JSON.stringify(publicSignals, null, 2), 'utf8');

        logStep(depth, 'verifying proof...');
        const vkey = await exportPlonkVKeyIfNeeded(depth, zkeyPath, vkeyPath);
        const verifyStart = performance.now();
        const valid = await snarkjs.plonk.verify(vkey, publicSignals, proof);
        row.verify_s = ((performance.now() - verifyStart) / 1000).toFixed(3);

        if (!valid) {
            throw new Error('PLONK verification failed');
        }

        row.status = 'success';
    } catch (error) {
        row.status = 'fail';
        throw error;
    } finally {
        row.total_s = ((performance.now() - totalStart) / 1000).toFixed(3);
    }

    return row;
}

async function main() {
    const { index, depths } = parseArgs();
    const resultsPath = buildResultsPath(depths, index);

    console.log('=== PLONK proving benchmark ===');
    console.log('Depths:', depths.join(', '));
    console.log('Diploma index:', index);
    console.log('Results file:', resultsPath);
    console.log('');

    const rows = [];

    for (const depth of depths) {
        console.log(`\nBenchmarking depth ${depth}...`);
        try {
            const row = await benchmarkDepth(depth, index);
            rows.push(row);
            writeCsv(resultsPath, rows);
            console.log(`  [depth ${depth}] done (${row.status}) -> CSV updated`);
        } catch (error) {
            console.error(`  [depth ${depth}] failed:`, error.message || error);
            rows.push({
                depth,
                input_s: '',
                witness_s: '',
                prove_s: '',
                verify_s: '',
                total_s: '',
                status: 'fail',
            });
            writeCsv(resultsPath, rows);
            console.log(`  [depth ${depth}] fail recorded -> CSV updated`);
        }
    }

    console.log('\nPLONK proving times:\n');
    printTable(rows);
    writeCsv(resultsPath, rows);

    console.log('\nCSV saved:', resultsPath);

    return rows.some((row) => row.status !== 'success') ? 1 : 0;
}

main()
    .then((exitCode) => {
        process.exit(exitCode);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
