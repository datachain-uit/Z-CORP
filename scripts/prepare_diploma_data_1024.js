const fs = require('fs');
const { buildPoseidon } = require('circomlibjs');

async function main() {
    const TARGET_COUNT = 1024; // 2^10

    // Khởi tạo Poseidon hash function
    const poseidon = await buildPoseidon();

    // Đọc dữ liệu mẫu
    const data = JSON.parse(fs.readFileSync('diploma_samples.json', 'utf8'));
    const samples = data.samples;

    if (!samples || samples.length === 0) {
        console.error('❌ Không có dữ liệu mẫu trong diploma_samples.json');
        process.exit(1);
    }

    console.log(`Số mẫu gốc: ${samples.length}`);
    console.log(`Mục tiêu tạo: ${TARGET_COUNT} văn bằng`);

    // Tìm student_id lớn nhất trong dữ liệu mẫu
    const maxId = samples
        .map(s => BigInt(s.student_id))
        .reduce((a, b) => (b > a ? b : a), BigInt(0));

    // Tạo danh sách 1024 "sample" (bản ghi gốc mở rộng)
    const extendedSamples = [];

    // 1) Giữ nguyên các mẫu gốc ở đầu danh sách
    for (const s of samples) {
        extendedSamples.push({ ...s });
    }

    // 2) Bổ sung thêm cho đủ 1024 bằng cách nhân bản mẫu,
    //    nhưng gán student_id mới (tăng dần sau maxId)
    const remaining = TARGET_COUNT - samples.length;
    for (let i = 0; i < remaining; i++) {
        const base = samples[i % samples.length];
        const clone = { ...base };

        const newId = (maxId + BigInt(i + 1)).toString();
        clone.student_id = newId;

        // Có thể giữ nguyên tên / issue_date để đơn giản.
        // Nếu muốn, có thể gắn suffix để phân biệt rõ ràng hơn:
        // clone.last_name = `${base.last_name} ${Math.floor(i / samples.length) + 1}`;

        extendedSamples.push(clone);
    }

    console.log(`Đã tạo đủ ${extendedSamples.length} bản ghi mẫu (sample)`);

    // Xử lý dữ liệu thành processed_diplomas.json
    const processedData = extendedSamples.map(sample => {
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
            const chunkBigInt = BigInt('0x' + chunk.toString('hex'));
            const hash = poseidon([chunkBigInt]);
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
            BigInt(issueDate),
        ]);

        return {
            nameHash: poseidon.F.toString(nameHash),
            majorCode,
            studentId: sample.student_id,
            issueDate,
            leafHash: poseidon.F.toString(diplomaHash),
        };
    });

    // Lưu kết quả
    fs.writeFileSync('processed_diplomas.json', JSON.stringify(processedData, null, 2));

    console.log('✅ Đã tạo 1024 văn bằng và lưu vào file processed_diplomas.json');
}

main().catch(console.error);

