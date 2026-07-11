require("@matterlabs/hardhat-zksync-solc");
require("@matterlabs/hardhat-zksync-deploy");
require("@nomicfoundation/hardhat-toolbox");
const { task } = require("hardhat/config");
const secret = require("./secret.json");

task("credential-verification", "Benchmark verifyCredential and export CSV results")
    .addParam("manager", "Deployed CredentialManager address")
    .addOptionalParam("depth", "Circuit depth", "11")
    .addOptionalParam("iterations", "Number of verify calls", "50")
    .addOptionalParam("index", "Diploma index for proof files", "0")
    .setAction(async (taskArgs) => {
        process.env.CREDENTIAL_MANAGER_ADDRESS = taskArgs.manager;
        process.env.VERIFICATION_DEPTH = taskArgs.depth;
        process.env.VERIFICATION_ITERATIONS = taskArgs.iterations;
        process.env.VERIFICATION_INDEX = taskArgs.index;

        const { main } = require("./scripts/blockchain/verification");
        const exitCode = await main();
        process.exit(exitCode ?? 0);
    });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
  },
  zksolc: {
    version: "latest",
    settings: {
      optimizer: {
        enabled: true,
        mode: "3",
        fallback_to_optimizing_for_size: true,
      },
    },
  },
  networks: {
    hardhat: {
      zksync: false,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      zksync: false,
    },
    dockerHardhat: {
      url: "http://hardhat-node:8545",
      zksync: false,
    },
    sepolia: {
      url: "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: [secret.privateKey],
      zksync: false,
    },
    zkSyncSepolia: {
      url: "https://sepolia.era.zksync.dev",
      ethNetwork: "sepolia",
      chainId: 300,
      accounts: [secret.privateKey],
      zksync: true,
    },
  },
};
