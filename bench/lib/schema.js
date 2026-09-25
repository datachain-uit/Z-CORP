'use strict';
// Raw-data schemas (protocol v3 §7.2). Column order is fixed; the summary script checks headers.
// session_id and round_attempt identify the runner session and the attempt of a (kind, round)
// unit; only the accepted attempt of each unit (prover/round_ledger.csv) enters the summaries.

const RUNS = [
  'campaign_id', 'session_id', 'profile_id', 'container_id', 'kind', 'run_id', 'round', 'round_attempt',
  'order_in_round', 'seed', 'is_warmup', 'warmup_kind', 'backend', 'depth', 'leaf_index', 'started_at_utc',
  'input_ms', 'witness_ms', 'prove_ms', 'verify_first_ms', 'verify_steady_ms',
  'stage_sum_ms', 'wall_ms',
  'zkey_bytes', 'zkey_sha256', 'proof_valid', 'root_matches', 'input_matches_committed',
  'public_root', 'expected_root', 'heap_used_mb', 'rss_mb', 'image_id', 'manifest_sha256',
  'status', 'error',
];

const DIAG = [
  'campaign_id', 'session_id', 'profile_id', 'container_id', 'diag_round', 'round_attempt', 'seed',
  'backend', 'depth', 'pair_order', 'call', 'call_position', 'started_at_utc', 'zkey_readfile_ms', 'prove_ms',
  'zkey_bytes', 'zkey_sha256', 'proof_valid', 'root_matches', 'heap_used_mb', 'rss_mb',
  'image_id', 'manifest_sha256', 'status', 'error',
];

const ROUNDS = [
  'campaign_id', 'session_id', 'profile_id', 'kind', 'round', 'round_attempt', 'position_in_round',
  'container_id', 'image_id', 'cpuset', 'zcorp_cpus', 'os_cpus_length', 'available_parallelism',
  'ffjs_concurrency', 'heap_limit_mb', 'started_at_utc', 'ended_at_utc', 'rows_written', 'memory_peak_bytes',
  'memory_max_bytes', 'swap_max', 'cpu_max', 'oom_kill', 'nr_throttled', 'repo_readonly',
  'artifacts_verified', 'assertions_passed', 'status', 'error',
];

const HOST_SAMPLES = [
  'campaign_id', 'session_id', 'seq', 'kind', 'round', 'round_attempt', 'profile_id', 'phase', 'utc',
  'loadavg', 'power_source', 'low_power_mode', 'pmset_therm',
];

// One row per (kind, round, round_attempt) outcome. Append-only.
//   complete   - every profile finished and the round validation passed (accepted = 1)
//   failed     - the round ran to its end but validation failed (accepted = 0)
//   incomplete - rows of an interrupted attempt found at restart; preserved, never continued
const LEDGER = [
  'campaign_id', 'kind', 'round', 'round_attempt', 'session_id', 'status', 'accepted', 'recorded_utc',
  'recorded_by_session', 'profiles', 'rows_runs', 'rows_diag', 'detail',
];

const SESSIONS = [
  'campaign_id', 'session_id', 'event', 'utc', 'mode', 'git_head', 'image_id', 'docker_desktop',
  'engine', 'kernel', 'vm_ncpu', 'vm_mem_bytes', 'power_source', 'low_power_mode', 'caffeinated', 'detail',
];

// Metrics summarised per (profile, backend, depth). wall_ms is the pipeline total;
// stage_sum_ms is a derived diagnostic (sum of the four stage metrics), not "total time".
const RUN_METRICS = ['input_ms', 'witness_ms', 'prove_ms', 'verify_first_ms', 'verify_steady_ms', 'stage_sum_ms', 'wall_ms'];

module.exports = { RUNS, DIAG, ROUNDS, HOST_SAMPLES, LEDGER, SESSIONS, RUN_METRICS };
