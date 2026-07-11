const fs = require('fs');
const { buildPoseidon } = require('circomlibjs');
const {
    DIPLOMA_SAMPLES_FILE,
    PROCESSED_DIPLOMAS_FILE,
} = require('./paths');

async function main() {
    const inputFile = process.argv[2] || DIPLOMA_SAMPLES_FILE;
    const outputFile = process.argv[3] || PROCESSED_DIPLOMAS_FILE;
    /** majorCode = (index % 5) + 1 — reproducible, suitable for large datasets (4096) */
    const deterministicMajor = process.env.DETERMINISTIC_MAJOR === '1';

    // Initialize Poseidon hash function
    const poseidon = await buildPoseidon();
    
    // Read data from file
    const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    
    // Process samples
    const processedData = data.samples.map((sample, index) => {
        // Build name from last_name and first_name
        const name = `${sample.last_name} ${sample.first_name}`;
        
        // Convert name to bytes
        const nameBytes = Buffer.from(name, 'utf8');
        
        // Split nameBytes into 32-byte chunks
        const chunks = [];
        for (let i = 0; i < nameBytes.length; i += 32) {
            chunks.push(nameBytes.slice(i, i + 32));
        }
        
        // Hash each chunk and combine
        let nameHash = BigInt(0);
        for (const chunk of chunks) {
            // Convert chunk to bigint
            const chunkBigInt = BigInt('0x' + chunk.toString('hex'));
            // Hash chunk
            const hash = poseidon([chunkBigInt]);
            // Combine with the running hash
            nameHash = poseidon([nameHash, hash]);
        }
        
        const majorCode = deterministicMajor
            ? (index % 5) + 1
            : Math.floor(Math.random() * 5) + 1;
        
        // Normalize issue_date by removing "-" separators
        const issueDate = sample.issue_date.replace(/-/g, '');
        
        // Hash all diploma fields
        const diplomaHash = poseidon([
            nameHash,
            BigInt(majorCode),
            BigInt(sample.student_id),
            BigInt(issueDate)
        ]);
        
        return {
            nameHash: poseidon.F.toString(nameHash),
            majorCode,
            studentId: sample.student_id,
            issueDate,
            leafHash: poseidon.F.toString(diplomaHash)
        };
    });
    
    if (deterministicMajor) {
        console.log('DETERMINISTIC_MAJOR=1 — majorCode = (index % 5) + 1');
    }

    // Write output file
    fs.writeFileSync(outputFile, JSON.stringify(processedData, null, 2));
    
    console.log(`Finished processing data and saved to ${outputFile}`);
}

main().catch(console.error); 