// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IGroth16Verifier.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "hardhat/console.sol";

contract CredentialManager is Ownable {
    IGroth16Verifier public verifier;

    mapping(address => bool) public issuers;

    // Mapping to store Merkle tree roots
    mapping(uint256 => bool) public validRoots;

    // Emitted when a new root is added
    event RootAdded(uint256 root);

    // Emitted when a credential is verified successfully
    event CredentialVerified(uint256 root);

    // Emitted when an issuer is granted or revoked
    event IssuerSet(address indexed issuer, bool isIssuer);

    // Emitted when the Groth16 verifier is updated
    event VerifierSet(address indexed verifier);

    constructor(address _verifier) Ownable() {
        verifier = IGroth16Verifier(_verifier);
        console.log("CredentialManager deployed with verifier:", address(verifier));
    }

    modifier onlyIssuer() {
        require(isIssuer(msg.sender), "CredentialManager: not issuer");
        _;
    }

    function isIssuer(address account) public view returns (bool) {
        return issuers[account];
    }

    // Only the admin (contract deployer) may grant or revoke issuer status
    function setIssuer(address _issuer, bool _isIssuer) external onlyOwner {
        require(_issuer != address(0), "CredentialManager: zero address");
        issuers[_issuer] = _isIssuer;
        emit IssuerSet(_issuer, _isIssuer);
    }

    // Only the admin may update the Groth16 verifier (e.g. switch circuit depth)
    function setVerifier(address _verifier) external onlyOwner {
        require(_verifier != address(0), "CredentialManager: zero address");
        verifier = IGroth16Verifier(_verifier);
        emit VerifierSet(_verifier);
    }

    // Add a new root (issuers only)
    function addRoot(uint256 _root) public onlyIssuer {
        validRoots[_root] = true;
        console.log("Added new root:", _root);
        emit RootAdded(_root);
    }

    // Verify a credential proof
    function verifyCredential(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[1] memory input
    ) public returns (bool) {
        console.log("Verifying credential with root:", input[0]);
        require(validRoots[input[0]], "Invalid root");
        console.log("Root is valid");

        bool proofValid = verifier.verifyProof(a, b, c, input);
        console.log("Proof verification result:", proofValid);
        require(proofValid, "Invalid proof");

        emit CredentialVerified(input[0]);
        return true;
    }

    // Check whether a root is valid
    function isValidRoot(uint256 _root) public view returns (bool) {
        return validRoots[_root];
    }
}
