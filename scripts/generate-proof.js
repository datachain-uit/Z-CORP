const { groth16 } = require("snarkjs");

async function generateProof() {
    const input = {
        a: 2,
        b: 3,
        c: 4
    };

    const { proof, publicSignals } = await groth16.fullProve(
        input,
        "circuits/Multiplier3_js/Multiplier3.wasm",
        "circuits/Multiplier3.zkey"
    );

    console.log("Proof:", proof);
    console.log("Public Signals:", publicSignals);

    // Save proof and public signals to files
    const fs = require('fs');
    fs.writeFileSync('proof.json', JSON.stringify(proof, null, 2));
    fs.writeFileSync('public.json', JSON.stringify(publicSignals, null, 2));
}

generateProof().then(() => {
    console.log("Proof generated successfully!");
}).catch((error) => {
    console.error("Error generating proof:", error);
}); 