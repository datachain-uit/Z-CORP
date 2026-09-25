'use strict';
// chainbench Hardhat configuration (workload-driven; see core/workload.js). NOT the repository root config.
// The profile (primary | bridge) is chosen by CHAINBENCH_PROFILE; the project root is the staged source tree.
require('@nomicfoundation/hardhat-ethers');
const path = require('path');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');
const W = require('./core/workload');
const { EDR_NETWORK } = W.module('constants');
const profile = W.module('profiles').get(process.env.CHAINBENCH_PROFILE || 'primary');

// solc 0.8.20 from the pinned npm package (soljson.js); no compiler download.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args) => {
  if (args.solcVersion !== '0.8.20') throw new Error(`solc ${args.solcVersion} is not allowed (protocol: 0.8.20)`);
  return { compilerPath: require.resolve('solc/soljson.js'), isSolcJs: true, version: '0.8.20', longVersion: '0.8.20+commit.a1b79de6' };
});

module.exports = {
  solidity: { compilers: [{ version: '0.8.20', settings: profile.solcSettings }] },
  paths: { root: profile.root, sources: profile.sources, artifacts: profile.artifacts, cache: profile.cache, tests: path.join(__dirname, 'test') },
  networks: { hardhat: EDR_NETWORK },
  mocha: { timeout: 600000 },
};
