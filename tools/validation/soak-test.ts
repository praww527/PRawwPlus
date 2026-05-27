#!/usr/bin/env tsx
/**
 * Soak Test — Phase 1 validation
 *
 * Runs a long-duration (default 24 h) soak test against the live platform.
 * Every 30 s it polls /admin/platform-health and records a snapshot.
 * Every 60 s it opens + closes a WebSocket connection (reconnect torture).
 * At the end (or on SIGINT) it analyses the collected samples for:
 *   - unbounded heap / RSS growth (linear regression slope > threshold)
 *   - WS / session count drift (count at end > count at start + tolerance)
 *   - ESL reconnect acceleration (reconnect delta growing)
 *   - event-loop lag creep
 * Results are written to soak-<ISO-timestamp>.ndjson and a summary is
 * printed at the end.
 *
 * Usage:
 *   tsx tools/validation/soak-test.ts \
 *     --base-url https://rtc.praww.co.za \
 *     --admin-key  <ADMIN_API_KEY> \
 *     --duration   86400 \
 *     --ws-path    /api/verto/ws
 */

import { parseArgs }  from "node:util";
import { WebSocket }  from "ws";
import fs             from "node:fs";
import path           from "node:path";

// ── CLI args ──────────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    "base-url":   { type: "string",  default: process.env["BASE_URL"]   ?? "http://localhost:8080" },
    "admin-key":  { type: "string",  default: process.env["ADMIN_API_KEY"] ?? "" },
    "duration":   { type: "string",  default: "86400" },
    "ws-path":    { type: "string",  default: "/api/verto/ws" },
    "poll-secs":  { type: "string",  default: "30" },
    "ws-secs":    { type: "string",  default: "60" },
    "heap-slope-threshold":   { type: "string", default: "0.5" },  // MiB/min
    "rss-slope-threshold":    { type: "string", default: "1.0" },  // MiB/min
    "lag-warn-ms":            { type: "string", default: "150"  },  // ms
  },
  strict: false,
});

const BASE_URL        = args["base-url"]   as string;
const ADMIN_KEY       = args["admin-key"]  as string;
const DURATION_S      = parseInt(args["duration"]  as string, 10);
const WS_PATH         = args["ws-path"]    as string;
const POLL_S          = parseInt(args["poll-secs"] as string, 10);
const WS_S            = parseInt(args["ws-secs"]   as string, 10);
const HEAP_SLOPE_MAX  = parseFloat(args["heap-slope-threshold"] as string);
const RSS_SLOPE_MAX   = parseFloat(args["rss-slope-threshold"]  as string);
const LAG_WARN_MS     = parseFloat(args["lag-warn-ms"]           as string);

if (!ADMIN_KEY) {
  console.error("ERROR: --admin-key or ADMIN_API_KEY env var required");
  process.exit(1);
}

// ── NDJSON log ────────────────────────────────────────────────────────────────
const logFile = path.join(
  process.cwd(),
  `soak-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`,
);
const logStream = fs.createWriteStream(logFile, { flags: "a" });

function record(obj: Record<string, unknown>) {
  logStream.write(JSON.stringify({ ts: Date.now(), ...obj }) + "\n");
}

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface HealthSnapshot {
  ts:              number;
  heapUsedMiB:     number;
  rssMiB:          number;
  loopLagMs:       number;
  activeCalls:     number;
  wsVertoClients:  number;
  sipSessions:     number;
  eslConnected:    boolean;
  eslReconnects:   number;
  sipFloodBlocked: number;
  wsRejected:      number;
  sweeperRuns:     number;
  staleCleaned:    number;
  zombiesKilled:   number;
  dbOk:            boolean;
  error?:          string;
}

const samples: HealthSnapshot[] = [];

