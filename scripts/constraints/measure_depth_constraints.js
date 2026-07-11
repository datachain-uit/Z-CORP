const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const snarkjs = require('snarkjs');
const {
    constraintsResultsDir,
    circuitDepthFile,
    circuitDepthOutputDir,
    circuitDepthR1csFile,
} = require('../setup/paths');
const { countPlonkConstraints, groth16DomainSize } = require('./plonk_constraint_count');

const DEPTHS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const DEFAULT_DEPTHS = DEPTHS;

function parseArgs() {
    const args = process.argv.slice(2);
    let depths = [...DEFAULT_DEPTHS];
    let skipCompile = false;
    let circomBin = process.env.CIRCOM_BIN || 'circom';

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--skip-compile') {
            skipCompile = true;
        } else if (arg === '--circom' && args[i + 1]) {
            circomBin = args[++i];
        } else if (arg === '--depths' && args[i + 1]) {
            depths = args[++i]
                .split(',')
                .map((value) => parseInt(value.trim(), 10));
        } else if (/^\d+$/.test(arg)) {
            depths = [parseInt(arg, 10)];
        }
    }

    if (depths.some((depth) => Number.isNaN(depth))) {
        throw new Error('Depth values must be integers, e.g. 5 or --depths 5,6,7');
    }

    return { depths, skipCompile, circomBin };
}

function formatTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return (
        `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
        `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
}

function buildResultsPath(depths) {
    const minDepth = Math.min(...depths);
    const maxDepth = Math.max(...depths);
    const filename = `${formatTimestamp()}-depth${minDepth}-${maxDepth}-constraints.csv`;
    return path.join(constraintsResultsDir, filename);
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
    { key: 'groth16_constraints', header: 'Groth16' },
    { key: 'plonk_constraints', header: 'PLONK' },
    { key: 'constraint_ratio', header: 'Ratio' },
    { key: 'groth16_domain_size', header: 'G16 Domain' },
    { key: 'plonk_domain_size', header: 'PLONK Domain' },
    { key: 'plonk_additions', header: 'PLONK Add.' },
    { key: 'compile_time_ms', header: 'Compile(ms)' },
];

function writeCsv(filePath, rows) {
    const lines = [TABLE_COLUMNS.map((column) => column.header).join(',')];

    for (const row of rows) {
        lines.push(
            TABLE_COLUMNS.map((column) => csvEscape(row[column.key])).join(',')
        );
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function formatTableCell(value) {
    return String(value);
}

function printTable(rows) {
    const widths = TABLE_COLUMNS.map((column) => {
        const values = rows.map((row) => formatTableCell(row[column.key]));
        return Math.max(column.header.length, ...values.map((value) => value.length));
    });

    const separator = `+-${widths.map((width) => '-'.repeat(width)).join('-+-')}-+`;
    const headerLine = `| ${TABLE_COLUMNS.map((column, index) =>
        column.header.padEnd(widths[index])
    ).join(' | ')} |`;
    const bodyLines = rows.map((row) => {
        return `| ${TABLE_COLUMNS.map((column, index) =>
            formatTableCell(row[column.key]).padEnd(widths[index])
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

function compileCircuit(depth, circomBin) {
    const circuitFile = circuitDepthFile(depth);
    const outputDir = circuitDepthOutputDir(depth);
    const r1csFile = circuitDepthR1csFile(depth);

    if (!fs.existsSync(circuitFile)) {
        throw new Error(
            `Missing circuit file: ${circuitFile}\n` +
                'Run: node scripts/setup/generate_depth_circuits.js'
        );
    }

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const startedAt = performance.now();
    execSync(`"${circomBin}" "${circuitFile}" --r1cs --wasm --sym -o "${outputDir}"`, {
        stdio: 'inherit',
    });
    const compileTimeMs = (performance.now() - startedAt).toFixed(2);

    if (!fs.existsSync(r1csFile)) {
        throw new Error(`R1CS file not found after compile: ${r1csFile}`);
    }

    return { r1csFile, compileTimeMs };
}

async function measureDepth(depth, options) {
    const { skipCompile, circomBin } = options;
    const r1csFile = circuitDepthR1csFile(depth);
    let compileTimeMs = '0';

    if (!skipCompile || !fs.existsSync(r1csFile)) {
        const compiled = compileCircuit(depth, circomBin);
        compileTimeMs = compiled.compileTimeMs;
    }

    const r1cs = await snarkjs.r1cs.info(r1csFile, null);
    const plonkStats = await countPlonkConstraints(r1csFile);
    const groth16Constraints = r1cs.nConstraints;
    const plonkConstraints = plonkStats.plonkConstraints;
    const ratio = (plonkConstraints / groth16Constraints).toFixed(2);

    return {
        depth,
        wires: r1cs.nVars,
        private_inputs: r1cs.nPrvInputs,
        public_inputs: r1cs.nPubInputs,
        outputs: r1cs.nOutputs,
        groth16_constraints: groth16Constraints,
        plonk_constraints: plonkConstraints,
        plonk_additions: plonkStats.plonkAdditions,
        constraint_ratio: ratio,
        groth16_domain_size: groth16DomainSize(r1cs),
        plonk_domain_size: plonkStats.plonkDomainSize,
        compile_time_ms: compileTimeMs,
        r1cs_file: r1csFile,
    };
}

async function main() {
    const { depths, skipCompile, circomBin } = parseArgs();
    const resultsPath = buildResultsPath(depths);

    console.log('=== Measuring Circom constraints (Groth16 / PLONK) ===');
    console.log('Depths:', depths.join(', '));
    console.log('Skip compile:', skipCompile);
    console.log('Results file:', resultsPath);
    console.log('Groth16 uses raw R1CS constraints.');
    console.log('PLONK counts expanded gates after snarkjs R1CS-to-PLONK conversion.\n');

    const rows = [];

    for (const depth of depths) {
        process.stdout.write(`Measuring depth ${depth}... `);
        try {
            const row = await measureDepth(depth, { skipCompile, circomBin });
            rows.push(row);
            console.log('done');
        } catch (error) {
            console.log('failed');
            console.error(`Failed at depth ${depth}:`, error.message || error);
            throw error;
        }
    }

    console.log('\nConstraint comparison (Groth16 vs PLONK):\n');
    printTable(rows);

    writeCsv(resultsPath, rows);

    console.log('\nFinished measuring constraints.');
    console.log('CSV saved:', resultsPath);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
