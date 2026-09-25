'use strict';
// Frozen public-runner image identity (CHAIN-PUBLIC-PROTOCOL-v1 section 13). The authoritative identity is the versioned
// record chainbench/adapters/public/ARCHIVE.json, written by `run.sh save-image-public` from the saved OCI archive: the
// image-index digest (= the Docker image ID under the containerd image store), the platform manifest, the config, the
// archive sha256 and the architecture, with the exact index, manifest and config blobs so that the chain
// index -> manifest -> config can be re-verified offline. A Docker tag is never identity.
// The host wrapper (run-public.sh) verifies the loaded image against the record before and after every live command and
// passes the verified identity to the container (CHAINBENCH_PUBLIC_IMAGE_*); live runs refuse without it, before any key
// is loaded.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Refusal } = require('./networks');

const RECORD = path.resolve(__dirname, '..', 'ARCHIVE.json');
const FIELDS = ['image_id', 'manifest_digest', 'config_digest', 'archive_sha256', 'architecture', 'platform'];
const ENV = { image_id: 'CHAINBENCH_PUBLIC_IMAGE_ID', manifest_digest: 'CHAINBENCH_PUBLIC_IMAGE_MANIFEST', config_digest: 'CHAINBENCH_PUBLIC_IMAGE_CONFIG',
  archive_sha256: 'CHAINBENCH_PUBLIC_IMAGE_ARCHIVE_SHA256', architecture: 'CHAINBENCH_PUBLIC_IMAGE_ARCH', platform: 'CHAINBENCH_PUBLIC_IMAGE_PLATFORM' };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const DIG = /^sha256:[0-9a-f]{64}$/;

// Load and self-verify an image record; throws Refusal('image_record_missing' | 'image_record_inconsistent').
function loadRecord(file = RECORD) {
  if (!fs.existsSync(file)) throw new Refusal('image_record_missing', `no frozen public image record (${path.basename(file)}); run save-image-public (author) and commit it`);
  let r;
  try { r = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Refusal('image_record_inconsistent', 'the image record is not valid JSON'); }
  const bad = (m) => { throw new Refusal('image_record_inconsistent', `image record: ${m}`); };
  for (const k of ['image_id', 'manifest_digest', 'config_digest']) if (!DIG.test(r[k] || '')) bad(`${k} is not a sha256 digest`);
  if (!/^[0-9a-f]{64}$/.test(r.archive_sha256 || '')) bad('archive_sha256 is not a sha256');
  if (typeof r.index_blob !== 'string' || typeof r.manifest_blob !== 'string' || typeof r.config_blob !== 'string') bad('index/manifest/config blobs missing');
  if (`sha256:${sha(r.index_blob)}` !== r.image_id) bad('sha256(index blob) != image_id');
  const idx = JSON.parse(r.index_blob);
  const m = (idx.manifests || []).find((x) => x.digest === r.manifest_digest);
  if (!m || !m.platform || m.platform.architecture !== r.architecture || `${m.platform.os}/${m.platform.architecture}` !== r.platform) bad('the index does not list the platform manifest for the recorded platform');
  if (`sha256:${sha(r.manifest_blob)}` !== r.manifest_digest) bad('sha256(manifest blob) != manifest_digest');
  const man = JSON.parse(r.manifest_blob);
  if (!man.config || man.config.digest !== r.config_digest) bad('the manifest does not reference the recorded config');
  if (`sha256:${sha(r.config_blob)}` !== r.config_digest) bad('sha256(config blob) != config_digest');
  const cfg = JSON.parse(r.config_blob);
  if (cfg.architecture !== r.architecture || cfg.os !== (r.platform || '').split('/')[0]) bad('config architecture/os differ from the record');
  if (JSON.stringify(cfg.rootfs.diff_ids) !== r.rootfs_layers_docker_json) bad('rootfs layers differ from the config');
  return r;
}
function identity(r) { return Object.fromEntries(FIELDS.map((k) => [k, r[k]])); }
// The identity the wrapper passed in (null if none).
function fromEnv(env = process.env) {
  if (!env[ENV.image_id]) return null;
  const o = Object.fromEntries(FIELDS.map((k) => [k, env[ENV[k]] || '']));
  o.verified_by_wrapper = env.CHAINBENCH_PUBLIC_IMAGE_CHECK || '';
  o.precheck_utc = env.CHAINBENCH_PUBLIC_IMAGE_CHECK_UTC || '';
  return o;
}
// Live runs: the wrapper-verified identity must be present and equal the frozen record, field by field.
function verifyLive(env = process.env, file = RECORD) {
  const rec = loadRecord(file);
  const got = fromEnv(env);
  if (!got || got.verified_by_wrapper !== 'pass') throw new Refusal('image_unverified', 'live runs must be started through ./chainbench/run.sh with the frozen image (identity not verified by the wrapper)');
  const diff = FIELDS.filter((k) => got[k] !== rec[k]);
  if (diff.length) throw new Refusal('image_mismatch', `the running image is not the frozen public image (${diff.join(', ')} differ)`);
  return { ...identity(rec), record: path.relative(path.resolve(__dirname, '..', '..', '..', '..'), file), record_sha256: sha(fs.readFileSync(file)),
    verified_by_wrapper: got.verified_by_wrapper, precheck_utc: got.precheck_utc };
}
module.exports = { RECORD, FIELDS, ENV, loadRecord, identity, fromEnv, verifyLive };
