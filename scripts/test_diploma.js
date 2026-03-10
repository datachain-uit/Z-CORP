const { ethers } = require("hardhat");
const fs = require("fs");
const snarkjs = require("snarkjs");
const path = require("path");

async function main() {
    console.log("Testing SimpleDiploma circuit...");
    
    // Create necessary directories
    const circuitDir = "circuits/examples/diploma";
    if (!fs.existsSync(circuitDir)) {
        fs.mkdirSync(circuitDir, { recursive: true });
    }
    
    // Compile the circuit
    console.log("Compiling circuit...");
    const { zkey } = await snarkjs.plonk.setup(
        path.join(circuitDir, "SimpleDiploma.circom"),
        path.join(circuitDir, "SimpleDiploma.zkey")
    );
    
    // Save verification key
    const vKey = await snarkjs.zKey.exportVerificationKey(zkey);
    fs.writeFileSync(
        path.join(circuitDir, "verification_key.json"),
        JSON.stringify(vKey, null, 2)
    );
    
    // Generate proof
    console.log("Generating proof...");
    const { proof, publicSignals } = await snarkjs.plonk.fullProve(
        JSON.parse(fs.readFileSync(path.join(circuitDir, "input.json"), "utf8")),
        path.join(circuitDir, "SimpleDiploma.circom"),
        path.join(circuitDir, "SimpleDiploma.zkey")
    );
    
    // Save proof and public signals
    fs.writeFileSync(
        path.join(circuitDir, "proof.json"),
        JSON.stringify(proof, null, 2)
    );
    fs.writeFileSync(
        path.join(circuitDir, "public.json"),
        JSON.stringify(publicSignals, null, 2)
    );
    
    // Verify proof
    console.log("Verifying proof...");
    const res = await snarkjs.plonk.verify(vKey, publicSignals, proof);
    
    if (res === true) {
        console.log("✅ Verification OK");
    } else {
        console.log("❌ Invalid proof");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 