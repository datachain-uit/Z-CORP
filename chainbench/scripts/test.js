'use strict';
// npm test: stage profile `primary` into a fresh work directory and run the unit tests with Hardhat/EDR.
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('../lib/common');
const { stage } = require('../lib/stage');
const workdir = path.join(C.CHAINBENCH, '.work', `test-${new Date().toISOString().replace(/[:.]/g, '')}`);
stage('primary', workdir);
const r = spawnSync(path.join(C.CHAINBENCH, 'node_modules', '.bin', 'hardhat'), ['test'], { cwd: C.CHAINBENCH, stdio: 'inherit', env: { ...process.env, CHAINBENCH_PROFILE: 'primary', CHAINBENCH_WORKDIR: workdir } });
process.exit(r.status);
