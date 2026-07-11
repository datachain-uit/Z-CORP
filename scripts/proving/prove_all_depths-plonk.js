/**
 * Full PLONK proving pipeline for full Merkle trees (depths 5-15, leaf index 0).
 *
 *   1. generate_input_all_depths.js
 *   2. snarkjs plonk setup -> plonk zkey (per depth)
 *   3. generate_witness.js (circom) for each depth
 *   4. snarkjs plonk prove -> proof + public JSON
 *   5. snarkjs zkey export verificationkey -> plonk vkey JSON
 *   6. snarkjs plonk verify (sanity check)
 *
 * Usage:
 *   node scripts/proving/prove_all_depths-plonk.js
 *   node scripts/proving/prove_all_depths-plonk.js --from 11 --to 11
 *   node scripts/proving/prove_all_depths-plonk.js --skip-inputs --skip-setup
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { performance } = require('perf_hooks');
const {
    projectRoot,
    defaultPtauFile,
    plonkZkeysDir,
    plonkVkeysDir,
    plonkWitnessDir,
    plonkPublicProofDir,
    inputDepthFile,
    plonkWitnessDepthFile,
    plonkProofDepthFile,
    plonkPublicDepthFile,
    plonkVkeyDepthFile,
    plonkZkeyDepthFile,
    circuitDepthR1csFile,
    wasmDepthCandidates,
    generateWitnessScript,
} = require('../setup/paths');

const DEFAULT_DEPTHS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const snarkjsCli = path.join(projectRoot, 'node_modules/snarkjs/build/cli.cjs');

function quote(value) {
    return `"${String(value).replace(/"/g, '\\"')}"`;
}

function parseArgs() {
    const args = process.argv.slice(2);
    let from = 5;
    let to = 15;
    let index = 0;
    let skipInputs = false;
    let skipSetup = false;
    let skipWitness = false;
    let skipProve = false;
    let skipVkey = false;
    let skipVerify = false;
    let ptauFile = defaultPtauFile;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--from' && args[i + 1]) {
            from = parseInt(args[++i], 10);
        } else if (arg === '--to' && args[i + 1]) {
            to = parseInt(args[++i], 10);
        } else if (arg === '--index' && args[i + 1]) {
            index = parseInt(args[++i], 10);
        } else if (arg === '--ptau' && args[i + 1]) {
            ptauFile = path.resolve(args[++i]);
        } else if (arg === '--skip-inputs') {
            skipInputs = true;
        } else if (arg === '--skip-setup') {
            skipSetup = true;
        } else if (arg === '--skip-witness') {
            skipWitness = true;
        } else if (arg === '--skip-prove') {
            skipProve = true;
        } else if (arg === '--skip-vkey') {
            skipVkey = true;
        } else if (arg === '--skip-verify') {
            skipVerify = true;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`);
        }
    }

    if (Number.isNaN(from) || Number.isNaN(to) || from > to) {
        throw new Error(`Invalid depth range: ${from}..${to}`);
    }

    const depths = [];
    for (let depth = from; depth <= to; depth++) {
        depths.push(depth);
    }

    return { depths, index, skipInputs, skipSetup, skipWitness, skipProve, skipVkey, skipVerify, ptauFile };
}

function printHelp() {
    console.log(`Usage: node scripts/proving/prove_all_depths-plonk.js [options]

Run the full PLONK pipeline for depths 5..15 (default), leaf index 0.

Options:
  --from <n>       First depth (default: 5)
  --to <n>         Last depth (default: 15)
  --index <n>      Leaf index (default: 0)
  --ptau <path>    Powers of tau file (default: pot16_final.ptau)
  --skip-inputs    Skip step 1 (generate circuit inputs)
  --skip-setup     Skip step 2 (plonk setup / zkey generation)
  --skip-witness   Skip step 3 (witness generation)
  --skip-prove     Skip step 4 (plonk prove)
  --skip-vkey      Skip step 5 (export verification key)
  --skip-verify    Skip step 6 (local plonk verify)
  -h, --help       Show this help
`);
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function runNode(scriptArgs) {
    execSync(`node ${scriptArgs}`, { cwd: projectRoot, stdio: 'inherit' });
}

function runSnarkjs(args) {
    execSync(`node ${quote(snarkjsCli)} ${args}`, { cwd: projectRoot, stdio: 'inherit' });
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
            `Missing wasm for depth ${depth}. Run setup:circuits first.\n` +
                candidates.map((candidate) => `  - ${candidate}`).join('\n')
        );
    }
    return found;
}

function resolveWitnessGenerator(depth) {
    const wasmPath = resolveWasmPath(depth);
    const witnessScript = path.join(path.dirname(wasmPath), 'generate_witness.js');
    if (!fs.existsSync(witnessScript)) {
        const fallback = generateWitnessScript(depth);
        if (fs.existsSync(fallback)) {
            return { wasmPath, witnessScript: fallback };
        }
        throw new Error(`Missing generate_witness.js for depth ${depth}`);
    }
    return { wasmPath, witnessScript };
}

function proveDepth(depth, index, options) {
    const inputFile = inputDepthFile(depth, index);
    const r1csFile = circuitDepthR1csFile(depth);
    const zkeyFile = plonkZkeyDepthFile(depth);
    const witnessFile = plonkWitnessDepthFile(depth, index);
    const proofFile = plonkProofDepthFile(depth, index);
    const publicFile = plonkPublicDepthFile(depth, index);
    const vkeyFile = plonkVkeyDepthFile(depth);

    const timings = {
        depth,
        setup_s: '',
        witness_s: '',
        prove_s: '',
        vkey_s: '',
        verify_s: '',
        status: 'fail',
    };

    console.log(`\n${'='.repeat(72)}`);
    console.log(`Depth ${depth} | leaf index ${index}`);
    console.log('='.repeat(72));

    ensureFileExists(inputFile, 'Input file not found');
    ensureFileExists(r1csFile, 'R1CS file not found');
    ensureFileExists(options.ptauFile, 'Powers of tau file not found');

    if (!options.skipSetup) {
        console.log('\n[2/6] PLONK setup');
        console.log('  r1cs: ', r1csFile);
        console.log('  ptau: ', options.ptauFile);
        console.log('  zkey: ', zkeyFile);

        const t0 = performance.now();
        runSnarkjs(
            `plonk setup ${quote(r1csFile)} ${quote(options.ptauFile)} ${quote(zkeyFile)}`
        );
        timings.setup_s = ((performance.now() - t0) / 1000).toFixed(3);
        ensureFileExists(zkeyFile, 'PLONK zkey was not created');
        console.log(`  OK (${timings.setup_s} s)`);
    } else {
        ensureFileExists(zkeyFile, 'PLONK zkey not found (run without --skip-setup)');
    }

    const { wasmPath, witnessScript } = resolveWitnessGenerator(depth);

    if (!options.skipWitness) {
        console.log('\n[3/6] Generate witness');
        console.log('  script:', witnessScript);
        console.log('  wasm:  ', wasmPath);
        console.log('  input: ', inputFile);
        console.log('  output:', witnessFile);

        const t0 = performance.now();
        runNode(
            `${quote(witnessScript)} ${quote(wasmPath)} ${quote(inputFile)} ${quote(witnessFile)}`
        );
        timings.witness_s = ((performance.now() - t0) / 1000).toFixed(3);
        ensureFileExists(witnessFile, 'Witness file was not created');
        console.log(`  OK (${timings.witness_s} s)`);
    } else {
        ensureFileExists(witnessFile, 'Witness file not found (use without --skip-witness)');
    }

    if (!options.skipProve) {
        console.log('\n[4/6] PLONK prove');
        console.log('  zkey:  ', zkeyFile);
        console.log('  wtns:  ', witnessFile);
        console.log('  proof: ', proofFile);
        console.log('  public:', publicFile);

        const t0 = performance.now();
        runSnarkjs(
            `plonk prove ${quote(zkeyFile)} ${quote(witnessFile)} ${quote(proofFile)} ${quote(publicFile)}`
        );
        timings.prove_s = ((performance.now() - t0) / 1000).toFixed(3);
        ensureFileExists(proofFile, 'Proof file was not created');
        ensureFileExists(publicFile, 'Public signals file was not created');
        console.log(`  OK (${timings.prove_s} s)`);
    } else {
        ensureFileExists(proofFile, 'Proof file not found');
        ensureFileExists(publicFile, 'Public file not found');
    }

    if (!options.skipVkey) {
        console.log('\n[5/6] Export verification key');
        console.log('  zkey:', zkeyFile);
        console.log('  vkey:', vkeyFile);

        const t0 = performance.now();
        runSnarkjs(`zkey export verificationkey ${quote(zkeyFile)} ${quote(vkeyFile)}`);
        timings.vkey_s = ((performance.now() - t0) / 1000).toFixed(3);
        ensureFileExists(vkeyFile, 'Verification key file was not created');
        console.log(`  OK (${timings.vkey_s} s)`);
    } else {
        ensureFileExists(vkeyFile, 'Vkey file not found');
    }

    if (!options.skipVerify) {
        console.log('\n[6/6] PLONK verify (local sanity check)');
        const t0 = performance.now();
        runSnarkjs(
            `plonk verify ${quote(vkeyFile)} ${quote(publicFile)} ${quote(proofFile)}`
        );
        timings.verify_s = ((performance.now() - t0) / 1000).toFixed(3);
        console.log(`  OK (${timings.verify_s} s)`);
    }

    timings.status = 'success';
    return timings;
}

function main() {
    if (!fs.existsSync(snarkjsCli)) {
        throw new Error(`Missing snarkjs CLI: ${snarkjsCli}`);
    }

    const options = parseArgs();
    ensureDir(plonkZkeysDir);
    ensureDir(plonkVkeysDir);
    ensureDir(plonkWitnessDir);
    ensureDir(plonkPublicProofDir);

    console.log('=== PLONK prove-all pipeline ===');
    console.log('Depths:', options.depths.join(', '));
    console.log('Leaf index:', options.index);
    console.log('Artifacts:');
    console.log('  r1cs/wasm:', path.join(projectRoot, 'data/zkp-circuits'));
    console.log('  inputs:   ', path.join(projectRoot, 'data/inputs'));
    console.log('  zkeys:    ', plonkZkeysDir);
    console.log('  witness:  ', plonkWitnessDir);
    console.log('  proof:    ', plonkPublicProofDir);
    console.log('  vkeys:    ', plonkVkeysDir);

    if (!options.skipInputs) {
        console.log('\n[1/6] Generate circuit inputs for all depths');
        runNode(
            `scripts/setup/generate_input_all_depths.js --from ${options.depths[0]} --to ${options.depths[options.depths.length - 1]} --index ${options.index}`
        );
    } else {
        console.log('\n[1/6] SKIP — reusing existing inputs');
    }

    const results = [];
    const failures = [];

    for (const depth of options.depths) {
        try {
            results.push(proveDepth(depth, options.index, options));
        } catch (error) {
            failures.push({ depth, error: error.message || String(error) });
            console.error(`\nERROR depth ${depth}: ${error.message || error}`);
        }
    }

    console.log(`\n${'='.repeat(72)}`);
    console.log('Summary');
    console.log('='.repeat(72));
    console.log('Depth | Setup(s) | Witness(s) | Prove(s) | VKey(s) | Verify(s) | Status');
    console.log('------|----------|------------|----------|---------|-----------|--------');

    for (const row of results) {
        console.log(
            `${String(row.depth).padStart(5)} | ${String(row.setup_s || 'n/a').padStart(8)} | ${String(row.witness_s || 'n/a').padStart(10)} | ${String(row.prove_s || 'n/a').padStart(8)} | ${String(row.vkey_s || 'n/a').padStart(7)} | ${String(row.verify_s || 'n/a').padStart(9)} | ${row.status}`
        );
    }

    for (const failure of failures) {
        console.log(
            `${String(failure.depth).padStart(5)} | ${'n/a'.padStart(8)} | ${'n/a'.padStart(10)} | ${'n/a'.padStart(8)} | ${'n/a'.padStart(7)} | ${'n/a'.padStart(9)} | FAILED`
        );
        console.log(`       ${failure.error}`);
    }

    if (failures.length > 0) {
        process.exit(1);
    }

    console.log('\nDone. All depths proved and verified locally with PLONK.');
    console.log('Example outputs:');
    console.log(`  ${plonkZkeyDepthFile(11)}`);
    console.log(`  ${plonkProofDepthFile(11, options.index)}`);
    console.log(`  ${plonkPublicDepthFile(11, options.index)}`);
    console.log(`  ${plonkVkeyDepthFile(11)}`);
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
