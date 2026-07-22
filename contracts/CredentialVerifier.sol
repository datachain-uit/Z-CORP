// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/** @notice Groth16 verifier từ snarkjs (1 public signal), dùng chung cho mọi bản export .sol. */
interface IGroth16Verifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[1] calldata _pubSignals
    ) external view returns (bool);
}
