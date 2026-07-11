pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

// Template to hash credential information into a leaf node
template HashCredential() {
    signal input nameHash;
    signal input majorCode;
    signal input studentId;
    signal input issueDate;
    signal output out;

    // Hash all credential information
    component hasher = Poseidon(4);
    hasher.inputs[0] <== nameHash;
    hasher.inputs[1] <== majorCode;
    hasher.inputs[2] <== studentId;
    hasher.inputs[3] <== issueDate;
    out <== hasher.out;
}

// Template to select left/right based on selector
template Selector() {
    signal input in[2];  // [left, right]
    signal input s;      // selector (0 or 1)
    signal output out[2];

    // s = 0: out = [in[0], in[1]]
    // s = 1: out = [in[1], in[0]]
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

// Template to verify Merkle proof
template MerkleProof(levels) {
    signal input leaf;
    signal input pathIndices[levels];
    signal input siblings[levels];
    signal output root;

    // Compute root from leaf and proof
    signal computedHash[levels + 1];
    computedHash[0] <== leaf;

    // Declare all components upfront
    component selectors[levels];
    component hashers[levels];
    
    // Initialize components
    for (var i = 0; i < levels; i++) {
        selectors[i] = Selector();
        hashers[i] = Poseidon(2);
    }

    // Walk from leaf up to root
    for (var i = 0; i < levels; i++) {
        // Order left/right based on pathIndex
        selectors[i].in[0] <== computedHash[i];
        selectors[i].in[1] <== siblings[i];
        selectors[i].s <== pathIndices[i];

        // Hash the left-right pair
        hashers[i].inputs[0] <== selectors[i].out[0];
        hashers[i].inputs[1] <== selectors[i].out[1];
        
        // Store hash result for the next level
        computedHash[i + 1] <== hashers[i].out;
    }

    // Root is the final hash
    root <== computedHash[levels];
}

// Main template to verify credential
template CredentialVerifier(levels) {
    // Private inputs - credential information
    signal input nameHash;
    signal input majorCode;
    signal input studentId;
    signal input issueDate;

    // Public inputs - Merkle proof
    signal input pathIndices[levels];
    signal input siblings[levels];
    signal input root;

    // Hash credential information to create leaf
    component hasher = HashCredential();
    hasher.nameHash <== nameHash;
    hasher.majorCode <== majorCode;
    hasher.studentId <== studentId;
    hasher.issueDate <== issueDate;

    // Verify Merkle proof
    component merkleProof = MerkleProof(levels);
    merkleProof.leaf <== hasher.out;
    for (var i = 0; i < levels; i++) {
        merkleProof.pathIndices[i] <== pathIndices[i];
        merkleProof.siblings[i] <== siblings[i];
    }

    // Check that computed root matches the input root
    merkleProof.root === root;
}

component main { public [root] } = CredentialVerifier(5); 