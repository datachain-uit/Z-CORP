const fs = require('fs');
const path = require('path');

// Generate circuits/CredentialVerifier_DepthX.circom files for X = 5..15
// based on the base template circuits/CredentialVerifier.circom

const BASE_FILE = path.join(__dirname, '..', '..', 'circuits', 'CredentialVerifier.circom');
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'circuits');
const depths = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function main() {
    if (!fs.existsSync(BASE_FILE)) {
        console.error('Base file not found:', BASE_FILE);
        process.exit(1);
    }

    const baseContent = fs.readFileSync(BASE_FILE, 'utf8');

    // Original main line pattern in CredentialVerifier.circom
    const mainPattern = 'component main { public [root] } = CredentialVerifier(';

    if (!baseContent.includes(mainPattern)) {
        console.error(
            'Could not find main line with expected pattern in CredentialVerifier.circom.\n' +
                '   Please check circuits/CredentialVerifier.circom.'
        );
        process.exit(1);
    }

    for (const depth of depths) {
        const targetFile = path.join(
            OUTPUT_DIR,
            `CredentialVerifier_Depth${depth}.circom`
        );

        // Replace the level count in main with the corresponding depth
        const newContent = baseContent.replace(
            /component main \{ public \[root\] \} = CredentialVerifier\(\d+\);/,
            `component main { public [root] } = CredentialVerifier(${depth});`
        );

        fs.writeFileSync(targetFile, newContent, 'utf8');
        console.log(`Created ${path.relative(process.cwd(), targetFile)}`);
    }

    console.log('\nFinished generating CredentialVerifier_DepthX.circom files (X = 5..15).');
}

main();
