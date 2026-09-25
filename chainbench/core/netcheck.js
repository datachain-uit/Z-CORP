'use strict';
// Network isolation of the current network namespace (Linux), for the chainbench container (--network none).
// A --network none namespace can still list kernel fallback tunnel devices (gre0, sit0, tunl0, ...) in /sys/class/net;
// they are never up and carry no routes. Isolation is therefore judged on what can carry traffic:
//   no interface other than loopback is administratively up (IFF_UP), there is no IPv4 route in the main table, and
//   there is no IPv6 route through a non-loopback device.
// Workload- and venue-neutral. Returns null fields outside Linux.
const fs = require('fs');
const path = require('path');

function networkIsolation() {
  const NET = '/sys/class/net';
  let entries = null;
  try { entries = fs.readdirSync(NET).filter((n) => fs.statSync(path.join(NET, n)).isDirectory()).sort(); } catch (e) { return { isolated: null, reason: 'no /sys/class/net' }; }
  const up = entries.filter((n) => {
    if (n === 'lo') return false;
    try { return (parseInt(fs.readFileSync(path.join(NET, n, 'flags'), 'utf8').trim(), 16) & 0x1) === 1; } catch (e) { return true; }
  });
  let v4 = null; let v6 = null;
  try { v4 = fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1).filter(Boolean).length; } catch (e) { v4 = null; }
  try { v6 = fs.readFileSync('/proc/net/ipv6_route', 'utf8').trim().split('\n').filter(Boolean).map((l) => l.trim().split(/\s+/).pop()).filter((dev) => dev !== 'lo').length; } catch (e) { v6 = null; }
  const loUp = (() => { try { return (parseInt(fs.readFileSync(path.join(NET, 'lo', 'flags'), 'utf8').trim(), 16) & 0x1) === 1; } catch (e) { return false; } })();
  return {
    isolated: up.length === 0 && v4 === 0 && v6 === 0,
    interfaces: entries, up_non_loopback: up, loopback_up: loUp, ipv4_routes: v4, ipv6_non_loopback_routes: v6,
  };
}
module.exports = { networkIsolation };
if (require.main === module) console.log(JSON.stringify(networkIsolation(), null, 2));
