const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Danh sách độ sâu Merkle / số "levels" trong circuit muốn phân tích
// Ở đây giả định bạn có các circuit:
//   DiplomaVerifier_Depth5.r1cs, ..., DiplomaVerifier_Depth15.r1cs
// nằm trong thư mục:
//   DiplomaVerifier_DepthX/DiplomaVerifier_DepthX.r1cs
const depths = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

// Phân tích R1CS bằng snarkjs r1cs info (đảm bảo đúng format)
function analyzeR1csWithSnarkjs(r1csPath) {
    const output = execSync(`snarkjs r1cs info ${r1csPath}`).toString();

    const getNumber = (label) => {
        const re = new RegExp(`# of ${label}:\\s+(\\d+)`);
        const m = output.match(re);
        return m ? parseInt(m[1], 10) : null;
    };

    return {
        nConstraints: getNumber('Constraints'),
        nWires: getNumber('Wires'),
        nPubInputs: getNumber('Public Inputs'),
        nPrvInputs: getNumber('Private Inputs'),
        nOutputs: getNumber('Outputs'),
    };
}

function main() {
    console.log('=== Phân tích số constraint theo depth (5..15) ===\n');
    console.log(
        'Depth | #Diplomas (2^depth) | #Constraints | #Wires | #PubInputs | #PrvInputs | #Outputs'
    );
    console.log(
        '------+----------------------|-------------|--------|-----------|-----------|----------'
    );

    for (const depth of depths) {
        const dir = `DiplomaVerifier_Depth${depth}`;
        const r1csFile = `DiplomaVerifier_Depth${depth}.r1cs`;
        const r1csPath = path.join(__dirname, '..', dir, r1csFile);

        if (!fs.existsSync(r1csPath)) {
            console.log(
                `${String(depth).padStart(5)} | ${String(
                    2 ** depth
                ).padStart(20)} | (thiếu file R1CS: ${dir}/${r1csFile})`
            );
            continue;
        }

        try {
            const h = analyzeR1csWithSnarkjs(r1csPath);
            console.log(
                `${String(depth).padStart(5)} | ${String(2 ** depth).padStart(
                    20
                )} | ${String(h.nConstraints).padStart(11)} | ${String(
                    h.nWires
                ).padStart(6)} | ${String(h.nPubInputs).padStart(
                    9
                )} | ${String(h.nPrvInputs).padStart(9)} | ${String(
                    h.nOutputs
                ).padStart(8)}`
            );
        } catch (err) {
            console.log(
                `${String(depth).padStart(5)} | ${String(
                    2 ** depth
                ).padStart(20)} | (lỗi đọc R1CS: ${err.message})`
            );
        }
    }

    console.log('\nGợi ý: hãy chắc chắn bạn đã compile đủ các circuit Depth5..Depth15 trước.');
}

main();

