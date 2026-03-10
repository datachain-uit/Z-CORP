const fs = require('fs');
const { buildPoseidon } = require('circomlibjs');
const {
    DIPLOMA_SAMPLES_FILE,
    PROCESSED_DIPLOMAS_FILE,
} = require('./paths');

async function main() {
    // Khởi tạo Poseidon hash function
    const poseidon = await buildPoseidon();
    
    // Đọc dữ liệu từ file
    const data = JSON.parse(fs.readFileSync(DIPLOMA_SAMPLES_FILE, 'utf8'));
    
    // Xử lý dữ liệu
    const processedData = data.samples.map(sample => {
        // Tạo name từ last_name và first_name
        const name = `${sample.last_name} ${sample.first_name}`;
        
        // Chuyển name thành bytes
        const nameBytes = Buffer.from(name, 'utf8');
        
        // Chia nameBytes thành các chunk 32 bytes
        const chunks = [];
        for (let i = 0; i < nameBytes.length; i += 32) {
            chunks.push(nameBytes.slice(i, i + 32));
        }
        
        // Hash từng chunk và kết hợp
        let nameHash = BigInt(0);
        for (const chunk of chunks) {
            // Chuyển chunk thành số bigint
            const chunkBigInt = BigInt('0x' + chunk.toString('hex'));
            // Hash chunk
            const hash = poseidon([chunkBigInt]);
            // Kết hợp với hash hiện tại
            nameHash = poseidon([nameHash, hash]);
        }
        
        // Tạo majorCode ngẫu nhiên từ 1-5
        const majorCode = Math.floor(Math.random() * 5) + 1;
        
        // Xử lý issue_date: bỏ dấu "-"
        const issueDate = sample.issue_date.replace(/-/g, '');
        
        // Hash tất cả thông tin của diploma
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
    
    // Lưu kết quả
    fs.writeFileSync(PROCESSED_DIPLOMAS_FILE, JSON.stringify(processedData, null, 2));
    
    console.log(`Đã xử lý xong dữ liệu và lưu vào file ${PROCESSED_DIPLOMAS_FILE}`);
}

main().catch(console.error); 