// ── Fetch /admin/platform-health ──────────────────────────────────────────────
async function pollHealth(): Promise<HealthSnapshot> {
  const ts = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/admin/platform-health`, {
      headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ts, error: `HTTP ${res.status}: ${body}` } as HealthSnapshot;
    }

    const d = await res.json();
    return {
      ts,
      heapUsedMiB:     d.process?.heapUsedMiB     ?? 0,
      rssMiB:          d.process?.rssMiB           ?? 0,
      loopLagMs:       d.process?.eventLoopLagMs   ?? 0,
      activeCalls:     d.calls?.active             ?? 0,
      wsVertoClients:  d.websocket?.vertoClients   ?? 0,
      sipSessions:     d.websocket?.sipSessions    ?? 0,
      eslConnected:    d.esl?.connected            ?? false,
      eslReconnects:   d.esl?.upstreamReconnects   ?? 0,
      sipFloodBlocked: d.security?.sipFloodBlocked ?? 0,
      wsRejected:      d.security?.wsConnectionsRejectedIpLimit ?? 0,
      sweeperRuns:     d.sweeper?.runs             ?? 0,
      staleCleaned:    d.sweeper?.staleCleaned     ?? 0,
      zombiesKilled:   d.sweeper?.zombiesKilled    ?? 0,
      dbOk:            d.db?.connected             ?? false,
    };
  } catch (err) {
    return { ts, error: String(err) } as HealthSnapshot;
  }
}

// ── WS reconnect torture ──────────────────────────────────────────────────────
let wsReconnectCount = 0;
let wsErrorCount     = 0;

async function wsReconnectTest(): Promise<void> {
  const url = BASE_URL.replace(/^http/, "ws") + WS_PATH;
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { handshakeTimeout: 10_000 });
    const timer = setTimeout(() => { ws.terminate(); resolve(); }, 8_000);

    ws.on("open", () => {
      wsReconnectCount++;
      clearTimeout(timer);
      ws.close(1000, "soak-test close");
      resolve();
    });
    ws.on("error", (err) => {
      wsErrorCount++;
      record({ event: "ws_error", message: err.message });
      clearTimeout(timer);
      resolve();
    });
    ws.on("close", () => { clearTimeout(timer); resolve(); });
  });
}

// ── Linear regression slope (y per x-unit) ───────────────────────────────────
function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * ((ys[i] ?? 0) - my), 0);
  const den = xs.reduce((s, x)    => s + (x - mx) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

// ── Analyse all samples ───────────────────────────────────────────────────────
interface SoakReport {
  durationMin:    number;
  samples:        number;
  errors:         number;
  findings:       string[];
  passed:         boolean;
}

function analyse(): SoakReport {
  const valid   = samples.filter(s => !s.error);
  const errored = samples.filter(s => s.error);
  const findings: string[] = [];

  if (valid.length < 3) {
    return { durationMin: 0, samples: samples.length, errors: errored.length, findings: ["Not enough samples to analyse"], passed: false };
  }

  const t0    = valid[0]!.ts;
  const xs    = valid.map(s => (s.ts - t0) / 60_000);   // minutes
  const heaps = valid.map(s => s.heapUsedMiB);
  const rsss  = valid.map(s => s.rssMiB);
  const lags  = valid.map(s => s.loopLagMs);
  const wsCts = valid.map(s => s.wsVertoClients);
  const sipCts = valid.map(s => s.sipSessions);
  const eslRs = valid.map(s => s.eslReconnects);
  const durationMin = xs[xs.length - 1] ?? 0;

  // Heap growth
  const heapSlope = slope(xs, heaps);
  if (heapSlope > HEAP_SLOPE_MAX) {
    findings.push(`LEAK: Heap growing at ${heapSlope.toFixed(3)} MiB/min (limit ${HEAP_SLOPE_MAX})`);
  } else {
    findings.push(`OK:   Heap slope ${heapSlope.toFixed(3)} MiB/min (limit ${HEAP_SLOPE_MAX})`);
  }

  // RSS growth
  const rssSlope = slope(xs, rsss);
  if (rssSlope > RSS_SLOPE_MAX) {
    findings.push(`LEAK: RSS growing at ${rssSlope.toFixed(3)} MiB/min (limit ${RSS_SLOPE_MAX})`);
  } else {
    findings.push(`OK:   RSS slope ${rssSlope.toFixed(3)} MiB/min (limit ${RSS_SLOPE_MAX})`);
  }

  // Event-loop lag
  const maxLag = Math.max(...lags);
  const p95Lag = lags.sort((a, b) => a - b)[Math.floor(lags.length * 0.95)] ?? 0;
  if (p95Lag > LAG_WARN_MS) {
    findings.push(`WARN: Event-loop p95 lag ${p95Lag.toFixed(1)} ms (threshold ${LAG_WARN_MS} ms)`);
  } else {
    findings.push(`OK:   Event-loop lag p95=${p95Lag.toFixed(1)} ms max=${maxLag.toFixed(1)} ms`);
  }

  // WS count drift (start vs end, should not grow without bound)
  const wsFirst = wsCts[0] ?? 0;
  const wsLast  = wsCts[wsCts.length - 1] ?? 0;
  if (wsLast > wsFirst + 5) {
    findings.push(`LEAK: WS verto clients drifted ${wsFirst} → ${wsLast} (grew ${wsLast - wsFirst})`);
  } else {
    findings.push(`OK:   WS verto clients stable ${wsFirst} → ${wsLast}`);
  }

  // SIP session drift
  const sipFirst = sipCts[0] ?? 0;
  const sipLast  = sipCts[sipCts.length - 1] ?? 0;
  if (sipLast > sipFirst + 10) {
    findings.push(`LEAK: SIP sessions drifted ${sipFirst} → ${sipLast}`);
  } else {
    findings.push(`OK:   SIP sessions stable ${sipFirst} → ${sipLast}`);
  }

  // ESL reconnect rate
  const eslFirst = eslRs[0] ?? 0;
  const eslLast  = eslRs[eslRs.length - 1] ?? 0;
  if (eslLast - eslFirst > 5) {
    findings.push(`WARN: ESL reconnected ${eslLast - eslFirst} times during soak`);
  } else {
    findings.push(`OK:   ESL reconnects during soak: ${eslLast - eslFirst}`);
  }

  // DB OK throughout
  const dbDownSamples = valid.filter(s => !s.dbOk).length;
  if (dbDownSamples > 0) {
    findings.push(`WARN: DB reported not connected in ${dbDownSamples}/${valid.length} samples`);
  } else {
    findings.push(`OK:   DB connected throughout all samples`);
  }

  // WS reconnect errors
  if (wsErrorCount > wsReconnectCount * 0.05) {
    findings.push(`WARN: WS reconnect error rate ${wsErrorCount}/${wsReconnectCount} (>5%)`);
  } else {
    findings.push(`OK:   WS reconnect errors ${wsErrorCount}/${wsReconnectCount}`);
  }

  const passed = !findings.some(f => f.startsWith("LEAK") || f.startsWith("FAIL"));

  return { durationMin, samples: samples.length, errors: errored.length, findings, passed };
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function main() {
  log(`Soak test starting — duration=${DURATION_S}s, poll=${POLL_S}s, ws=${WS_S}s`);
  log(`Target: ${BASE_URL}`);
  log(`Log file: ${logFile}`);

  record({ event: "soak_start", durationS: DURATION_S, baseUrl: BASE_URL });

  const endAt        = Date.now() + DURATION_S * 1_000;
  let   pollCount    = 0;
  let   summaryCount = 0;

  const pollTimer = setInterval(async () => {
    const snap = await pollHealth();
    samples.push(snap);
    record({ event: "health_snapshot", ...snap });
    pollCount++;

    if (snap.error) {
      log(`POLL ERROR [${pollCount}]: ${snap.error}`);
    } else if (snap.loopLagMs > LAG_WARN_MS) {
      log(`LAG ALERT [${pollCount}]: event-loop lag ${snap.loopLagMs.toFixed(1)} ms`);
    }

    // Rolling summary every 5 min (10 × 30s polls)
    if (pollCount % 10 === 0) {
      summaryCount++;
      const valid = samples.filter(s => !s.error);
      if (valid.length > 0) {
        const last = valid[valid.length - 1]!;
        log(
          `SUMMARY [${summaryCount}] ` +
          `heap=${last.heapUsedMiB.toFixed(1)} MiB ` +
          `rss=${last.rssMiB.toFixed(1)} MiB ` +
          `lag=${last.loopLagMs.toFixed(1)} ms ` +
          `ws=${last.wsVertoClients} ` +
          `sip=${last.sipSessions} ` +
          `calls=${last.activeCalls} ` +
          `esConn=${last.eslConnected} ` +
          `polls=${pollCount} wsRecon=${wsReconnectCount} wsErr=${wsErrorCount}`,
        );
      }
    }

    if (Date.now() >= endAt) {
      clearInterval(pollTimer);
      clearInterval(wsTimer);
      finish();
    }
  }, POLL_S * 1_000);

  const wsTimer = setInterval(async () => {
    await wsReconnectTest();
    record({ event: "ws_reconnect", count: wsReconnectCount, errors: wsErrorCount });
  }, WS_S * 1_000);

  function finish() {
    log("\n========== SOAK TEST COMPLETE ==========");
    const report = analyse();
    log(`Duration:  ${report.durationMin.toFixed(1)} min`);
    log(`Samples:   ${report.samples} (${report.errors} errors)`);
    log("Findings:");
    for (const f of report.findings) log(`  ${f}`);
    log(`Result:    ${report.passed ? "PASS" : "FAIL"}`);
    record({ event: "soak_complete", ...report });
    logStream.end(() => {
      log(`Log written to ${logFile}`);
      process.exit(report.passed ? 0 : 1);
    });
  }

  process.on("SIGINT", () => {
    log("SIGINT — ending soak test early");
    clearInterval(pollTimer);
    clearInterval(wsTimer);
    finish();
  });
}

main().catch(err => { console.error(err); process.exit(1); });
