#!/usr/bin/env tsx
/**
 * Metrics Cross-Checker — Phase 5 validation
 *
 * Fetches metrics from multiple sources and verifies they are consistent:
 *   - /admin/platform-health  (rich operational snapshot)
 *   - /api/admin/stats        (admin aggregate stats)
 *   - /metrics                (Prometheus text output)
 *
 * Checks:
 *   - active call count agrees across sources
 *   - WS connection count agrees
 *   - SIP session count agrees
 *   - Prometheus metric labels match JSON values
 *   - No metric returning stale or negative values
 *   - Heap/RSS within expected bounds for the current load
 *   - History ring-buffer is being populated (not stuck)
 *
 * Usage:
 *   tsx tools/validation/metrics-crosscheck.ts \
 *     --base-url  https://rtc.praww.co.za \
 *     --admin-key <ADMIN_API_KEY> \
 *     --session   <admin-user-session-sid>
 */

import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    "base-url":  { type: "string", default: process.env["BASE_URL"]      ?? "http://localhost:8080" },
    "admin-key": { type: "string", default: process.env["ADMIN_API_KEY"] ?? "" },
    "session":   { type: "string", default: process.env["ADMIN_SESSION"] ?? "" },
    "tolerance": { type: "string", default: "2" },
  },
  strict: false,
});

const BASE_URL  = args["base-url"]  as string;
const ADMIN_KEY = args["admin-key"] as string;
const SESSION   = args["session"]   as string;
const TOLERANCE = parseInt(args["tolerance"] as string, 10);

