const fs = require('fs');
const path = require('path');

// Đường dẫn đến file R1CS
const r1csPath = path.join(__dirname, '../DiplomaVerifier.r1cs');

// Đọc file R1CS
const r1csBuffer = fs.readFileSync(r1csPath);

// Phân tích header của file R1CS
const header = {
    fieldSize: r1csBuffer.readUInt32LE(8),
    prime: r1csBuffer.slice(12, 12 + 32).toString('hex'),
    nWires: r1csBuffer.readUInt32LE(44),
    nPubInputs: r1csBuffer.readUInt32LE(48),
    nPrvInputs: r1csBuffer.readUInt32LE(52),
    nOutputs: r1csBuffer.readUInt32LE(56),
    nConstraints: r1csBuffer.readUInt32LE(60)
};

console.log('Circuit Analysis:');
console.log('----------------');
console.log(`Total number of constraints: ${header.nConstraints}`);
console.log(`Number of wires: ${header.nWires}`);
console.log(`Number of public inputs: ${header.nPubInputs}`);
console.log(`Number of private inputs: ${header.nPrvInputs}`);
console.log(`Number of outputs: ${header.nOutputs}`);
console.log(`Field size: ${header.fieldSize} bits`);
console.log(`Prime: 0x${header.prime}`); 