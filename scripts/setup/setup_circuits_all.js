/**
 * Full circuit pipeline for CredentialVerifier depths 5–15:
 *
 *   1. generate_depth_circuits.js  — create .circom files
 *   2. compile_depth_circuits.js   — compile to data/zkp-circuits/CredentialVerifier_Depth{N}/
 *   3. setup_groth16_depth.js      — Groth16 zkey + verifier contract per depth
 *
 * Usage:
 *   node scripts/setup/setup_circuits_all.js
 *   node scripts/setup/setup_circuits_all.js --from 8 --to 12
 *   node scripts/setup/setup_circuits_all.js --skip-generate --skip-compile
 *   node scripts/setup/setup_circuits_all.js --only-setup
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { projectRoot } = require('./paths');
const { setupGroth16Depth } = require('./setup_groth16_depth');

const DEFAULT_FROM = 5;
const DEFAULT_TO = 15;

function parseArgs() {
    const args = process.argv.slice(2);
    let from = DEFAULT_FROM;
    let to = DEFAULT_TO;
    let skipGenerate = false;
    let skipCompile = false;
    let skipSetup = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--from' && args[i + 1]) {
            from = parseInt(args[++i], 10);
        } else if (arg === '--to' && args[i + 1]) {
            to = parseInt(args[++i], 10);
        } else if (arg === '--skip-generate') {
            skipGenerate = true;
        } else if (arg === '--skip-compile') {
            skipCompile = true;
        } else if (arg === '--skip-setup') {
            skipSetup = true;
        } else if (arg === '--only-setup') {
            skipGenerate = true;
            skipCompile = true;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}\nRun with --help for usage.`);
        }
    }

    if (Number.isNaN(from) || Number.isNaN(to) || from > to) {
        throw new Error(`Invalid depth range: ${from}..${to}`);
    }

    const depths = [];
    for (let depth = from; depth <= to; depth++) {
        depths.push(depth);
    }

    return { depths, skipGenerate, skipCompile, skipSetup };
}

function printHelp() {
    console.log(`Usage: node scripts/setup/setup_circuits_all.js [options]

Runs the full CredentialVerifier pipeline for depths 5–15 (default).

Options:
  --from <n>        First depth (default: ${DEFAULT_FROM})
  --to <n>          Last depth (default: ${DEFAULT_TO})
  --skip-generate   Skip step 1 (generate .circom files)
  --skip-compile    Skip step 2 (compile under circuits/)
  --skip-setup      Skip step 3 (Groth16 zkey + verifier contracts)
  --only-setup      Same as --skip-generate --skip-compile
  -h, --help        Show this help

Examples:
  node scripts/setup/setup_circuits_all.js
  node scripts/setup/setup_circuits_all.js --from 11 --to 11
  node scripts/setup/setup_circuits_all.js --only-setup --from 5 --to 15
`);
}

function runScript(scriptName) {
    const scriptPath = path.join(__dirname, scriptName);
    console.log(`\n>>> Running ${scriptName}\n`);

    const result = spawnSync(process.execPath, [scriptPath], {
        cwd: projectRoot,
        stdio: 'inherit',
    });

    if (result.status !== 0) {
        throw new Error(`${scriptName} failed with exit code ${result.status ?? 'unknown'}`);
    }
}

function main() {
    const { depths, skipGenerate, skipCompile, skipSetup } = parseArgs();

    console.log('=== CredentialVerifier circuit pipeline ===');
    console.log('Depths:', depths.join(', '));
    console.log('Steps:', [
        skipGenerate ? null : 'generate',
        skipCompile ? null : 'compile',
        skipSetup ? null : 'groth16-setup',
    ]
        .filter(Boolean)
        .join(' → '));

    if (!skipGenerate) {
        runScript('generate_depth_circuits.js');
    }

    if (!skipCompile) {
        runScript('compile_depth_circuits.js');
    }

    if (!skipSetup) {
        console.log('\n>>> Groth16 setup for each depth\n');
        for (const depth of depths) {
            console.log(`\n========== Depth ${depth} / ${depths[depths.length - 1]} ==========`);
            setupGroth16Depth(depth);
        }
    }

    console.log('\n=== Pipeline finished ===');
    if (!skipSetup) {
        console.log('Groth16 artifacts per depth:');
        console.log('  data/zkp-circuits/CredentialVerifier_Depth{N}/CredentialVerifier_Depth{N}_js/*.wasm');
        console.log('  data/zkp-circuits/CredentialVerifier_Depth{N}/CredentialVerifier_Depth{N}_0001.zkey');
        console.log('  contracts/Groth16LegacyVerifierDepth{N}.sol');
    }
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
