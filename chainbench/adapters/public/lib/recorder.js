'use strict';
// Raw record writer. Every file passes a secret guard before it is written: if the signing key (with or without 0x, any
// case) occurs in the content, the run aborts and nothing is written.
const fs = require('fs');
const path = require('path');
const S = require('./schema');
class SecretLeak extends Error { constructor(p) { super(`refusing to write ${p}: it would contain the signing key`); this.code = 'secret_leak'; } }
function stable(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((a, k) => { a[k] = stable(v[k]); return a; }, {});
  return v;
}
class Recorder {
  constructor(dir, signer) { this.dir = dir; this.signer = signer; this.rows = []; fs.mkdirSync(dir, { recursive: true }); }
  write(rel, content) {
    const p = path.join(this.dir, rel);
    if (this.signer && this.signer.containsSecret(content)) throw new SecretLeak(rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return p;
  }
  json(rel, obj) { return this.write(rel, JSON.stringify(stable(obj), null, 2) + '\n'); }
  row(r) { this.rows.push(r); this.write('tx.jsonl', this.rows.map((x) => JSON.stringify(stable(x))).join('\n') + '\n'); this.write('tx.csv', S.csv(this.rows)); }
  rpcLog(entries) { this.write('rpc-log.jsonl', entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '')); }
  // Final scan of everything under the run directory.
  scan() {
    const bad = [];
    const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (this.signer && this.signer.containsSecret(fs.readFileSync(p, 'utf8'))) bad.push(path.relative(this.dir, p)); } };
    walk(this.dir);
    return bad;
  }
}
module.exports = { Recorder, SecretLeak, stable };
