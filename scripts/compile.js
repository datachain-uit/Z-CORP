const hre = require("hardhat");

async function main() {
  console.log("Compiling contracts...");
  
  // Compile contracts
  await hre.run("compile");
  
  console.log("Contracts compiled successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 