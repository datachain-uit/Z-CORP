/**
 * Full Groth16 proving pipeline for full Merkle trees (depths 5-15, leaf index 0).
 *
 *   1. generate_input_all_depths.js
 *   2. generate_witness.js (circom) for each depth
 *   3. snarkjs groth16 prove -> proof + public JSON
 *   4. snarkjs zkey export verificationkey -> vkey JSON
 *   5. snarkjs groth16 verify (sanity check)
 *
 * Usage:
 *   node scripts/proving/prove_all_depths-groth16.js
 *   node scripts/proving/prove_all_depths-groth16.js --from 11 --to 11
 *   node scripts/proving/prove_all_depths-groth16.js --skip-inputs
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { performance } = require('perf_hooks');
const {
    projectRoot,
    groth16WitnessDir,
    groth16PublicProofDir,
    groth16VkeysDir,
    inputDepthFile,
    witnessDepthFile,
    proofDepthFile,
    publicDepthFile,
    vkeyDepthFile,
    wasmDepthCandidates,
    generateWitnessScript,
    zkeyDepthFile,
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
    let skipWitness = false;
    let skipProve = false;
    let skipVkey = false;
    let skipVerify = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--from' && args[i + 1]) {
            from = parseInt(args[++i], 10);
        } else if (arg === '--to' && args[i + 1]) {
            to = parseInt(args[++i], 10);
        } else if (arg === '--index' && args[i + 1]) {
            index = parseInt(args[++i], 10);
        } else if (arg === '--skip-inputs') {
            skipInputs = true;
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

    return { depths, index, skipInputs, skipWitness, skipProve, skipVkey, skipVerify };
}

function printHelp() {
    console.log(`Usage: node scripts/proving/prove_all_depths-groth16.js [options]

Run the full Groth16 pipeline for depths 5..15 (default), leaf index 0.

Options:
  --from <n>       First depth (default: 5)
  --to <n>         Last depth (default: 15)
  --index <n>      Leaf index (default: 0)
  --skip-inputs    Skip step 1 (generate circuit inputs)
  --skip-witness   Skip step 2 (witness generation)
  --skip-prove     Skip step 3 (groth16 prove)
  --skip-vkey      Skip step 4 (export verification key)
  --skip-verify    Skip step 5 (local groth16 verify)
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
    const witnessFile = witnessDepthFile(depth, index);
    const proofFile = proofDepthFile(depth, index);
    const publicFile = publicDepthFile(depth, index);
    const vkeyFile = vkeyDepthFile(depth);
    const zkeyFile = zkeyDepthFile(depth);

    const timings = {
        depth,
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
    ensureFileExists(zkeyFile, 'Groth16 zkey not found');

    const { wasmPath, witnessScript } = resolveWitnessGenerator(depth);

    if (!options.skipWitness) {
        console.log('\n[2/5] Generate witness');
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
        console.log('\n[3/5] Groth16 prove');
        console.log('  zkey:  ', zkeyFile);
        console.log('  wtns:  ', witnessFile);
        console.log('  proof: ', proofFile);
        console.log('  public:', publicFile);

        const t0 = performance.now();
        runSnarkjs(
            `groth16 prove ${quote(zkeyFile)} ${quote(witnessFile)} ${quote(proofFile)} ${quote(publicFile)}`
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
        console.log('\n[4/5] Export verification key');
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
        console.log('\n[5/5] Groth16 verify (local sanity check)');
        const t0 = performance.now();
        runSnarkjs(
            `groth16 verify ${quote(vkeyFile)} ${quote(publicFile)} ${quote(proofFile)}`
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
    ensureDir(groth16WitnessDir);
    ensureDir(groth16PublicProofDir);
    ensureDir(groth16VkeysDir);

    console.log('=== Groth16 prove-all pipeline ===');
    console.log('Depths:', options.depths.join(', '));
    console.log('Leaf index:', options.index);
    console.log('Artifacts:');
    console.log('  wasm/zkey:', path.join(projectRoot, 'data/zkp-circuits'));
    console.log('  inputs:   ', path.join(projectRoot, 'data/inputs'));
    console.log('  witness:  ', groth16WitnessDir);
    console.log('  proof:    ', groth16PublicProofDir);
    console.log('  vkey:     ', groth16VkeysDir);

    if (!options.skipInputs) {
        console.log('\n[1/5] Generate circuit inputs for all depths');
        runNode(
            `scripts/setup/generate_input_all_depths.js --from ${options.depths[0]} --to ${options.depths[options.depths.length - 1]} --index ${options.index}`
        );
    } else {
        console.log('\n[1/5] SKIP — reusing existing inputs');
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
    console.log('Depth | Witness(s) | Prove(s) | VKey(s) | Verify(s) | Status');
    console.log('------|------------|----------|---------|-----------|--------');

    for (const row of results) {
        console.log(
            `${String(row.depth).padStart(5)} | ${String(row.witness_s || 'n/a').padStart(10)} | ${String(row.prove_s || 'n/a').padStart(8)} | ${String(row.vkey_s || 'n/a').padStart(7)} | ${String(row.verify_s || 'n/a').padStart(9)} | ${row.status}`
        );
    }

    for (const failure of failures) {
        console.log(
            `${String(failure.depth).padStart(5)} | ${'n/a'.padStart(10)} | ${'n/a'.padStart(8)} | ${'n/a'.padStart(7)} | ${'n/a'.padStart(9)} | FAILED`
        );
        console.log(`       ${failure.error}`);
    }

    if (failures.length > 0) {
        process.exit(1);
    }

    console.log('\nDone. All depths proved and verified locally.');
    console.log('Example outputs:');
    console.log(`  ${proofDepthFile(11, options.index)}`);
    console.log(`  ${publicDepthFile(11, options.index)}`);
    console.log(`  ${vkeyDepthFile(11)}`);
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
