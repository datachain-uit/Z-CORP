/**
 * Generate circuit input files for depths 5-15 using leaf index 0 (default).
 *
 *   node scripts/setup/generate_input_all_depths.js
 *   node scripts/setup/generate_input_all_depths.js --index 0
 *   node scripts/setup/generate_input_all_depths.js --from 8 --to 12
 *
 * Output per depth:
 *   data/inputs/input_depth_{depth}_index_{index}.json
 */
const { generateInputForDepth } = require('./generate_input_depth');
const { inputDepthFile } = require('./paths');

const DEFAULT_DEPTHS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function parseArgs() {
    const args = process.argv.slice(2);
    let from = 5;
    let to = 15;
    let index = 0;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--from' && args[i + 1]) {
            from = parseInt(args[++i], 10);
        } else if (arg === '--to' && args[i + 1]) {
            to = parseInt(args[++i], 10);
        } else if (arg === '--index' && args[i + 1]) {
            index = parseInt(args[++i], 10);
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
    if (Number.isNaN(index) || index < 0) {
        throw new Error(`Invalid index: ${index}`);
    }

    const depths = [];
    for (let depth = from; depth <= to; depth++) {
        depths.push(depth);
    }

    return { depths, index };
}

function printHelp() {
    console.log(`Usage: node scripts/setup/generate_input_all_depths.js [options]

Generate circuit input JSON for each depth (default: 5..15, leaf index 0).

Options:
  --from <n>     First depth (default: 5)
  --to <n>       Last depth (default: 15)
  --index <n>    Leaf index to use for every depth (default: 0)
  -h, --help     Show this help

Examples:
  node scripts/setup/generate_input_all_depths.js
  node scripts/setup/generate_input_all_depths.js --from 11 --to 11 --index 0
`);
}

function main() {
    const { depths, index } = parseArgs();

    console.log('=== Generate circuit inputs for all depths ===');
    console.log('Depths:', depths.join(', '));
    console.log('Leaf index:', index);

    const results = [];
    const failures = [];

    for (const depth of depths) {
        try {
            const result = generateInputForDepth(depth, index);
            results.push(result);
            console.log(`OK depth ${depth} -> ${result.outputFile}`);
        } catch (error) {
            failures.push({ depth, error: error.message || String(error) });
            console.error(`ERROR depth ${depth}: ${error.message || error}`);
        }
    }

    console.log('\n=== Summary ===');
    console.log('Depth | Output file');
    console.log('------|------------------------------------------');

    for (const result of results) {
        console.log(
            `${String(result.depth).padStart(5)} | ${result.outputFile}`
        );
    }

    for (const failure of failures) {
        console.log(
            `${String(failure.depth).padStart(5)} | FAILED: ${failure.error}`
        );
    }

    if (failures.length > 0) {
        process.exit(1);
    }

    console.log(`\nDone. Created ${results.length} input file(s) at index ${index}.`);
    console.log('Pattern:', inputDepthFile('<depth>', index).replace('<depth>', '{depth}'));
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
