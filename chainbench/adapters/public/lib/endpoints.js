'use strict';
// Frozen endpoint identities and the provider/fallback policy (CHAIN-PUBLIC-PROTOCOL-v1 section 3). The binding freezes,
// per network, one primary endpoint (label, host, sha256 of the URL; the URL itself only when it is public) and,
// optionally, a validated secondary endpoint that was checked read-only. Live runs use the primary. The secondary may be
// used only after a documented operational failure of the primary, recorded as a protocol deviation (section 18) whose id
// is given in CHAINBENCH_PUBLIC_DEVIATION; there is no automatic fail-over. Rows keep the provider label, host and URL
// sha256 of the endpoint actually used, so a provider change is visible in every affected row.
const { Refusal } = require('./networks');

function frozenOf(binding, network) {
  const e = binding.endpoints || {};
  return { primary: (e.frozen || {})[network] || null, secondary: (e.secondary || {})[network] || null };
}
// Match an Rpc identity (label, host, url_sha256) to the frozen endpoints. Returns { role, frozen } or throws Refusal.
// The recorded label is the frozen label; a different label given for the same URL is refused.
function resolve(binding, network, ident, { deviation } = {}) {
  const { primary, secondary } = frozenOf(binding, network);
  if (!primary) throw new Refusal('endpoints_not_frozen', `no frozen primary endpoint for ${network} in the binding (author input, protocol section 17)`);
  const labelOk = (f) => ident.label_given === '' || ident.label_given === undefined || ident.label_given === f.label;
  if (ident.url_sha256 === primary.url_sha256 && ident.host === primary.host) {
    if (!labelOk(primary)) throw new Refusal('endpoint_label_mismatch', `${network}: the frozen primary endpoint is labelled "${primary.label}", not "${ident.label_given}"`);
    return { role: 'primary', frozen: primary };
  }
  if (secondary && ident.url_sha256 === secondary.url_sha256 && ident.host === secondary.host) {
    if (!labelOk(secondary)) throw new Refusal('endpoint_label_mismatch', `${network}: the validated secondary endpoint is labelled "${secondary.label}", not "${ident.label_given}"`);
    if (!deviation) throw new Refusal('secondary_without_deviation', `${network}: the secondary endpoint (${secondary.label}) may be used only after a documented failure of the primary, recorded as a protocol deviation (set CHAINBENCH_PUBLIC_DEVIATION to its id)`);
    return { role: `secondary (deviation ${deviation})`, frozen: secondary };
  }
  throw new Refusal('endpoint_not_frozen', `${network}: endpoint host ${ident.host} (url sha256 ${String(ident.url_sha256).slice(0, 12)}…) is neither the frozen primary nor the validated secondary`);
}
// Apply to an Rpc in live mode: the identity label becomes the frozen label; returns the role.
function apply(binding, network, rpc, labelGiven, opts) {
  const r = resolve(binding, network, { ...rpc.identity, label_given: labelGiven || '' }, opts);
  rpc.identity.label = r.frozen.label;
  rpc.identity.role = r.role;
  return r.role;
}
module.exports = { frozenOf, resolve, apply };
