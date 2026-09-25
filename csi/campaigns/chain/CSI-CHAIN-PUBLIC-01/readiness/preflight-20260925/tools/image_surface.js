'use strict';
// CSI-CHAIN-PUBLIC-01 final pre-flight: inventory of the chainbench-public image itself (run WITHOUT the repository
// mount, --network none): runtime versions, the installed npm graph, install hooks, native addons, Hardhat presence and
// the executable surface. Prints one JSON document. Reads nothing secret; needs no key and no network.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const AD = '/repo/chainbench/adapters/public';
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { return `ERROR: ${String(e.stderr || e.message).trim().slice(0, 300)}`; } };
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const pkgs = [];
function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === '.bin' || e.name === '.package-lock.json') continue;
    const p = path.join(d, e.name);
    if (e.name.startsWith('@')) { walk(p); continue; }
    const pj = path.join(p, 'package.json');
    if (fs.existsSync(pj)) {
      const j = JSON.parse(fs.readFileSync(pj, 'utf8'));
      const s = j.scripts || {};
      pkgs.push({ path: path.relative(AD, p), name: j.name, version: j.version, install_hooks: ['preinstall', 'install', 'postinstall', 'prepare'].filter((k) => s[k]).map((k) => `${k}: ${s[k]}`),
        binding_gyp: fs.existsSync(path.join(p, 'binding.gyp')), gypfile: !!j.gypfile, bin: j.bin || null });
    }
    walk(path.join(p, 'node_modules'));
  }
}
walk(path.join(AD, 'node_modules'));
const lock = JSON.parse(fs.readFileSync(path.join(AD, 'package-lock.json'), 'utf8'));
const lockPkgs = Object.entries(lock.packages).filter(([k]) => k).map(([k, v]) => ({ path: k, version: v.version, integrity: v.integrity || null, hasInstallScript: !!v.hasInstallScript }));
const out = {
  kind: 'chainbench-public image inventory (pre-flight engineering record)',
  node: process.version, npm: sh('npm --version'), arch: process.arch, uname_m: sh('uname -m'),
  os_release: sh('. /etc/os-release && echo "$PRETTY_NAME"'), glibc: sh('ldd --version 2>&1 | head -1'),
  git: sh('git --version'), python3: sh('python3 --version'),
  git_system_config: sh('git config --system --list'),
  image_files: { 'package.json': sha(path.join(AD, 'package.json')), 'package-lock.json': sha(path.join(AD, 'package-lock.json')) },
  npm_packages_txt: sh('cat /opt/chainbench/NPM-PACKAGES.txt'), apt_packages_txt: sh('cat /opt/chainbench/APT-PACKAGES.txt'),
  installed_packages: pkgs.sort((a, b) => a.path.localeCompare(b.path)),
  lock_packages: lockPkgs,
  node_modules_bin: fs.existsSync(path.join(AD, 'node_modules', '.bin')) ? fs.readdirSync(path.join(AD, 'node_modules', '.bin')).sort() : [],
  global_npm: sh('npm ls -g --depth=0 --json'),
  usr_local_bin: sh('ls -1 /usr/local/bin').split('\n'),
  opt: sh('ls -1 /opt').split('\n'),
  hardhat_paths: sh("find / -xdev \\( -path /proc -o -path /sys \\) -prune -o -iname '*hardhat*' -print 2>/dev/null | head -20"),
  solc_like_paths: sh("find / -xdev \\( -path /proc -o -path /sys \\) -prune -o \\( -iname 'solc*' -o -iname 'zksolc*' -o -iname 'anvil*' -o -iname 'snarkjs*' \\) -print 2>/dev/null | head -20"),
  dpkg_count: sh('dpkg-query -W -f=. | wc -c'),
  whoami: sh('id'),
};
console.log(JSON.stringify(out, null, 2));
