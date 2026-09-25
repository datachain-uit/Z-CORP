'use strict';
// CSI-CHAIN-PUBLIC-01 frozen inputs (CHAIN-PUBLIC-PROTOCOL-v1 section 6). Author/reviewer tool, run ONCE before any public
// transaction; the public runner only reads its outputs. Deterministic: the same repository state gives byte-identical files.
//
//   EVM (Ethereum Sepolia): init and runtime bytecode taken byte-for-byte from the frozen L1 build manifest of the accepted
//     controlled L1 campaign (solc 0.8.20, optimizer 200 runs, evmVersion paris); both runs' manifests must be identical and
//     listed in the L1 SOURCE.sha256.
//   EraVM (ZKsync Era Sepolia): recompiled with the pinned zksolc 1.5.15 / era-solc 0.8.20-1.0.2 and the frozen settings of the
//     L2 arm; the standard-JSON input and output digests and every bytecode hash must equal the frozen L2 build manifest.
//   ABI: from that compilation; its sha256 must equal the ABI digest of both frozen manifests.
//   Proof calldata: PS-01 proofs at depth 11 (snarkjs 0.7.5 exportSolidityCallData, as in the controlled study); the
//     verifyCredential and addRoot calldata sha256 must equal the controlled L1 and L2 raw rows.
// Needs: chainbench/node_modules (snarkjs, @openzeppelin/contracts), CHAINBENCH_ZKSOLC_BIN and CHAINBENCH_ERA_SOLC_BIN
// (for example inside the chainbench-l2 image). Usage: node build_public_inputs.js [--check]
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const CB = path.resolve(__dirname, '..', '..', '..');
const REPO = path.resolve(CB, '..');
const { ethers } = require(path.join(CB, 'node_modules', 'ethers'));
const EC = require(path.join(CB, 'adapters', 'eravm', 'lib', 'compile.js'));
const EK = require(path.join(CB, 'adapters', 'eravm', 'lib', 'constants.js'));
const PS = require(path.join(CB, 'lib', 'proofset.js'));

const B = JSON.parse(fs.readFileSync(path.join(CB, 'workloads', 'zcorp', 'campaigns', 'CSI-CHAIN-PUBLIC-01.json'), 'utf8'));
const PROC = JSON.parse(fs.readFileSync(path.join(CB, B.procedure), 'utf8'));
const OUT = path.join(REPO, B.inputs_dir);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const shaFile = (p) => sha(fs.readFileSync(p));
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  // keys sorted for determinism, except the ABI, which keeps the compiler's order so that sha256(JSON.stringify(abi)) can be
  // recomputed by anyone and compared with the frozen build manifests
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((a, k) => { a[k] = k === 'abi' ? v[k] : sortDeep(v[k]); return a; }, {});
  return v;
}
const J = (o) => JSON.stringify(sortDeep(o), null, 2) + '\n';
const checks = [];
function check(name, ok, detail) { checks.push({ check: name, pass: !!ok, detail: detail === undefined ? null : detail }); if (!ok) console.error(`FAIL ${name}: ${JSON.stringify(detail)}`); }
function csvRows(rel) {
  const t = fs.readFileSync(path.join(REPO, rel), 'utf8').trim().split('\n');
  const h = t[0].split(',');
  return t.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [h[i], v])));
}
function sourceListed(sourceSha256File, rel) {
  const m = fs.readFileSync(path.join(REPO, sourceSha256File), 'utf8').split('\n').map((l) => l.split(/\s+/));
  const hit = m.find((x) => x[1] === rel);
  return hit ? hit[0] : null;
}

