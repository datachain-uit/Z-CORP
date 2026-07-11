const { execSync } = require('child_process');
const fs = require('fs');
const {
    circuitDepthFile,
    circuitDepthOutputDir,
    zkpCircuitsDir,
} = require('./paths');

function compileCircuit(depth) {
    console.log(`\n=== Compiling circuit at depth ${depth} ===`);

    const circuitFile = circuitDepthFile(depth);
    const outputDir = circuitDepthOutputDir(depth);

    if (!fs.existsSync(circuitFile)) {
        console.error(`File ${circuitFile} does not exist!`);
        return false;
    }

    try {
        if (!fs.existsSync(zkpCircuitsDir)) {
            fs.mkdirSync(zkpCircuitsDir, { recursive: true });
        }
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        console.log(`Compiling ${circuitFile}...`);
        execSync(`circom ${circuitFile} --r1cs --wasm --sym --c -o ${outputDir}`, {
            stdio: 'inherit',
        });

        console.log(`Circuit at depth ${depth} compiled successfully.`);
        console.log(`Output directory: ${outputDir}/`);

        return true;
    } catch (error) {
        console.error(`Failed to compile circuit at depth ${depth}:`, error.message);
        return false;
    }
}

function main() {
    const depths = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

    console.log('=== Compiling circuits at various depths ===');
    console.log('Output root:', zkpCircuitsDir);

    for (const depth of depths) {
        compileCircuit(depth);
    }

    console.log('\n=== Finished compiling all circuits ===');
}

main();
