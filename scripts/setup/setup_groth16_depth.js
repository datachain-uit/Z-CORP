/**
 * Legacy circuit CredentialVerifier_Depth{D}: circom + wasm + Groth16 zkey + export verifier Solidity.
 *
 *   node scripts/setup/setup_groth16_depth.js 11
 *
 * Output:
 *   data/zkp-circuits/CredentialVerifier_Depth{D}/...wasm
 *   data/zkp-circuits/CredentialVerifier_Depth{D}/CredentialVerifier_Depth{D}_0001.zkey
 *   contracts/Groth16LegacyVerifierDepth{D}.sol
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
    projectRoot,
    circuitDepthFile,
    circuitDepthOutputDir,
    zkey0DepthFile,
    zkeyDepthFile,
    zkpCircuitsDir,
} = require('./paths');

const snarkjsCli = path.join(projectRoot, 'node_modules/snarkjs/build/cli.cjs');

function quote(p) {
  if (process.platform === 'win32') {
    return `"${p.replace(/"/g, '\\"')}"`;
  }
  return `"${p}"`;
}

function setupGroth16Depth(depth) {
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error(`Invalid depth: ${depth}`);
  }

  const circomBin = process.env.CIRCOM_BIN || 'circom';
  const ptau = process.env.PTAU_PATH
    ? path.resolve(process.env.PTAU_PATH)
    : path.join(projectRoot, 'pot16_final.ptau');

  if (!fs.existsSync(ptau)) {
    throw new Error(`Missing ptau: ${ptau}`);
  }
  if (!fs.existsSync(snarkjsCli)) {
    throw new Error(`Missing snarkjs: ${snarkjsCli}`);
  }

  const baseName = `CredentialVerifier_Depth${depth}`;
  const circuitPath = circuitDepthFile(depth);
  if (!fs.existsSync(circuitPath)) {
    throw new Error(`Missing ${circuitPath}`);
  }

  if (!fs.existsSync(zkpCircuitsDir)) {
    fs.mkdirSync(zkpCircuitsDir, { recursive: true });
  }

  const outDir = circuitDepthOutputDir(depth);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n=== circom ${baseName} ===`);
  execSync(
    `${circomBin} ${quote(circuitPath)} --r1cs --wasm --sym -o ${quote(outDir)}`,
    { cwd: projectRoot, stdio: 'inherit' }
  );

  const r1csPath = path.join(outDir, `${baseName}.r1cs`);
  const zkey0 = zkey0DepthFile(depth);
  const zkey1 = zkeyDepthFile(depth);
  const tmpSol = path.join(outDir, `${baseName}_verifier_tmp.sol`);
  const contractName = `Groth16LegacyVerifierDepth${depth}`;
  const outSol = path.join(projectRoot, 'contracts', `${contractName}.sol`);

  execSync(`node ${quote(snarkjsCli)} groth16 setup ${quote(r1csPath)} ${quote(ptau)} ${quote(zkey0)}`, {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  const entropy = `legacy-${depth}-${Date.now()}`;
  execSync(
    `node ${quote(snarkjsCli)} zkey contribute ${quote(zkey0)} ${quote(zkey1)} --name=local -e="${entropy}" -v`,
    { cwd: projectRoot, stdio: 'inherit' }
  );

  execSync(
    `node ${quote(snarkjsCli)} zkey export solidityverifier ${quote(zkey1)} ${quote(tmpSol)}`,
    { cwd: projectRoot, stdio: 'inherit' }
  );

  let sol = fs.readFileSync(tmpSol, 'utf8');
  sol = sol.replace(/^contract\s+\w+/m, `contract ${contractName}`);
  fs.writeFileSync(outSol, sol, 'utf8');
  fs.unlinkSync(tmpSol);

  console.log('\nLegacy depth', depth);
  console.log('  zkey:', zkey1);
  console.log('  wasm:', path.join(outDir, `${baseName}_js`, `${baseName}.wasm`));
  console.log('  contract:', outSol);
}

function main() {
  const depth = parseInt(process.argv[2], 10);
  if (Number.isNaN(depth)) {
    throw new Error('Usage: node scripts/setup/setup_groth16_depth.js <depth>');
  }

  setupGroth16Depth(depth);
}

module.exports = { setupGroth16Depth };

if (require.main === module) {
  main();
}
