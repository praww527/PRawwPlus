#!/usr/bin/env tsx
/**
 * Chaos / Failure Injection — Phase 2 validation
 *
 * Intentionally breaks platform components while optionally keeping calls
 * active and verifies that reconnect + self-healing logic kicks in.
 *
 * Usage:
 *   tsx tools/validation/chaos.ts \
 *     --base-url  https://rtc.praww.co.za \
 *     --admin-key <ADMIN_API_KEY> \
 *     --ssh-host  158.180.29.84 \
 *     --ssh-user  ubuntu \
 *     --ssh-key   ~/.ssh/id_rsa \
 *     --target    freeswitch       # or: esl | db | websocket | all
 *
 * Each test:
 *   1. Verifies platform is healthy before injection
 *   2. Performs the disruption
 *   3. Polls /admin/platform-health until recovery or timeout
 *   4. Reports result + recovery time
 */

import { parseArgs }  from "node:util";
import { WebSocket }  from "ws";
import { Client }     from "ssh2";
import fs             from "node:fs";

// ── CLI args ──────────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    "base-url":        { type: "string",  default: process.env["BASE_URL"]      ?? "http://localhost:8080" },
    "admin-key":       { type: "string",  default: process.env["ADMIN_API_KEY"] ?? "" },
    "ssh-host":        { type: "string",  default: process.env["VPS_HOST"]      ?? "158.180.29.84" },
    "ssh-user":        { type: "string",  default: process.env["VPS_USER"]      ?? "ubuntu" },
    "ssh-key":         { type: "string",  default: process.env["SSH_KEY_PATH"]  ?? "" },
    "ssh-password":    { type: "string",  default: process.env["VPS_PASSWORD"]  ?? "" },
    "target":          { type: "string",  default: "websocket" },
    "recovery-timeout": { type: "string", default: "120" },
    "poll-secs":        { type: "string", default: "5"   },
  },
  strict: false,
});

const BASE_URL         = args["base-url"]     as string;
const ADMIN_KEY        = args["admin-key"]    as string;
const SSH_HOST         = args["ssh-host"]     as string;
const SSH_USER         = args["ssh-user"]     as string;
const SSH_KEY_PATH     = args["ssh-key"]      as string;
const SSH_PASSWORD     = args["ssh-password"] as string;
const TARGET           = args["target"]       as string;
const RECOVERY_TIMEOUT = parseInt(args["recovery-timeout"] as string, 10) * 1_000;
const POLL_S           = parseInt(args["poll-secs"]        as string, 10);

