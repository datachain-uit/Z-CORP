'use strict';
// Key safety (CHAIN-PUBLIC-PROTOCOL-v1 section 6). The public runner signs only with a dedicated, externally supplied raw
// private key: from a file outside the repository (mode 0600 or 0400) or from an environment variable. It refuses a
// mnemonic, a key inside the repository, a group/world-readable key file, and any key whose address is a known
// development account: the first 20 accounts of every mnemonic in the reproducibility configuration (read from the
// chainbench constants at run time, never copied here) and the legacy anvil-zksync / era-test-node rich wallets. The key
// stays inside this module's closure: it is never returned, printed, logged or written; only the address leaves.
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { EIP712Signer, utils: zu } = require('zksync-ethers');
const { Refusal } = require('./networks');

// Public addresses of the legacy anvil-zksync / era-test-node rich wallets (all ten are embedded in the pinned
// anvil-zksync 0.6.11 binary). Addresses only.
const LEGACY_RICH_WALLETS = [
  '0x36615Cf349d7F6344891B1e7CA7C72883F5dc049', '0xa61464658AfeAf65CccaaFD3a512b69A83B77618', '0x0D43eB5B8a47bA8900d84AA36656c92024e9772e',
  '0xA13c10C0D5bd6f79041B9835c63f91de35A15883', '0x8002cD98Cfb563492A6fB3E7C8243b7B9Ad4cc92', '0x4F9133D1d3F50011A6859807C837bdCB31Aaab13',
  '0xbd29A1B981925B94eEc5c4F1125AF02a2Ec4d1cA', '0xedB6F5B4aab3dD95C7806Af42881FF12BE7e9daa', '0xe706e60ab5Dc512C36A4646D719b889F398cbBcB',
  '0xE90E12261CCb0F3F7976Ae611A29e84a6A85f424',
];
const DEV_MNEMONIC_SOURCES = ['chainbench/lib/constants.js', 'chainbench/adapters/eravm/lib/constants.js'];
const DEV_ACCOUNTS = 20;
const refuse = (code, msg) => { throw new Refusal(code, msg); };

function devAccounts(repo) {
  const m = new Map();
  let mnemonics = 0;
  for (const rel of DEV_MNEMONIC_SOURCES) {
    const p = path.join(repo, rel);
    if (!fs.existsSync(p)) continue;
    const hit = /const MNEMONIC = '([^']+)'/.exec(fs.readFileSync(p, 'utf8'));
    if (!hit) continue;
    mnemonics++;
    for (let i = 0; i < DEV_ACCOUNTS; i++) {
      const w = ethers.HDNodeWallet.fromPhrase(hit[1], undefined, `m/44'/60'/0'/0/${i}`);
      m.set(w.address.toLowerCase(), `account ${i} of the development mnemonic in ${rel}`);
    }
  }
  if (!mnemonics) refuse('dev_list_unavailable', 'the development mnemonics of the reproducibility configuration could not be read; refusing to sign');
  for (const a of LEGACY_RICH_WALLETS) m.set(a.toLowerCase(), 'legacy anvil-zksync / era-test-node rich wallet');
  return m;
}
function readKey(repo, env) {
  const file = env.CHAINBENCH_PUBLIC_KEY_FILE; const val = env.CHAINBENCH_PUBLIC_PRIVATE_KEY;
  if (file && val) refuse('two_key_sources', 'set either CHAINBENCH_PUBLIC_KEY_FILE or CHAINBENCH_PUBLIC_PRIVATE_KEY, not both');
  if (!file && !val) refuse('no_key', 'no signing key configured (CHAINBENCH_PUBLIC_KEY_FILE or CHAINBENCH_PUBLIC_PRIVATE_KEY)');
  let text; let source;
  if (file) {
    if (!path.isAbsolute(file)) refuse('key_file_not_absolute', 'CHAINBENCH_PUBLIC_KEY_FILE must be an absolute path outside the repository');
    let real;
    try { real = fs.realpathSync(file); } catch (e) { refuse('key_file_missing', 'the key file does not exist or is not readable'); }
    const repoReal = fs.realpathSync(repo);
    if (real === repoReal || real.startsWith(repoReal + path.sep)) refuse('key_file_in_repository', 'the key file is inside the repository; keep it outside (it must never be committed)');
    const st = fs.statSync(real);
    if (!st.isFile()) refuse('key_file_not_regular', 'the key file is not a regular file');
    if (st.mode & 0o077) refuse('key_file_permissions', 'the key file is readable by group or others; chmod 600 it');
    if (st.size > 256) refuse('key_file_format', 'the key file must contain only the 0x-prefixed private key');
    text = fs.readFileSync(real, 'utf8'); source = 'file';
  } else { text = val; source = 'env'; }
  const t = String(text).trim();
  if (/^[a-zA-Z]+(\s+[a-zA-Z]+){11,23}$/.test(t)) refuse('mnemonic_refused', 'a mnemonic is not accepted; supply the dedicated account\'s raw private key');
  if (!/^0x[0-9a-fA-F]{64}$/.test(t)) refuse('key_format', 'the key must be one 0x-prefixed 32-byte hex string');
  return { key: t.toLowerCase(), source };
}
function loadSigner(repo, env = process.env) {
  const { key, source } = readKey(repo, env);
  let wallet;
  try { wallet = new ethers.Wallet(key); } catch (e) { refuse('key_invalid', 'not a valid secp256k1 private key'); }
  const hit = devAccounts(repo).get(wallet.address.toLowerCase());
  if (hit) refuse('dev_account', `the signer ${wallet.address} is a known development account (${hit}); a dedicated funded key is required`);
  const needle = key.slice(2);
  return {
    address: wallet.address,
    key_source: source,
    containsSecret(text) { return String(text).toLowerCase().includes(needle); },
    async signEvm(tx) { return wallet.signTransaction(tx); },
    async signEra(tx) {
      const signer = new EIP712Signer(wallet, Number(tx.chainId));
      const customSignature = await signer.sign(tx);
      return zu.serializeEip712({ ...tx, customData: { ...tx.customData, customSignature } });
    },
  };
}
module.exports = { loadSigner, devAccounts, LEGACY_RICH_WALLETS };
