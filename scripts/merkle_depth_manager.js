const fs = require('fs');
const { execSync } = require('child_process');

class MerkleDepthManager {
    constructor() {
        this.supportedDepths = [5, 10, 15];
    }

    // Tạo Merkle tree với độ sâu cụ thể
    async createMerkleTree(depth) {
        console.log(`\n=== Tạo Merkle Tree độ sâu ${depth} ===`);
        
        if (!this.supportedDepths.includes(depth)) {
            console.error(`Độ sâu ${depth} không được hỗ trợ. Các độ sâu được hỗ trợ: ${this.supportedDepths.join(', ')}`);
            return false;
        }

        try {
            execSync(`node scripts/create_merkle_tree_depth.js`, { stdio: 'inherit' });
            console.log(`✅ Merkle tree độ sâu ${depth} đã được tạo thành công!`);
            return true;
        } catch (error) {
            console.error(`❌ Lỗi khi tạo Merkle tree độ sâu ${depth}:`, error.message);
            return false;
        }
    }

    // Compile circuit với độ sâu cụ thể
    compileCircuit(depth) {
        console.log(`\n=== Compile Circuit độ sâu ${depth} ===`);
        
        const circuitFile = `circuits/DiplomaVerifier_Depth${depth}.circom`;
        const outputDir = `DiplomaVerifier_Depth${depth}`;
        
        if (!fs.existsSync(circuitFile)) {
            console.error(`❌ File ${circuitFile} không tồn tại!`);
            return false;
        }
        
        try {
            execSync(`circom ${circuitFile} --r1cs --wasm --sym --c -o ${outputDir}`, { stdio: 'inherit' });
            console.log(`✅ Circuit độ sâu ${depth} đã được compile thành công!`);
            return true;
        } catch (error) {
            console.error(`❌ Lỗi khi compile circuit độ sâu ${depth}:`, error.message);
            return false;
        }
    }

    // Tạo input cho circuit với độ sâu và index cụ thể
    generateInput(depth, index = 0) {
        console.log(`\n=== Tạo Input cho Circuit độ sâu ${depth}, index ${index} ===`);
        
        const merkleDataFile = `merkle_tree_data_depth_${depth}.json`;
        if (!fs.existsSync(merkleDataFile)) {
            console.error(`❌ File ${merkleDataFile} không tồn tại!`);
            console.error('Vui lòng tạo Merkle tree trước.');
            return false;
        }

        try {
            execSync(`node scripts/generate_input_depth.js ${depth} ${index}`, { stdio: 'inherit' });
            console.log(`✅ Input đã được tạo thành công!`);
            return true;
        } catch (error) {
            console.error(`❌ Lỗi khi tạo input:`, error.message);
            return false;
        }
    }

    // Hiển thị thông tin về các Merkle tree đã tạo
    showMerkleTreeInfo() {
        console.log('\n=== Thông tin Merkle Trees ===');
        
        for (const depth of this.supportedDepths) {
            const merkleDataFile = `merkle_tree_data_depth_${depth}.json`;
            if (fs.existsSync(merkleDataFile)) {
                const data = JSON.parse(fs.readFileSync(merkleDataFile, 'utf8'));
                console.log(`\nĐộ sâu ${depth}:`);
                console.log(`  - Root: ${data.root}`);
                console.log(`  - Tổng số leaves: ${data.totalLeaves}`);
                console.log(`  - Số leaves thật: ${data.realLeaves}`);
                console.log(`  - Số proofs: ${data.proofs.length}`);
            } else {
                console.log(`\nĐộ sâu ${depth}: Chưa tạo`);
            }
        }
    }