async function main() {
  const L1 = B.controlled_references.l1; const L2 = B.controlled_references.l2;
  // ---- EVM artifacts from the frozen L1 build manifest
  const m1 = path.join(REPO, L1.build_manifest);
  const m1b = m1.replace('-edr-a/', '-edr-b/');
  const m1sha = shaFile(m1);
  check('l1_build_manifest_runs_identical', m1sha === shaFile(m1b), { a: m1sha, b: shaFile(m1b) });
  check('l1_build_manifest_in_frozen_source', sourceListed('csi/campaigns/chain/CSI-CHAIN-LOCAL-01/SOURCE.sha256', L1.build_manifest) === m1sha, L1.build_manifest);
  const bm1 = JSON.parse(fs.readFileSync(m1, 'utf8'));
  // ---- EraVM recompilation with the frozen settings and requested files
  const m2 = path.join(REPO, L2.build_manifest);
  const m2sha = shaFile(m2);
  check('l2_build_manifest_in_frozen_source', sourceListed('csi/campaigns/chain/CSI-CHAIN-LOCAL-01-L2/SOURCE.sha256', L2.build_manifest) === m2sha, L2.build_manifest);
  const bm2 = JSON.parse(fs.readFileSync(m2, 'utf8'));
  const bins = EK.binaries(); const pins = EK.archPins();
  check('zksolc_binary_pinned', bins.zksolc && shaFile(bins.zksolc) === pins.zksolc.sha256, pins.zksolc.version);
  check('era_solc_binary_pinned', bins.era_solc && shaFile(bins.era_solc) === pins.era_solc.sha256, pins.era_solc.version);
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'public-inputs-'));
  const { manifest: cm, output } = EC.compile(bm2.requested_files, wd);
  check('eravm_input_equals_frozen', cm.input_sha256 === bm2.input_sha256, { got: cm.input_sha256, frozen: bm2.input_sha256 });
  check('eravm_output_equals_frozen', cm.output_sha256 === bm2.output_sha256, { got: cm.output_sha256, frozen: bm2.output_sha256 });
  fs.rmSync(wd, { recursive: true, force: true });

  const files = {};
  const srcOf = (name) => Object.keys(bm1.contracts).find((k) => k.endsWith(`:${name}`));
  for (const backend of PROC.backends) {
    for (const role of ['verifier', 'manager']) {
      const name = PROC.contracts[backend][role];
      const key = srcOf(name); const source = key.split(':')[0];
      const e = bm1.contracts[key];
      const z = bm2.contracts[key];
      const oc = output.contracts[source][name];
      const abi = oc.abi; const abiSha = sha(Buffer.from(JSON.stringify(abi)));
      check(`${name}_abi_equals_l1_and_l2`, abiSha === e.abi_sha256 && abiSha === z.abi_sha256, abiSha);
      check(`${name}_evm_init_keccak`, ethers.keccak256(e.init_hex) === e.init_keccak, e.init_keccak);
      check(`${name}_evm_runtime_keccak`, ethers.keccak256(e.runtime_hex) === e.runtime_keccak, e.runtime_keccak);
      const zb = '0x' + oc.evm.bytecode.object;
      check(`${name}_eravm_bytecode_equals_frozen`, sha(Buffer.from(zb.slice(2), 'hex')) === z.bytecode_sha256 && `0x${oc.hash}` === z.bytecode_hash, z.bytecode_hash);
      const srcSha = shaFile(path.join(REPO, source));
      const l2src = bm2.sources.find((s) => s.path === source);
      const l1staged = (bm1.staged_files || []).find((s) => s.path === source);
      check(`${name}_source_equals_frozen`, l2src && l2src.sha256 === srcSha && l1staged && l1staged.sha256 === srcSha, { sha256: srcSha });
      const common = { name, backend, role, source, source_sha256: srcSha, abi, abi_sha256: abiSha };
      files[`deployment/evm/${name}.json`] = {
        ...common, venue: 'evm', bytecode: e.init_hex, deployedBytecode: e.runtime_hex,
        init_bytes: e.init_bytes, runtime_bytes: e.runtime_bytes, init_keccak: e.init_keccak, runtime_keccak: e.runtime_keccak,
        init_sha256: sha(Buffer.from(e.init_hex.slice(2), 'hex')), runtime_sha256: sha(Buffer.from(e.runtime_hex.slice(2), 'hex')),
        compiler: bm1.compiler, settings: bm1.settings,
        frozen_origin: { build_manifest: L1.build_manifest, build_manifest_sha256: m1sha, admin_id: L1.admin_id, baseline_tag: L1.baseline_tag, commit: L1.commit },
      };
      files[`deployment/eravm/${name}.json`] = {
        ...common, venue: 'eravm', bytecode: zb, bytecode_hash: `0x${oc.hash}`, bytecode_sha256: z.bytecode_sha256, bytecode_bytes: z.bytecode_bytes,
        compiler: { zksolc: cm.compiler.zksolc_version_output, era_solc_long_version: cm.compiler.era_solc_long_version, zksolc_sha256: cm.compiler.zksolc_sha256, era_solc_sha256: cm.compiler.era_solc_sha256 },
        settings: bm2.settings,
        frozen_origin: { build_manifest: L2.build_manifest, build_manifest_sha256: m2sha, input_sha256: bm2.input_sha256, output_sha256: bm2.output_sha256, admin_id: L2.admin_id, baseline_tag: L2.baseline_tag, commit: L2.commit },
      };
    }
  }

  // ---- proofs and frozen calldata (depth 11), cross-checked with the controlled raw rows
  const ps = await PS.load();
  const ops1 = csvRows(L1.ops).filter((r) => r.profile === 'primary' && r.depth === String(PROC.depth));
  const ops2 = csvRows(L2.ops).filter((r) => r.depth === String(PROC.depth));
  const psRows = Object.fromEntries(ps.rows.map((r) => [r.proof_id, r]));
  const proofs = [];
  let root = null;
  for (const backend of PROC.backends) {
    const mgrAbi = files[`deployment/evm/${PROC.contracts[backend].manager}.json`].abi;
    const I = new ethers.Interface(mgrAbi);
    for (const id of B.proofs[backend]) {
      const j = Number(id.split('-p')[1]);
      const p = await ps.get(backend, PROC.depth, j);
      check(`${id}_selected_by_index`, p.id === id, id);
      const r = psRows[id];
      const data = I.encodeFunctionData('verifyCredential', p.args);
      const dsha = sha(Buffer.from(data.slice(2), 'hex'));
      const c1 = ops1.find((x) => x.backend === backend && x.op === 'verify_credential' && x.proof_id === id);
      const c2 = ops2.find((x) => x.backend === backend && x.op === 'verify_credential' && x.proof_id === id);
      check(`${id}_calldata_equals_controlled_l1`, c1 && c1.calldata_sha256 === dsha, { l1: c1 && c1.calldata_sha256, got: dsha });
      check(`${id}_calldata_equals_controlled_l2`, c2 && c2.calldata_sha256 === dsha, { l2: c2 && c2.calldata_sha256, got: dsha });
      if (root === null) root = p.root; else check(`${id}_same_root`, root === p.root, p.root.toString());
      proofs.push({
        proof_id: id, backend, depth: PROC.depth, j, leaf_index: p.leaf_index, root: p.root.toString(),
        proof_file: r.proof_file, proof_sha256: r.proof_sha256, public_file: r.public_file, public_sha256: r.public_sha256,
        vkey_sha256: r.vkey_sha256, zkey_sha256: r.zkey_sha256, args: p.args,
        verify_credential_calldata: data, verify_credential_calldata_sha256: dsha, calldata_bytes: (data.length - 2) / 2,
        controlled_reference: {
          l1_gas_used: c1 ? Number(c1.gas_used) : null, l1_calldata_sha256: c1 ? c1.calldata_sha256 : null,
          l2_computational_gas: c2 ? Number(c2.computational_gas) : null, l2_pubdata_bytes: c2 ? Number(c2.pubdata_bytes) : null, l2_calldata_sha256: c2 ? c2.calldata_sha256 : null,
        },
      });
    }
  }
  const mI = new ethers.Interface(files[`deployment/evm/${PROC.contracts.groth16.manager}.json`].abi);
  const addRoot = mI.encodeFunctionData('addRoot', [root]);
  const arSha = sha(Buffer.from(addRoot.slice(2), 'hex'));
  const a1 = ops1.filter((x) => x.op === 'add_root').map((x) => x.calldata_sha256);
  const a2 = ops2.filter((x) => x.op === 'add_root').map((x) => x.calldata_sha256);
  check('add_root_calldata_equals_controlled_l1_and_l2', a1.length && a1.every((h) => h === arSha) && a2.length && a2.every((h) => h === arSha), arSha);
  const ref = {};
  for (const backend of PROC.backends) {
    ref[backend] = {};
    for (const op of ['deploy_verifier', 'deploy_manager', 'set_issuer', 'add_root']) {
      const c1 = ops1.find((x) => x.backend === backend && x.op === op); const c2 = ops2.find((x) => x.backend === backend && x.op === op);
      ref[backend][op] = { l1_gas_used: c1 ? Number(c1.gas_used) : null, l2_computational_gas: c2 ? Number(c2.computational_gas) : null, l2_pubdata_bytes: c2 ? Number(c2.pubdata_bytes) : null };
    }
  }
  files['proofs/d11.json'] = {
    depth: PROC.depth, root: root.toString(), root_hex: '0x' + root.toString(16).padStart(64, '0'),
    add_root_calldata: addRoot, add_root_calldata_sha256: arSha, proofs,
    proofset: { dir: B.proofset_dir, manifest: ps.manifest },
    selection_rule: B.proofs.rule, controlled_reference_setup: ref,
    note: 'Calldata depends only on the proof and the ABI, so it is identical on both networks and in the controlled study. setIssuer and the manager constructor argument depend on the public signer and verifier addresses and are encoded at run time.',
  };
  files['IDENTITY.json'] = {
    campaign: B.campaign_id, tool: 'chainbench/adapters/public/scripts/build_public_inputs.js',
    controlled_references: B.controlled_references, checks, all_pass: checks.every((c) => c.pass),
  };
  const outData = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, J(v)]));
  const man = Object.keys(outData).sort().map((k) => `${sha(Buffer.from(outData[k]))}  ${k}`).join('\n') + '\n';
  outData['INPUTS.sha256'] = man;
  if (process.argv.includes('--check')) {
    const stale = Object.keys(outData).filter((k) => !fs.existsSync(path.join(OUT, k)) || fs.readFileSync(path.join(OUT, k), 'utf8') !== outData[k]);
    console.log(`build_public_inputs --check: ${stale.length ? 'STALE: ' + stale.join(', ') : 'up to date'}; identity checks ${checks.filter((c) => c.pass).length}/${checks.length}`);
    process.exit(stale.length || !checks.every((c) => c.pass) ? 1 : 0);
  }
  if (!checks.every((c) => c.pass)) { console.error('build_public_inputs: identity checks failed; nothing written'); process.exit(1); }
  for (const [k, v] of Object.entries(outData)) { fs.mkdirSync(path.dirname(path.join(OUT, k)), { recursive: true }); fs.writeFileSync(path.join(OUT, k), v); }
  console.log(`build_public_inputs: ${Object.keys(outData).length} files in ${B.inputs_dir}; identity checks ${checks.length}/${checks.length}`);
}
// snarkjs keeps worker threads alive: exit explicitly.
main().then(() => process.exit(0), (e) => { console.error(e.stack || String(e)); process.exit(1); });
