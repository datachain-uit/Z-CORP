const { groth16 } = require("snarkjs");
const fs = require('fs');

async function verifyProof() {
    const vKey = JSON.parse(fs.readFileSync("circuits/verification_key.json"));
    const proof = JSON.parse(fs.readFileSync("proof.json"));
    const publicSignals = JSON.parse(fs.readFileSync("public.json"));

    const res = await groth16.verify(vKey, publicSignals, proof);

    if (res === true) {
        console.log("Verification OK");
    } else {
        console.log("Invalid proof");
    }
}

verifyProof().catch((error) => {
    console.error("Error verifying proof:", error);
}); 