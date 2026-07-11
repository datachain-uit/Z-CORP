/**
 * Generate exactly 2^depth diploma samples from data/diploma_samples.json (seed templates).
 *
 *   node scripts/merkletree/generate_min_diploma_samples.js --depth 11
 *   node scripts/merkletree/generate_min_diploma_samples.js --count 4096
 */
const fs = require('fs');
const {
    DIPLOMA_SAMPLES_FILE,
    merkleTreesDir,
    leafCountForDepth,
    diplomaSamplesMinFile,
} = require('./paths');

function parseArgs() {
    const args = process.argv.slice(2);
    let depth = null;
    let count = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--depth' && args[i + 1]) {
            depth = parseInt(args[++i], 10);
        } else if (arg === '--count' && args[i + 1]) {
            count = parseInt(args[++i], 10);
        } else if (/^\d+$/.test(arg) && depth === null && count === null) {
            depth = parseInt(arg, 10);
        }
    }

    if (depth !== null && count === null) {
        count = leafCountForDepth(depth);
    }

    if (count === null || Number.isNaN(count) || count < 1) {
        throw new Error(
            'Usage: node scripts/merkletree/generate_min_diploma_samples.js --depth <5-15>\n' +
                '   or: node scripts/merkletree/generate_min_diploma_samples.js --count <N>'
        );
    }

    return { depth, count };
}

function buildSamples(seedSamples, leafCount) {
    if (!Array.isArray(seedSamples) || seedSamples.length === 0) {
        throw new Error('Seed file must contain a non-empty samples[] array.');
    }

    const samples = [];
    for (let i = 0; i < leafCount; i++) {
        const template = seedSamples[i % seedSamples.length];
        samples.push({
            last_name: template.last_name,
            first_name: `${template.first_name} ${i + 1}`,
            issue_date: template.issue_date,
            student_id: String(10_000_000 + i),
        });
    }

    return samples;
}

function main() {
    const { depth, count } = parseArgs();

    if (!fs.existsSync(DIPLOMA_SAMPLES_FILE)) {
        throw new Error(`Missing seed file: ${DIPLOMA_SAMPLES_FILE}`);
    }

    const seed = JSON.parse(fs.readFileSync(DIPLOMA_SAMPLES_FILE, 'utf8'));
    const samples = buildSamples(seed.samples, count);
    const outputPath = diplomaSamplesMinFile(count);

    fs.mkdirSync(merkleTreesDir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({ samples }, null, 2), 'utf8');

    console.log('Generated diploma samples');
    if (depth !== null) {
        console.log('Depth:', depth, `(2^${depth} = ${count} leaves)`);
    } else {
        console.log('Leaf count:', count);
    }
    console.log('Output:', outputPath);
    console.log('Unique student_id values:', samples.length);
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
