const { execSync } = require('child_process');
const fs = require('fs');

function compileCircuit(depth) {
    console.log(`\n=== Compile circuit độ sâu ${depth} ===`);
    
    const circuitFile = `circuits/DiplomaVerifier_Depth${depth}.circom`;
    const outputDir = `DiplomaVerifier_Depth${depth}`;
    
    // Kiểm tra file circuit tồn tại
    if (!fs.existsSync(circuitFile)) {
        console.error(`File ${circuitFile} không tồn tại!`);
        return false;
    }
    
    try {
        // Đảm bảo thư mục output tồn tại, nếu không circom sẽ báo "invalid output path"
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Compile circuit
        console.log(`Compiling ${circuitFile}...`);
        execSync(`circom ${circuitFile} --r1cs --wasm --sym --c -o ${outputDir}`, { stdio: 'inherit' });
        
        console.log(`✅ Circuit độ sâu ${depth} đã được compile thành công!`);
        console.log(`Output directory: ${outputDir}/`);
        
        return true;
    } catch (error) {
        console.error(`❌ Lỗi khi compile circuit độ sâu ${depth}:`, error.message);
        return false;
    }
}

function main() {
    const depths = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    
    console.log('=== Compile các circuit với độ sâu khác nhau ===');
    
    for (const depth of depths) {
        compileCircuit(depth);
    }
    
    console.log('\n=== Hoàn thành compile tất cả circuits ===');
}

main();