    // Hiển thị thông tin về các circuit đã compile
    showCircuitInfo() {
        console.log('\n=== Thông tin Circuits ===');
        
        for (const depth of this.supportedDepths) {
            const circuitFile = `circuits/DiplomaVerifier_Depth${depth}.circom`;
            const outputDir = `DiplomaVerifier_Depth${depth}`;
            
            if (fs.existsSync(circuitFile)) {
                console.log(`\nĐộ sâu ${depth}:`);
                console.log(`  - Circuit file: ${circuitFile}`);
                if (fs.existsSync(outputDir)) {
                    console.log(`  - Compiled: ✅ (${outputDir}/)`);
                } else {
                    console.log(`  - Compiled: ❌ Chưa compile`);
                }
            } else {
                console.log(`\nĐộ sâu ${depth}: Chưa tạo circuit`);
            }
        }
    }

    // Tạo tất cả Merkle trees
    async createAllMerkleTrees() {
        console.log('\n=== Tạo tất cả Merkle Trees ===');
        
        for (const depth of this.supportedDepths) {
            await this.createMerkleTree(depth);
        }
    }

    // Compile tất cả circuits
    compileAllCircuits() {
        console.log('\n=== Compile tất cả Circuits ===');
        
        for (const depth of this.supportedDepths) {
            this.compileCircuit(depth);
        }
    }

    // Tạo input cho tất cả depths
    generateAllInputs(index = 0) {
        console.log('\n=== Tạo Input cho tất cả Depths ===');
        
        for (const depth of this.supportedDepths) {
            this.generateInput(depth, index);
        }
    }

    // Hiển thị hướng dẫn sử dụng
    showHelp() {
        console.log('\n=== Hướng dẫn sử dụng MerkleDepthManager ===');
        console.log('\nCác lệnh có sẵn:');
        console.log('  node scripts/merkle_depth_manager.js create <depth>     - Tạo Merkle tree với độ sâu cụ thể');
        console.log('  node scripts/merkle_depth_manager.js compile <depth>    - Compile circuit với độ sâu cụ thể');
        console.log('  node scripts/merkle_depth_manager.js input <depth> [index] - Tạo input cho circuit');
        console.log('  node scripts/merkle_depth_manager.js info               - Hiển thị thông tin');
        console.log('  node scripts/merkle_depth_manager.js all                - Tạo tất cả (Merkle trees + circuits + inputs)');
        console.log('\nCác độ sâu được hỗ trợ:', this.supportedDepths.join(', '));
        console.log('\nVí dụ:');
        console.log('  node scripts/merkle_depth_manager.js create 10');
        console.log('  node scripts/merkle_depth_manager.js compile 10');
        console.log('  node scripts/merkle_depth_manager.js input 10 0');
        console.log('  node scripts/merkle_depth_manager.js all');
    }
}

// Main function
async function main() {
    const manager = new MerkleDepthManager();
    const command = process.argv[2];
    const param1 = process.argv[3];
    const param2 = process.argv[4];

    switch (command) {
        case 'create':
            if (!param1) {
                console.error('Vui lòng chỉ định độ sâu. Ví dụ: node scripts/merkle_depth_manager.js create 10');
                return;
            }
            await manager.createMerkleTree(parseInt(param1));
            break;

        case 'compile':
            if (!param1) {
                console.error('Vui lòng chỉ định độ sâu. Ví dụ: node scripts/merkle_depth_manager.js compile 10');
                return;
            }
            manager.compileCircuit(parseInt(param1));
            break;

        case 'input':
            if (!param1) {
                console.error('Vui lòng chỉ định độ sâu. Ví dụ: node scripts/merkle_depth_manager.js input 10 0');
                return;
            }
            const index = param2 ? parseInt(param2) : 0;
            manager.generateInput(parseInt(param1), index);
            break;

        case 'info':
            manager.showMerkleTreeInfo();
            manager.showCircuitInfo();
            break;

        case 'all':
            await manager.createAllMerkleTrees();
            manager.compileAllCircuits();
            manager.generateAllInputs();
            break;

        default:
            manager.showHelp();
            break;
    }
}

main().catch(console.error);