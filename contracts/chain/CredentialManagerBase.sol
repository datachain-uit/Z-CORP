// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title CredentialManagerBase
/// @notice Backend-independent issuer and root registry for CSI-CHAIN-LOCAL-01 (CHAIN-PROTOCOL-v1).
/// Issuer and root semantics are those of the historical contracts/CredentialManager.sol,
/// without hardhat/console.sol. Proof verification is added by the backend-specific contracts,
/// each with its backend-native proof signature.
abstract contract CredentialManagerBase is Ownable {
    /// @notice Address of the backend-specific on-chain verifier.
    address public verifier;

    mapping(address => bool) public issuers;

    // Mapping to store Merkle tree roots
    mapping(uint256 => bool) public validRoots;

    // Emitted when a new root is added
    event RootAdded(uint256 root);

    // Emitted when a credential is verified successfully
    event CredentialVerified(uint256 root);

    // Emitted when an issuer is granted or revoked
    event IssuerSet(address indexed issuer, bool isIssuer);

    // Emitted when the verifier is updated
    event VerifierSet(address indexed verifier);

    constructor(address _verifier) Ownable() {
        verifier = _verifier;
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

    // Only the admin may update the verifier (e.g. switch circuit depth)
    function setVerifier(address _verifier) external onlyOwner {
        require(_verifier != address(0), "CredentialManager: zero address");
        verifier = _verifier;
        emit VerifierSet(_verifier);
    }

    // Add a new root (issuers only)
    function addRoot(uint256 _root) public onlyIssuer {
        validRoots[_root] = true;
        emit RootAdded(_root);
    }

    // Check whether a root is valid
    function isValidRoot(uint256 _root) public view returns (bool) {
        return validRoots[_root];
    }
}