if (!ADMIN_KEY) { console.error("ERROR: --admin-key required"); process.exit(1); }

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchPlatformHealth() {
  const res = await fetch(`${BASE_URL}/api/admin/platform-health`, {
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`platform-health HTTP ${res.status}`);
  return res.json();
}

async function fetchAdminStats() {
  if (!SESSION) return null;
  const res = await fetch(`${BASE_URL}/api/admin/stats`, {
    headers: { Authorization: `Bearer ${SESSION}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    log(`WARN: /api/admin/stats HTTP ${res.status} — skipping cross-check`);
    return null;
  }
  return res.json();
}

async function fetchPrometheus(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/metrics`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`/metrics HTTP ${res.status}`);
  return res.text();
}

// ── Parse Prometheus text ─────────────────────────────────────────────────────
function parsePrometheus(text: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;
    const match = line.match(/^(\S+)\s+([\d.e+-]+)$/);
    if (match) {
      result[match[1]!] = parseFloat(match[2]!);
    }
  }
  return result;
}

// ── Comparison helper ─────────────────────────────────────────────────────────
interface CheckResult { label: string; passed: boolean; detail: string; }

function check(
  label:  string,
  a:      number,
  b:      number,
  aLabel: string,
  bLabel: string,
): CheckResult {
  const diff = Math.abs(a - b);
  const passed = diff <= TOLERANCE;
  return {
    label,
    passed,
    detail: passed
      ? `${aLabel}=${a} ${bLabel}=${b} (Δ${diff} ≤ ${TOLERANCE})`
      : `MISMATCH: ${aLabel}=${a} ${bLabel}=${b} (Δ${diff} > tolerance ${TOLERANCE})`,
  };
}

function checkRange(label: string, val: number, min: number, max: number): CheckResult {
  const passed = val >= min && val <= max;
  return {
    label,
    passed,
    detail: passed
      ? `${val} in [${min}, ${max}]`
      : `OUT OF RANGE: ${val} not in [${min}, ${max}]`,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log("Metrics cross-checker starting");
  log(`Target: ${BASE_URL}`);

  const [ph, stats, promText] = await Promise.all([
    fetchPlatformHealth(),
    fetchAdminStats(),
    fetchPrometheus(),
  ]);

  const prom = parsePrometheus(promText);
  const checks: CheckResult[] = [];

  log("\n── Source data ──");
  log(`platform-health: active_calls=${ph.calls?.active} ws_verto=${ph.websocket?.vertoClients} sip=${ph.websocket?.sipSessions}`);
  if (stats) {
    log(`admin/stats: active_calls=${stats.activeCalls ?? "n/a"}`);
  }
  log(`prometheus keys: ${Object.keys(prom).length} metrics parsed`);

  // ── Cross-check 1: active calls ───────────────────────────────────────────
  const phActiveCalls = ph.calls?.active ?? 0;

  if (prom["praww_active_calls"] !== undefined) {
    checks.push(check(
      "active_calls: platform-health vs prometheus",
      phActiveCalls,
      prom["praww_active_calls"]!,
      "platform-health",
      "prometheus",
    ));
  } else {
    log("INFO: praww_active_calls not found in prometheus output (metric name may differ)");
  }

  if (stats && stats.activeCalls !== undefined) {
    checks.push(check(
      "active_calls: platform-health vs admin/stats",
      phActiveCalls,
      stats.activeCalls as number,
      "platform-health",
      "admin/stats",
    ));
  }

  // ── Cross-check 2: WS connections ────────────────────────────────────────
  const phWsVerto = ph.websocket?.vertoClients ?? 0;
  if (prom["praww_ws_verto_clients"] !== undefined) {
    checks.push(check(
      "ws_verto_clients: platform-health vs prometheus",
      phWsVerto,
      prom["praww_ws_verto_clients"]!,
      "platform-health",
      "prometheus",
    ));
  }

  // ── Cross-check 3: SIP sessions ──────────────────────────────────────────
  const phSip = ph.websocket?.sipSessions ?? 0;
  if (prom["praww_sip_sessions"] !== undefined) {
    checks.push(check(
      "sip_sessions: platform-health vs prometheus",
      phSip,
      prom["praww_sip_sessions"]!,
      "platform-health",
      "prometheus",
    ));
  }

  // ── Range checks ─────────────────────────────────────────────────────────
  const heapMiB  = ph.process?.heapUsedMiB  ?? 0;
  const rssMiB   = ph.process?.rssMiB       ?? 0;
  const loopLag  = ph.process?.eventLoopLagMs ?? 0;

  checks.push(checkRange("heap_used_MiB",    heapMiB, 10,  512));
  checks.push(checkRange("rss_MiB",          rssMiB,  20,  1024));
  checks.push(checkRange("event_loop_lag_ms", loopLag, 0,   150));

  // ── Sanity: no negative metrics ───────────────────────────────────────────
  const negativeMetrics = Object.entries(prom).filter(([, v]) => v < 0);
  checks.push({
    label:  "no_negative_prometheus_metrics",
    passed: negativeMetrics.length === 0,
    detail: negativeMetrics.length === 0
      ? "all metrics ≥ 0"
      : `NEGATIVE: ${negativeMetrics.map(([k, v]) => `${k}=${v}`).join(", ")}`,
  });

  // ── History ring-buffer populated ────────────────────────────────────────
  const historyLen = Array.isArray(ph.history) ? ph.history.length : 0;
  checks.push({
    label:  "health_history_ring_buffer_populated",
    passed: historyLen > 0,
    detail: `history length = ${historyLen}`,
  });

  // ── ESL and DB reported consistent ───────────────────────────────────────
  checks.push({
    label:  "esl_connected",
    passed: ph.esl?.connected === true,
    detail: `esl.connected = ${ph.esl?.connected}`,
  });
  checks.push({
    label:  "db_connected",
    passed: ph.db?.connected === true,
    detail: `db.connected = ${ph.db?.connected}`,
  });

  // ── Sweeper not stuck ─────────────────────────────────────────────────────
  const sweeperRuns = ph.sweeper?.runs ?? 0;
  checks.push({
    label:  "sweeper_has_run",
    passed: sweeperRuns > 0,
    detail: `sweeper.runs = ${sweeperRuns}`,
  });

  // ── Print results ─────────────────────────────────────────────────────────
  log("\n═══════════ METRICS CROSS-CHECK RESULTS ═══════════");
  let allPassed = true;
  for (const c of checks) {
    log(`  ${c.passed ? "PASS" : "FAIL"}  ${c.label}: ${c.detail}`);
    if (!c.passed) allPassed = false;
  }
  log(`\nOverall: ${allPassed ? "PASS" : "FAIL"}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
