// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./CredentialManagerBase.sol";

/// @notice Interface of the snarkjs 0.7.5 Groth16 verifier (contracts/Groth16LegacyVerifierDepth{d}.sol).
interface IGroth16ProofVerifier {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[1] calldata _pubSignals
    ) external view returns (bool);
}

/// @title CredentialManagerGroth16
/// @notice Root-anchored credential verification with a Groth16 proof (backend-native signature).
contract CredentialManagerGroth16 is CredentialManagerBase {
    constructor(address _verifier) CredentialManagerBase(_verifier) {}

    // Verify a credential proof against a published root
    function verifyCredential(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[1] calldata input
    ) external returns (bool) {
        require(validRoots[input[0]], "Invalid root");
        bool proofValid = IGroth16ProofVerifier(verifier).verifyProof(a, b, c, input);
        require(proofValid, "Invalid proof");

        emit CredentialVerified(input[0]);
        return true;
    }
}
