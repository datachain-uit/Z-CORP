// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./CredentialManagerBase.sol";

/// @notice Interface of the snarkjs 0.7.5 PLONK verifier (contracts/chain/PlonkVerifierDepth{d}.sol).
interface IPlonkProofVerifier {
    function verifyProof(uint256[24] calldata _proof, uint256[1] calldata _pubSignals) external view returns (bool);
}

/// @title CredentialManagerPlonk
/// @notice Root-anchored credential verification with a PLONK proof (backend-native signature).
contract CredentialManagerPlonk is CredentialManagerBase {
    constructor(address _verifier) CredentialManagerBase(_verifier) {}

    // Verify a credential proof against a published root
    function verifyCredential(uint256[24] calldata proof, uint256[1] calldata input) external returns (bool) {
        require(validRoots[input[0]], "Invalid root");
        bool proofValid = IPlonkProofVerifier(verifier).verifyProof(proof, input);
        require(proofValid, "Invalid proof");

        emit CredentialVerified(input[0]);
        return true;
    }
}
