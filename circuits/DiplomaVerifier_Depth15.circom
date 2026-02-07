pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

// Template để hash thông tin của diploma thành leaf node
template HashDiploma() {
    signal input nameHash;
    signal input majorCode;
    signal input studentId;
    signal input issueDate;
    signal output out;

    // Hash tất cả thông tin của diploma
    component hasher = Poseidon(4);
    hasher.inputs[0] <== nameHash;
    hasher.inputs[1] <== majorCode;
    hasher.inputs[2] <== studentId;
    hasher.inputs[3] <== issueDate;
    out <== hasher.out;
}

// Template để chọn left/right dựa vào selector
template Selector() {
    signal input in[2];  // [left, right]
    signal input s;      // selector (0 or 1)
    signal output out[2];

    // s = 0: out = [in[0], in[1]]
    // s = 1: out = [in[1], in[0]]
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

// Template để xác minh Merkle proof
template MerkleProof(levels) {
    signal input leaf;
    signal input pathIndices[levels];
    signal input siblings[levels];
    signal output root;

    // Tính root từ leaf và proof
    signal computedHash[levels + 1];
    computedHash[0] <== leaf;

    // Khai báo tất cả components trước
    component selectors[levels];
    component hashers[levels];
    
    // Khởi tạo components
    for (var i = 0; i < levels; i++) {
        selectors[i] = Selector();
        hashers[i] = Poseidon(2);
    }

    // Đi từ leaf lên root
    for (var i = 0; i < levels; i++) {
        // Sắp xếp left/right dựa vào pathIndex
        selectors[i].in[0] <== computedHash[i];
        selectors[i].in[1] <== siblings[i];
        selectors[i].s <== pathIndices[i];

        // Hash cặp left-right
        hashers[i].inputs[0] <== selectors[i].out[0];
        hashers[i].inputs[1] <== selectors[i].out[1];
        
        // Lưu kết quả hash cho level tiếp theo
        computedHash[i + 1] <== hashers[i].out;
    }

    // Root là hash cuối cùng
    root <== computedHash[levels];
}

// Template chính để xác minh diploma
template DiplomaVerifier(levels) {
    // Private inputs - thông tin của diploma
    signal input nameHash;
    signal input majorCode;
    signal input studentId;
    signal input issueDate;

    // Public inputs - Merkle proof
    signal input pathIndices[levels];
    signal input siblings[levels];
    signal input root;

    // Hash thông tin của diploma để tạo leaf
    component hasher = HashDiploma();
    hasher.nameHash <== nameHash;
    hasher.majorCode <== majorCode;
    hasher.studentId <== studentId;
    hasher.issueDate <== issueDate;

    // Xác minh Merkle proof
    component merkleProof = MerkleProof(levels);
    merkleProof.leaf <== hasher.out;
    for (var i = 0; i < levels; i++) {
        merkleProof.pathIndices[i] <== pathIndices[i];
        merkleProof.siblings[i] <== siblings[i];
    }

    // Kiểm tra root tính được có khớp với root đầu vào không
    merkleProof.root === root;
}

component main { public [root] } = DiplomaVerifier(15); 