const hre = require("hardhat");
const fs = require("fs");

async function main() {
  // Load proof và public inputs
  const proof = JSON.parse(fs.readFileSync("proof.json", "utf8"));
  const publicSignals = JSON.parse(fs.readFileSync("public.json", "utf8"));

  // Format proof cho contract
  const proofForContract = {
    a: [proof.pi_a[0], proof.pi_a[1]],  // Bỏ phần tử thứ 3
    b: [                                 // Đảo ngược thứ tự của các phần tử trong pi_b
      [proof.pi_b[0][1], proof.pi_b[0][0]],  // Đảo ngược thứ tự trong mỗi cặp
      [proof.pi_b[1][1], proof.pi_b[1][0]]
    ],
    c: [proof.pi_c[0], proof.pi_c[1]]   // Bỏ phần tử thứ 3
  };

  console.log("Formatted proof:", JSON.stringify(proofForContract, null, 2));

  // Lấy contract đã deploy
  const diplomaManager = await hre.ethers.getContractAt(
    "DiplomaManager",
    "0x82e01223d51Eb87e16A03E24687EDF0F294da6f1"
  );
  
  // Verify diploma
  console.log("Verifying diploma with root:", publicSignals[0]);
  const tx = await diplomaManager.verifyDiploma(
    proofForContract.a,
    proofForContract.b,
    proofForContract.c,
    publicSignals
  );
  await tx.wait();

  console.log("Verification successful!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 