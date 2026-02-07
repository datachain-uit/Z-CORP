const fs = require('fs');
const path = require('path');

// Tạo các file circuits/DiplomaVerifier_DepthX.circom cho X = 5..15
// dựa trên template gốc circuits/DiplomaVerifier.circom

const BASE_FILE = path.join(__dirname, '..', 'circuits', 'DiplomaVerifier.circom');
const OUTPUT_DIR = path.join(__dirname, '..', 'circuits');
const depths = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function main() {
    if (!fs.existsSync(BASE_FILE)) {
        console.error('❌ Không tìm thấy file gốc:', BASE_FILE);
        process.exit(1);
    }

    const baseContent = fs.readFileSync(BASE_FILE, 'utf8');

    // Mẫu dòng main gốc trong DiplomaVerifier.circom
    const mainPattern = 'component main { public [root] } = DiplomaVerifier(';

    if (!baseContent.includes(mainPattern)) {
        console.error(
            '❌ Không tìm thấy dòng main với pattern mong đợi trong DiplomaVerifier.circom.\n' +
                '   Vui lòng kiểm tra lại file circuits/DiplomaVerifier.circom.'
        );
        process.exit(1);
    }

    for (const depth of depths) {
        const targetFile = path.join(
            OUTPUT_DIR,
            `DiplomaVerifier_Depth${depth}.circom`
        );

        // Thay số levels trong main thành depth tương ứng
        const newContent = baseContent.replace(
            /component main \{ public \[root\] \} = DiplomaVerifier\(\d+\);/,
            `component main { public [root] } = DiplomaVerifier(${depth});`
        );

        fs.writeFileSync(targetFile, newContent, 'utf8');
        console.log(`✅ Đã tạo ${path.relative(process.cwd(), targetFile)}`);
    }

    console.log('\nHoàn tất tạo các file DiplomaVerifier_DepthX.circom (X = 5..15).');
}

main();

