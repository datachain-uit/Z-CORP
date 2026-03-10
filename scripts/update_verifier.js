const fs = require("fs");
const { ethers } = require("hardhat");

async function main() {
  // Đọc verification key từ file
  const vKey = JSON.parse(fs.readFileSync("verification_key.json", "utf8"));

  // Tạo contract mới với verification key đã cập nhật
  const verifierTemplate = `
// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "hardhat/console.sol";

contract Groth16Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = ${vKey.vk_alpha_1[0]};
    uint256 constant alphay  = ${vKey.vk_alpha_1[1]};
    uint256 constant betax1  = ${vKey.vk_beta_2[0][0]};
    uint256 constant betax2  = ${vKey.vk_beta_2[0][1]};
    uint256 constant betay1  = ${vKey.vk_beta_2[1][0]};
    uint256 constant betay2  = ${vKey.vk_beta_2[1][1]};
    uint256 constant gammax1 = ${vKey.vk_gamma_2[0][0]};
    uint256 constant gammax2 = ${vKey.vk_gamma_2[0][1]};
    uint256 constant gammay1 = ${vKey.vk_gamma_2[1][0]};
    uint256 constant gammay2 = ${vKey.vk_gamma_2[1][1]};
    uint256 constant deltax1 = ${vKey.vk_delta_2[0][0]};
    uint256 constant deltax2 = ${vKey.vk_delta_2[0][1]};
    uint256 constant deltay1 = ${vKey.vk_delta_2[1][0]};
    uint256 constant deltay2 = ${vKey.vk_delta_2[1][1]};

    
    uint256 constant IC0x = ${vKey.IC[0][0]};
    uint256 constant IC0y = ${vKey.IC[0][1]};
    
    uint256 constant IC1x = ${vKey.IC[1][0]};
    uint256 constant IC1y = ${vKey.IC[1][1]};
    
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[1] memory input
    ) public view returns (bool) {
        console.log("Starting proof verification");
        console.log("Input:", input[0]);
        
        bool isValid;
        assembly {
            let _pA := a
            let _pB := b
            let _pC := c
            let _pubSignals := input

            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            checkField(calldataload(add(_pubSignals, 0)))

            // Validate all evaluations
            isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)
        }
        
        console.log("Verification result:", isValid);
        return isValid;
    }
}
`;

  // Ghi contract mới vào file
  fs.writeFileSync("contracts/DiplomaVerifier.sol", verifierTemplate);
  console.log("Updated DiplomaVerifier.sol with new verification key");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  }); 