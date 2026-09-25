'use strict';
// CSI-CHAIN-PUBLIC-01: tests of the pre-freeze guards (no key, no network, no transaction): the frozen-image record and
// its verification (lib/imageid.js), the live runner's image guard and its position before any key handling, the
// finality collector's image guard, the endpoint/fallback policy (lib/endpoints.js) and the live-only derivation checks
// VP12/VP13 (derive_chain_public.py). Run by tools/test_guards_public.sh; prints PASS/FAIL lines and a total.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const AD = path.resolve(__dirname, '..');
const CB = path.resolve(AD, '..', '..');
const REPO = path.resolve(CB, '..');
const IMG = require('../lib/imageid');
const EP = require('../lib/endpoints');
const res = [];
const t = (name, ok, detail) => { res.push({ name, pass: !!ok, detail: detail === undefined ? null : detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && !ok ? ' -- ' + JSON.stringify(detail).slice(0, 200) : ''}`); };
const code = (f) => { try { f(); return 'ok'; } catch (e) { return e.code || e.message; } };
const sha = (s) => 'sha256:' + crypto.createHash('sha256').update(s).digest('hex');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-guards-'));

// ---- I. image record (synthetic fixture: index -> manifest -> config)
const diff = ['sha256:' + 'a'.repeat(64), 'sha256:' + 'b'.repeat(64)];
const cfgB = JSON.stringify({ architecture: 'arm64', os: 'linux', rootfs: { type: 'layers', diff_ids: diff } });
const manB = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: sha(cfgB), size: cfgB.length }, layers: [] });
const idxB = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [{ mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: sha(manB), size: manB.length, platform: { architecture: 'arm64', os: 'linux' } }] });
const good = { image_id: sha(idxB), manifest_digest: sha(manB), config_digest: sha(cfgB), archive_sha256: 'c'.repeat(64), architecture: 'arm64', platform: 'linux/arm64',
  rootfs_layers_docker_json: JSON.stringify(diff), index_blob: idxB, manifest_blob: manB, config_blob: cfgB };
const write = (name, rec) => { const p = path.join(TMP, name); fs.writeFileSync(p, typeof rec === 'string' ? rec : JSON.stringify(rec, null, 2)); return p; };
const G = write('good.json', good);
t('image record: a consistent index -> manifest -> config chain loads', code(() => IMG.loadRecord(G)) === 'ok');
for (const [label, mut] of [['image_id', { image_id: 'sha256:' + '1'.repeat(64) }], ['manifest_digest', { manifest_digest: 'sha256:' + '2'.repeat(64) }],
  ['config_digest', { config_digest: 'sha256:' + '3'.repeat(64) }], ['config blob', { config_blob: cfgB.replace('arm64', 'amd64') }], ['architecture', { architecture: 'amd64' }],
  ['rootfs layers', { rootfs_layers_docker_json: JSON.stringify([diff[0]]) }], ['archive sha256 format', { archive_sha256: 'xyz' }]]) {
  t(`image record: tampered ${label} -> image_record_inconsistent`, code(() => IMG.loadRecord(write(`bad-${label.replace(/\s/g, '_')}.json`, { ...good, ...mut }))) === 'image_record_inconsistent');
}
t('image record: missing record -> image_record_missing', code(() => IMG.loadRecord(path.join(TMP, 'none.json'))) === 'image_record_missing');
t('image record: invalid JSON -> image_record_inconsistent', code(() => IMG.loadRecord(write('junk.json', '{not json'))) === 'image_record_inconsistent');
const envOf = (r, extra = {}) => ({ CHAINBENCH_PUBLIC_IMAGE_ID: r.image_id, CHAINBENCH_PUBLIC_IMAGE_MANIFEST: r.manifest_digest, CHAINBENCH_PUBLIC_IMAGE_CONFIG: r.config_digest,
  CHAINBENCH_PUBLIC_IMAGE_ARCHIVE_SHA256: r.archive_sha256, CHAINBENCH_PUBLIC_IMAGE_ARCH: r.architecture, CHAINBENCH_PUBLIC_IMAGE_PLATFORM: r.platform, CHAINBENCH_PUBLIC_IMAGE_CHECK: 'pass', ...extra });
t('live image guard: no wrapper identity -> image_unverified', code(() => IMG.verifyLive({}, G)) === 'image_unverified');
t('live image guard: identity of a non-frozen image (check != pass) -> image_unverified', code(() => IMG.verifyLive(envOf(good, { CHAINBENCH_PUBLIC_IMAGE_CHECK: 'not-frozen' }), G)) === 'image_unverified');
for (const k of IMG.FIELDS) {
  const e = envOf(good); e[IMG.ENV[k]] = k === 'architecture' ? 'amd64' : k === 'platform' ? 'linux/amd64' : k === 'archive_sha256' ? 'd'.repeat(64) : 'sha256:' + 'e'.repeat(64);
  t(`live image guard: ${k} differs from the frozen record -> image_mismatch`, code(() => IMG.verifyLive(e, G)) === 'image_mismatch');
}
let idn = null; const okc = code(() => { idn = IMG.verifyLive(envOf(good), G); });
t('live image guard: the exact frozen identity passes and is returned for run.json (index, manifest, config, archive, architecture, platform)', okc === 'ok' && idn && IMG.FIELDS.every((k) => idn[k] === good[k]) && /^[0-9a-f]{64}$/.test(idn.record_sha256));
const realRec = fs.existsSync(IMG.RECORD);
if (realRec) t('the committed frozen image record (chainbench/adapters/public/ARCHIVE.json) verifies', code(() => IMG.loadRecord()) === 'ok');
else console.log('SKIP the committed frozen image record: not written yet (save-image-public)');

// ---- II. the live runner and the finality collector refuse before any key handling
const cleanEnv = () => { const e = { ...process.env }; for (const k of Object.keys(e)) if (k.startsWith('CHAINBENCH_PUBLIC_')) delete e[k]; return e; };
const base = { ...cleanEnv(), CHAINBENCH_CAMPAIGN: 'CSI-CHAIN-PUBLIC-01', CHAINBENCH_PUBLIC_RPC_SEPOLIA: 'https://127.0.0.1:9', CHAINBENCH_PUBLIC_RPC_ERA_SEPOLIA: 'https://127.0.0.1:9' };
const run = (script, args, env) => spawnSync(process.execPath, [path.join(AD, 'scripts', script), ...args], { cwd: CB, env, encoding: 'utf8', timeout: 60000 });
const LIVE = ['--mode', 'live', '--phase', 'setup', '--network', 'sepolia', '--confirm', 'setup-sepolia'];
const firstRefusal = (r) => { const m = /\[REFUSED\] ([a-z_]+):/.exec(r.stderr || ''); return m ? m[1] : `exit ${r.status}`; };
let r = run('run_public.js', LIVE, base);
const want0 = realRec ? 'image_unverified' : 'image_record_missing';
t(`live setup without the wrapper's image identity -> ${want0} (exit 3), before the key is looked at`, r.status === 3 && firstRefusal(r) === want0 && !/no_key/.test(r.stderr), { status: r.status, refusal: firstRefusal(r) });
r = run('run_public.js', ['--mode', 'live', '--phase', 'session', '--session', 'S1', '--confirm', 'S1'], base);
t(`live session without the wrapper's image identity -> ${want0} (exit 3)`, r.status === 3 && firstRefusal(r) === want0, { status: r.status, refusal: firstRefusal(r) });
r = run('collect_era_finality.js', ['--mode', 'live', '--root', TMP], base);
t(`live finality collection without the wrapper's image identity -> ${want0} (exit 3)`, r.status === 3 && firstRefusal(r) === want0, { status: r.status, refusal: firstRefusal(r) });
if (realRec) {
  const rec = IMG.loadRecord();
  r = run('run_public.js', LIVE, { ...base, ...envOf(rec, { CHAINBENCH_PUBLIC_IMAGE_ARCHIVE_SHA256: 'f'.repeat(64) }) });
  t('live setup with an identity that differs from the frozen record -> image_mismatch (exit 3)', r.status === 3 && firstRefusal(r) === 'image_mismatch', { refusal: firstRefusal(r) });
  r = run('run_public.js', LIVE, { ...base, ...envOf(rec) });
  const c = firstRefusal(r);
  t('live setup with the exact frozen identity passes the image guard; the next guard refuses (no key configured; nothing sent)', r.status === 3 && !/^image_/.test(c) && ['dirty_tree', 'no_key'].includes(c), { refusal: c });
} else console.log('SKIP live runner with the committed record: not written yet');

// ---- III. endpoint / fallback policy
const Bt = { endpoints: { frozen: { 'era-sepolia': { role: 'primary', label: 'Primary', host: 'p.example', url_sha256: 'P' } },
  secondary: { 'era-sepolia': { role: 'validated fallback / read-only compatibility', label: 'Second', host: 's.example', url_sha256: 'S' } } } };
const rs = (ident, dev) => { try { return EP.resolve(Bt, 'era-sepolia', ident, { deviation: dev }).role; } catch (e) { return e.code; } };
t('endpoint policy: the frozen primary -> primary', rs({ host: 'p.example', url_sha256: 'P', label_given: '' }) === 'primary');
t('endpoint policy: the frozen primary under another label -> endpoint_label_mismatch', rs({ host: 'p.example', url_sha256: 'P', label_given: 'Other' }) === 'endpoint_label_mismatch');
t('endpoint policy: the validated secondary without a recorded deviation -> secondary_without_deviation (no automatic fail-over)', rs({ host: 's.example', url_sha256: 'S', label_given: '' }) === 'secondary_without_deviation');
t('endpoint policy: the validated secondary with a recorded deviation -> secondary (deviation id recorded)', rs({ host: 's.example', url_sha256: 'S', label_given: 'Second' }, 'D1') === 'secondary (deviation D1)');
t('endpoint policy: any other endpoint -> endpoint_not_frozen', rs({ host: 'x.example', url_sha256: 'X', label_given: '' }, 'D1') === 'endpoint_not_frozen');
t('endpoint policy: no frozen primary -> endpoints_not_frozen', (() => { try { EP.resolve({ endpoints: {} }, 'sepolia', { host: 'h', url_sha256: 'u' }); return 'ok'; } catch (e) { return e.code; } })() === 'endpoints_not_frozen');

// ---- IV. live-only derivation checks (VP12 image, VP13 endpoints)
const py = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('d', ${JSON.stringify(path.join(REPO, 'scripts', 'analysis', 'derive_chain_public.py'))}); d = importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
rec = d.image_record(${JSON.stringify(G)}); assert rec is not None
img = {k: rec[k] for k in d.IMG_FIELDS}; img['verified_by_wrapper'] = 'pass'
led = [{'phase': 'post', 'result': 'pass', 'image_id': rec['image_id'], 'run_ids': ['R1']}]
out = {}
out['vp12_ok'] = d.live_image_check({'image': img}, 'R1', rec, led)[0]
out['vp12_no_post'] = d.live_image_check({'image': img}, 'R1', rec, [])[0]
out['vp12_post_failed'] = d.live_image_check({'image': img}, 'R1', rec, [dict(led[0], result='failed image_mismatch')])[0]
out['vp12_other_image'] = d.live_image_check({'image': dict(img, config_digest='sha256:' + '9'*64)}, 'R1', rec, led)[0]
B = {'endpoints': {'frozen': {'sepolia': {'label': 'A', 'host': 'h', 'url_sha256': 'u'}}, 'secondary': {'sepolia': {'label': 'B', 'host': 'h2', 'url_sha256': 'u2'}}}}
rows = [{'network': 'sepolia', 'provider_label': 'A', 'endpoint_host': 'h', 'endpoint_url_sha256': 'u'}]
out['vp13_ok'] = d.live_endpoint_check({'endpoints': {'sepolia': {'label': 'A', 'host': 'h', 'url_sha256': 'u', 'role': 'primary'}}}, rows, B)[0]
out['vp13_secondary_no_dev'] = d.live_endpoint_check({'endpoints': {'sepolia': {'label': 'B', 'host': 'h2', 'url_sha256': 'u2', 'role': 'secondary (deviation X)'}}}, rows, B)[0]
out['vp13_secondary_dev'] = d.live_endpoint_check({'deviation': 'X', 'endpoints': {'sepolia': {'label': 'B', 'host': 'h2', 'url_sha256': 'u2', 'role': 'secondary (deviation X)'}}}, [dict(rows[0], provider_label='B', endpoint_host='h2', endpoint_url_sha256='u2')], B)[0]
out['vp13_row_mismatch'] = d.live_endpoint_check({'endpoints': {'sepolia': {'label': 'A', 'host': 'h', 'url_sha256': 'u', 'role': 'primary'}}}, [dict(rows[0], endpoint_url_sha256='zz')], B)[0]
print(json.dumps(out))`;
const pr = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
let o = {}; try { o = JSON.parse(pr.stdout); } catch (e) { o = {}; }
t('derive VP12: frozen image recorded and re-verified after the run -> pass', o.vp12_ok === true, pr.stderr);
t('derive VP12: no post-flight image check -> fail', o.vp12_no_post === false);
t('derive VP12: failed post-flight image check -> fail', o.vp12_post_failed === false);
t('derive VP12: another image -> fail', o.vp12_other_image === false);
t('derive VP13: frozen primary, rows carry it -> pass', o.vp13_ok === true);
t('derive VP13: secondary without a recorded deviation -> fail', o.vp13_secondary_no_dev === false);
t('derive VP13: secondary with a recorded deviation, rows carry it -> pass', o.vp13_secondary_dev === true);
t('derive VP13: a row that does not carry the endpoint used -> fail', o.vp13_row_mismatch === false);

fs.rmSync(TMP, { recursive: true, force: true });
const n = res.filter((x) => x.pass).length;
console.log(`GUARD-TESTS (node): ${n}/${res.length} pass`);
if (process.env.CB_GUARD_JSON) fs.writeFileSync(process.env.CB_GUARD_JSON, JSON.stringify(res, null, 2) + '\n');
process.exit(n === res.length ? 0 : 1);
