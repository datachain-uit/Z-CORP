'use strict';
// Engineering micro-diagnostic for the prover input stage (NOT part of any measurement campaign).
//
// For every depth it records the structure of the two JSON files that generateInputForDepth()
// reads (scripts/setup/generate_input_depth.js), and times, separately and with a warm file cache:
// the file reads, JSON.parse, input assembly and the output write, plus the unmodified
// generateInputForDepth() call itself. Outputs go to the OS temp directory; nothing in the
// repository is written. Timings depend on the machine and Node version it is run on and are
// not comparable with campaign values; only their split and growth with depth are of interest.
//
//   node scripts/analysis/input_stage_diagnostic.js [--repo <dir>] [--reps 9] [--depths 5-15]
// Prints one JSON document on stdout.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');

function arg(name, dflt) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; }
const repo = path.resolve(arg('repo', path.join(__dirname, '..', '..')));
const reps = Number(arg('reps', 9));
const [d0, d1] = arg('depths', '5-15').split('-').map(Number);
const gen = require(path.join(repo, 'scripts', 'setup', 'generate_input_depth.js'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zcorp-input-diag-'));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const time = (fn) => { const t0 = performance.now(); const r = fn(); return [performance.now() - t0, r]; };

const out = { tool: 'input_stage_diagnostic.js', node: process.version, platform: `${os.platform()} ${os.arch()}`,
  cpus: os.cpus().length, reps, note: 'engineering micro-diagnostic; not campaign data', depths: [] };
for (let d = d0; d <= d1; d++) {
  const processedFile = gen.resolveProcessedFile(d);
  const merkleFile = gen.resolveMerkleTreeFile(d);
  const outFile = path.join(tmp, `input_d${d}.json`);
  const rel = (f) => path.relative(repo, f);
  // Structure (untimed).
  const m = JSON.parse(fs.readFileSync(merkleFile, 'utf8'));
  const p = JSON.parse(fs.readFileSync(processedFile, 'utf8'));
  const siblings = m.proofs.reduce((a, x) => a + x.siblings.length, 0);
  const rec = {
    depth: d,
    processed_file: rel(processedFile), processed_bytes: fs.statSync(processedFile).size, processed_entries: p.length,
    merkle_file: rel(merkleFile), merkle_bytes: fs.statSync(merkleFile).size,
    merkle_keys: Object.keys(m), leaves: m.leaves.length, proofs: m.proofs.length, siblings_total: siblings,
    total_leaves_field: m.totalLeaves, real_leaves_field: m.realLeaves,
  };
  // Timed operations (warm cache: one untimed pass first).
  gen.generateInputForDepth(d, 0, { outputFile: outFile });
  const t = { read_ms: [], parse_ms: [], assemble_ms: [], write_ms: [], generate_ms: [] };
  for (let r = 0; r < reps; r++) {
    const [tr, texts] = time(() => [fs.readFileSync(processedFile, 'utf8'), fs.readFileSync(merkleFile, 'utf8')]);
    const [tp, objs] = time(() => [JSON.parse(texts[0]), JSON.parse(texts[1])]);
    const [ta, input] = time(() => {
      const dip = objs[0][0]; const pr = objs[1].proofs[0];
      return { nameHash: dip.nameHash, majorCode: dip.majorCode, studentId: dip.studentId, issueDate: dip.issueDate,
        pathIndices: pr.pathIndices, siblings: pr.siblings, root: objs[1].root };
    });
    const [tw] = time(() => fs.writeFileSync(outFile, JSON.stringify(input, null, 2)));
    const [tg] = time(() => gen.generateInputForDepth(d, 0, { outputFile: outFile }));
    t.read_ms.push(tr); t.parse_ms.push(tp); t.assemble_ms.push(ta); t.write_ms.push(tw); t.generate_ms.push(tg);
  }
  for (const k of Object.keys(t)) rec[`median_${k}`] = Number(median(t[k]).toFixed(3));
  rec.input_bytes = fs.statSync(outFile).size;
  out.depths.push(rec);
}
fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
