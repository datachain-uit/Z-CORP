'use strict';
// Stage the committed sources of a profile byte-for-byte under .stage/<profile>/ (CHAIN-PROTOCOL-v1 §4).
const fs = require('fs');
const path = require('path');
const C = require('./common');
const P = require('./profiles');
function stage(name) {
  const p = P.get(name);
  fs.rmSync(p.root, { recursive: true, force: true });
  const files = [];
  for (const rel of p.files) {
    const src = path.join(C.REPO, rel);
    const dst = path.join(p.root, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    const sha = C.sha256File(dst);
    if (sha !== C.sha256File(src)) throw new Error(`staging mismatch ${rel}`);
    let blob = '';
    try { blob = C.git(['rev-parse', `HEAD:${rel}`]); } catch (e) { blob = 'NOT_IN_HEAD'; }
    const wt = C.git(['hash-object', rel]);
    files.push({ path: rel, sha256: sha, git_blob_worktree: wt, git_blob_head: blob, equals_head: blob === wt });
  }
  return { profile: name, root: path.relative(C.CHAINBENCH, p.root), files };
}
module.exports = { stage };
if (require.main === module) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : P.NAMES;
  for (const n of names) console.log(JSON.stringify(stage(n)));
}