if (!ADMIN_KEY) { console.error("ERROR: --admin-key required"); process.exit(1); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function fetchHealth(): Promise<{ ok: boolean; eslConnected: boolean; dbOk: boolean; activeCalls: number; raw: unknown }> {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/platform-health`, {
      headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, eslConnected: false, dbOk: false, activeCalls: 0, raw: null };
    const d = await res.json();
    return {
      ok:           res.status === 200 || res.status === 503, // endpoint itself responded
      eslConnected: d.esl?.connected    ?? false,
      dbOk:         d.db?.connected     ?? false,
      activeCalls:  d.calls?.active     ?? 0,
      raw:          d,
    };
  } catch (e) {
    return { ok: false, eslConnected: false, dbOk: false, activeCalls: 0, raw: null };
  }
}

async function assertHealthy(label: string): Promise<void> {
  log(`Pre-check: verifying platform healthy before ${label}`);
  const h = await fetchHealth();
  if (!h.ok || !h.dbOk) {
    log(`ABORT: Platform not healthy before ${label}. db=${h.dbOk} esl=${h.eslConnected}`);
    process.exit(2);
  }
  log(`Pre-check passed. db=${h.dbOk} esl=${h.eslConnected} calls=${h.activeCalls}`);
}

async function waitForRecovery(
  label:    string,
  predicate: (h: Awaited<ReturnType<typeof fetchHealth>>) => boolean,
): Promise<{ recovered: boolean; recoveryMs: number }> {
  const start = Date.now();
  log(`Waiting for recovery after ${label} (timeout ${RECOVERY_TIMEOUT / 1_000}s) …`);
  while (Date.now() - start < RECOVERY_TIMEOUT) {
    await new Promise(r => setTimeout(r, POLL_S * 1_000));
    const h = await fetchHealth();
    const elapsed = Date.now() - start;
    log(`  [${(elapsed / 1_000).toFixed(0)}s] ok=${h.ok} db=${h.dbOk} esl=${h.eslConnected}`);
    if (predicate(h)) {
      log(`RECOVERY: ${label} recovered in ${elapsed} ms`);
      return { recovered: true, recoveryMs: elapsed };
    }
  }
  log(`FAIL: ${label} did not recover within ${RECOVERY_TIMEOUT / 1_000}s`);
  return { recovered: false, recoveryMs: RECOVERY_TIMEOUT };
}

// ── SSH helper ────────────────────────────────────────────────────────────────
async function sshExec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";

    const authOpts: Record<string, unknown> = {
      host:     SSH_HOST,
      port:     22,
      username: SSH_USER,
    };

    if (SSH_KEY_PATH) {
      authOpts["privateKey"] = fs.readFileSync(SSH_KEY_PATH, "utf8");
    } else if (SSH_PASSWORD) {
      authOpts["password"] = SSH_PASSWORD;
    } else {
      reject(new Error("SSH: provide --ssh-key or --ssh-password"));
      return;
    }

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); reject(err); return; }
        stream.on("data",               (d: Buffer) => { stdout += d.toString(); });
        stream.stderr.on("data",        (d: Buffer) => { stderr += d.toString(); });
        stream.on("close", (code: number) => { conn.end(); resolve({ stdout, stderr, code }); });
      });
    });

    conn.on("error", reject);
    conn.connect(authOpts as Parameters<Client["connect"]>[0]);
  });
}

// ── Individual chaos tests ────────────────────────────────────────────────────

async function chaosFreeSWITCH(): Promise<boolean> {
  log("═══ CHAOS: Restart FreeSWITCH mid-service ═══");
  await assertHealthy("FreeSWITCH restart");

  log("Executing: systemctl restart freeswitch");
  const r = await sshExec("sudo systemctl restart freeswitch && sleep 2 && systemctl is-active freeswitch");
  log(`SSH result (code ${r.code}): ${r.stdout.trim() || r.stderr.trim()}`);

  const { recovered, recoveryMs } = await waitForRecovery(
    "FreeSWITCH restart",
    h => h.eslConnected && h.dbOk,
  );
  log(recovered ? `PASS: FreeSWITCH recovered in ${recoveryMs}ms` : "FAIL: FreeSWITCH did not recover");
  return recovered;
}

async function chaosESLSocket(): Promise<boolean> {
  log("═══ CHAOS: Kill ESL TCP socket ═══");
  await assertHealthy("ESL kill");

  // Kill all connections on port 8021 (FreeSWITCH ESL port) from the API server side
  const r = await sshExec("sudo ss -K sport = 8021 2>/dev/null; echo done");
  log(`SSH result (code ${r.code}): ${r.stdout.trim()}`);

  const { recovered, recoveryMs } = await waitForRecovery(
    "ESL socket kill",
    h => h.eslConnected,
  );
  log(recovered ? `PASS: ESL reconnected in ${recoveryMs}ms` : "FAIL: ESL did not reconnect");
  return recovered;
}

async function chaosMongoDB(): Promise<boolean> {
  log("═══ CHAOS: Stop MongoDB for 30s ═══");
  await assertHealthy("MongoDB stop");

  const r = await sshExec(
    "sudo systemctl stop mongod && echo 'stopped' && sleep 30 && sudo systemctl start mongod && echo 'restarted'",
  );
  log(`SSH result (code ${r.code}): ${r.stdout.trim()}`);

  const { recovered, recoveryMs } = await waitForRecovery(
    "MongoDB restart",
    h => h.dbOk,
  );
  log(recovered ? `PASS: DB reconnected in ${recoveryMs}ms` : "FAIL: DB did not reconnect");
  return recovered;
}

async function chaosWebSocket(): Promise<boolean> {
  log("═══ CHAOS: Force-drop active WebSocket connections ═══");

  const wsUrl = BASE_URL.replace(/^http/, "ws") + "/api/verto/ws";
  log(`Establishing WS connections to ${wsUrl}`);

  const conns: WebSocket[] = [];
  const closeEvents: Array<{ code: number; reason: string }> = [];

  // Open 3 connections
  for (let i = 0; i < 3; i++) {
    await new Promise<void>(res => {
      const ws = new WebSocket(wsUrl, { handshakeTimeout: 10_000 });
      ws.on("open", () => { conns.push(ws); res(); });
      ws.on("error", () => res());
    });
  }

  log(`Opened ${conns.length} WS connections`);

  // Register close listeners
  for (const ws of conns) {
    ws.on("close", (code, reason) => {
      closeEvents.push({ code, reason: reason.toString() });
    });
  }

  // Now restart the API to force all WS connections to drop
  if (conns.length > 0) {
    log("Executing: systemctl restart prawwplus-api");
    const r = await sshExec("sudo systemctl restart prawwplus-api && sleep 3 && systemctl is-active prawwplus-api");
    log(`SSH result (code ${r.code}): ${r.stdout.trim()}`);
  }

  // Wait up to 15s for all connections to close
  const start = Date.now();
  while (closeEvents.length < conns.length && Date.now() - start < 15_000) {
    await new Promise(r => setTimeout(r, 500));
  }

  log(`Close events received: ${closeEvents.length}/${conns.length}`);

  const { recovered, recoveryMs } = await waitForRecovery(
    "WS + API restart",
    h => h.ok && h.dbOk,
  );
  log(recovered ? `PASS: API recovered after WS chaos in ${recoveryMs}ms` : "FAIL: API did not recover");
  return recovered;
}

async function chaosAPIRestart(): Promise<boolean> {
  log("═══ CHAOS: Graceful API restart ═══");
  await assertHealthy("API restart");

  const r = await sshExec("sudo systemctl restart prawwplus-api && sleep 3 && systemctl is-active prawwplus-api");
  log(`SSH result (code ${r.code}): ${r.stdout.trim()}`);

  const { recovered, recoveryMs } = await waitForRecovery(
    "API restart",
    h => h.ok && h.dbOk && h.eslConnected,
  );
  log(recovered ? `PASS: API fully recovered in ${recoveryMs}ms` : "FAIL: API did not recover");
  return recovered;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log(`Chaos test starting — target: ${TARGET}`);
  log(`Platform: ${BASE_URL}`);

  const results: Record<string, boolean> = {};

  if (TARGET === "freeswitch" || TARGET === "all") {
    results["freeswitch"] = await chaosFreeSWITCH();
  }
  if (TARGET === "esl" || TARGET === "all") {
    results["esl"] = await chaosESLSocket();
  }
  if (TARGET === "db" || TARGET === "all") {
    results["db"] = await chaosMongoDB();
  }
  if (TARGET === "websocket" || TARGET === "all") {
    results["websocket"] = await chaosWebSocket();
  }
  if (TARGET === "api" || TARGET === "all") {
    results["api"] = await chaosAPIRestart();
  }

  log("\n═══════════ CHAOS RESULTS ═══════════");
  let allPassed = true;
  for (const [name, passed] of Object.entries(results)) {
    log(`  ${passed ? "PASS" : "FAIL"}  ${name}`);
    if (!passed) allPassed = false;
  }
  log(`\nOverall: ${allPassed ? "PASS" : "FAIL"}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
