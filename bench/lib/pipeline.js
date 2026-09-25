'use strict';
// One proving pipeline (protocol v3 §3.1) and one diagnostic pair (§3.4).
// All temporary files go to container-local tmp; the repository is read-only.
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { artifacts, round3 } = require('./common');

const TMP = process.env.ZCORP_TMP || '/tmp/zcorp-work';

function gc() {
  if (typeof global.gc !== 'function') throw new Error('run node with --expose-gc');
  global.gc();
}

function memMb() {
  const m = process.memoryUsage();
  return { heap_used_mb: round3(m.heapUsed / 2 ** 20), rss_mb: round3(m.rss / 2 ** 20) };
}

// Context shared by all pipelines in one container process.
function makeContext({ snarkjs, generateInputForDepth, configs, zkeyHashes }) {
  fs.mkdirSync(TMP, { recursive: true });
  const perConfig = {};
  for (const c of configs) {
    const a = artifacts(c.backend, c.depth);
    perConfig[c.key] = {
      a,
      vkey: JSON.parse(fs.readFileSync(a.abs.vkey, 'utf8')),
      expectedRoot: String(JSON.parse(fs.readFileSync(a.abs.public, 'utf8'))[0]),
      committedInput: JSON.stringify(JSON.parse(fs.readFileSync(a.abs.input, 'utf8'))),
      zkeyBytes: fs.statSync(a.abs.zkey).size,
      zkeySha256: zkeyHashes[a.rel.zkey],
    };
  }
  return { snarkjs, generateInputForDepth, perConfig };
}

// input -> witness -> prove -> verify_first, then 3 steady-state verifies.
// wall_ms: end-to-end wall-clock latency of the complete pipeline, from immediately before the
// input stage to immediately after verify_first, including all glue I/O between stages.
// stage_sum_ms: input_ms + witness_ms + prove_ms + verify_first_ms (derived diagnostic).
async function runPipeline(ctx, config) {
  const { snarkjs } = ctx;
  const pc = ctx.perConfig[config.key];
  const inputFile = path.join(TMP, `input_${config.backend}_d${config.depth}.json`);
  const wtnsFile = path.join(TMP, `${config.backend}_d${config.depth}.wtns`);

  const tWall0 = performance.now();
  const tIn0 = performance.now();
  ctx.generateInputForDepth(config.depth, 0, { outputFile: inputFile });
  const tIn1 = performance.now();
  const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  const tW0 = performance.now();
  await snarkjs.wtns.calculate(input, pc.a.abs.wasm, wtnsFile);
  const tW1 = performance.now();
  const tP0 = performance.now();
  const { proof, publicSignals } = await snarkjs[config.backend].prove(pc.a.abs.zkey, wtnsFile);
  const tP1 = performance.now();
  const tV0 = performance.now();
  const verified = await snarkjs[config.backend].verify(pc.vkey, publicSignals, proof);
  const tV1 = performance.now();
  const tWall1 = performance.now();

  const steady = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    await snarkjs[config.backend].verify(pc.vkey, publicSignals, proof);
    steady.push(performance.now() - t0);
  }
  steady.sort((x, y) => x - y);

  const inputMs = tIn1 - tIn0;
  const witnessMs = tW1 - tW0;
  const proveMs = tP1 - tP0;
  const verifyFirstMs = tV1 - tV0;
  const publicRoot = String(publicSignals[0]);
  return {
    input_ms: round3(inputMs),
    witness_ms: round3(witnessMs),
    prove_ms: round3(proveMs),
    verify_first_ms: round3(verifyFirstMs),
    verify_steady_ms: round3(steady[1]),
    stage_sum_ms: round3(inputMs + witnessMs + proveMs + verifyFirstMs),
    wall_ms: round3(tWall1 - tWall0),
    zkey_bytes: pc.zkeyBytes,
    zkey_sha256: pc.zkeySha256,
    proof_valid: verified === true,
    root_matches: publicSignals.length === 1 && publicRoot === pc.expectedRoot && String(input.root) === pc.expectedRoot,
    input_matches_committed: JSON.stringify(input) === pc.committedInput,
    public_root: publicRoot,
    expected_root: pc.expectedRoot,
    ...memMb(),
  };
}

// Diagnostic pair: the same unchanged prover called with the zkey path and with the zkey
// bytes preloaded in memory (fastfile in-memory backend). Witness prepared untimed.
async function runDiagPair(ctx, config, pairOrder) {
  const { snarkjs } = ctx;
  const pc = ctx.perConfig[config.key];
  const inputFile = path.join(TMP, `diag_input_${config.backend}_d${config.depth}.json`);
  const wtnsFile = path.join(TMP, `diag_${config.backend}_d${config.depth}.wtns`);
  ctx.generateInputForDepth(config.depth, 0, { outputFile: inputFile });
  const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  await snarkjs.wtns.calculate(input, pc.a.abs.wasm, wtnsFile);

  const calls = pairOrder === 'path_first' ? ['path', 'mem'] : ['mem', 'path'];
  const out = [];
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    let readMs = null;
    let zkeyArg = pc.a.abs.zkey;
    const startedAt = new Date().toISOString();
    if (call === 'mem') {
      gc();
      const r0 = performance.now();
      zkeyArg = fs.readFileSync(pc.a.abs.zkey);
      readMs = performance.now() - r0;
    }
    gc();
    const t0 = performance.now();
    const { proof, publicSignals } = await snarkjs[config.backend].prove(zkeyArg, wtnsFile);
    const proveMs = performance.now() - t0;
    zkeyArg = null;
    const verified = await snarkjs[config.backend].verify(pc.vkey, publicSignals, proof);
    out.push({
      call,
      call_position: i + 1,
      started_at_utc: startedAt,
      zkey_readfile_ms: readMs === null ? null : round3(readMs),
      prove_ms: round3(proveMs),
      zkey_bytes: pc.zkeyBytes,
      zkey_sha256: pc.zkeySha256,
      proof_valid: verified === true,
      root_matches: String(publicSignals[0]) === pc.expectedRoot,
      ...memMb(),
    });
  }
  return out;
}

module.exports = { TMP, gc, makeContext, runPipeline, runDiagPair };
