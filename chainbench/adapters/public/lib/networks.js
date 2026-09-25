'use strict';
// Network profiles of the public adapter (venue-neutral). The campaign binding names the networks, their chain ids and
// the chain ids that are always refused; this module only applies those rules.
class Refusal extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'Refusal'; }
}
function profile(binding, name) {
  const n = binding.networks[name];
  if (!n) throw new Refusal('unknown_network', `unknown network "${name}" (expected one of ${Object.keys(binding.networks).join(', ')})`);
  return { name, ...n };
}
// The chain id reported by the endpoint must be exactly the profile's; a local/dev or mainnet id, or the id of the other
// public network, is refused with its own reason.
function checkChainId(binding, prof, reportedHex) {
  const id = Number(BigInt(reportedHex));
  const refused = binding.refused_chain_ids || {};
  if (refused[String(id)]) throw new Refusal('refused_chain_id', `endpoint reports chain id ${id} (${refused[String(id)]}); the ${prof.label} runner refuses it`);
  for (const [other, n] of Object.entries(binding.networks)) {
    if (other !== prof.name && n.chain_id === id) throw new Refusal('cross_network', `endpoint for ${prof.label} reports chain id ${id} (${n.label}); refused`);
  }
  if (id !== prof.chain_id) throw new Refusal('chain_id_mismatch', `endpoint reports chain id ${id}, ${prof.label} requires ${prof.chain_id}`);
  return id;
}
module.exports = { Refusal, profile, checkChainId };
