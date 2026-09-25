'use strict';
// Wall clock (UTC ISO-8601, ms) and monotonic clock (ms since the process origin, microsecond resolution).
const ORIGIN = process.hrtime.bigint();
const ORIGIN_UTC = new Date().toISOString();
function now() {
  const ns = process.hrtime.bigint() - ORIGIN;
  return { utc: new Date().toISOString(), mono_ms: Number(ns / 1000n) / 1000 };
}
module.exports = { now, ORIGIN_UTC };
