/**
 * Admin Operations — Phase 1 Observability & Operations Center
 *
 * Endpoints:
 *   GET  /api/admin/system-metrics       — CPU / RAM / Disk / OS / process
 *   GET  /api/admin/git-info             — Current commit, branch, deploy time
 *   GET  /api/admin/live-registrations   — Verto + SIP sessions enriched
 *   GET  /api/admin/events/stream        — SSE real-time event stream
 *   GET  /api/admin/tls-info             — TLS certificate expiry
 *   GET  /api/admin/call-trace/:uuid     — ESL trace for a call UUID
 *   GET  /api/admin/push-stats           — Push delivery counters
 *   GET  /api/admin/concurrent-history   — Last 60 active-call samples (1/min)
 */

import os from "os";
import tls from "tls";
import { exec } from "child_process";
import { promisify } from "util";
import { Router, type IRouter, type Request, type Response } from "express";
import { metrics } from "../lib/metrics";
import { getAllSessions, getAllSipSessions } from "../lib/callSession";
import { eslStatus, getEslTrace } from "../lib/freeswitchESL";
import { getReconciliationStats } from "../lib/reconciliationWorker";
import { getHealthHistory } from "../lib/healthRingBuffer";
import { connectDB, UserModel } from "@workspace/db";
import mongoose from "mongoose";
import { logger } from "../lib/logger";
import {
  broadcastSseEvent,
  addSseClient,
  removeSseClient,
  getSseClientCount,
} from "../lib/adminBroadcast";

const execAsync = promisify(exec);

const router: IRouter = Router();

function requireAdmin(req: Request, res: Response, next: () => void): void {
  if (!(req as any).isAuthenticated?.()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!(req as any).user?.isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// ── Concurrent call history (ring buffer, 1 sample/min, last 60) ─────────────

interface CallSample { ts: number; count: number }
const concurrentHistory: CallSample[] = [];
const MAX_HISTORY = 60;

setInterval(() => {
  if (concurrentHistory.length >= MAX_HISTORY) concurrentHistory.shift();
  concurrentHistory.push({ ts: Date.now(), count: metrics.activeCalls });
}, 60_000);

// Re-export broadcastSseEvent so existing imports from this module keep working
export { broadcastSseEvent } from "../lib/adminBroadcast";

// Send a metrics snapshot to SSE clients every 5 s
setInterval(() => {
  if (getSseClientCount() === 0) return;
  broadcastSseEvent("metrics", metrics.snapshot());
}, 5_000);

// ── Routes ────────────────────────────────────────────────────────────────────

// System metrics: CPU, RAM, Disk, process
router.get("/admin/system-metrics", requireAdmin, async (_req, res) => {
  const cpus    = os.cpus();
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  const loadavg  = os.loadavg();
  const sysUptime = os.uptime();

  const cpuUsagePcts = cpus.map((cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle  = cpu.times.idle;
    return total > 0 ? Math.round(((total - idle) / total) * 100) : 0;
  });
  const avgCpuPct = Math.round(cpuUsagePcts.reduce((a, b) => a + b, 0) / Math.max(cpuUsagePcts.length, 1));

  let disk: { totalKb: number; usedKb: number; availKb: number; usedPct: number } | null = null;
  try {
    const { stdout } = await execAsync("df -k / 2>/dev/null | tail -1 | awk '{print $2,$3,$4}'");
    const parts = stdout.trim().split(/\s+/).map(Number);
    if (parts.length >= 3 && !parts.some(isNaN)) {
      const [total, used, avail] = parts;
      disk = { totalKb: total, usedKb: used, availKb: avail, usedPct: Math.round((used / total) * 100) };
    }
  } catch { /* disk info unavailable on this platform */ }

  const proc = process.memoryUsage();

  res.json({
    cpu: {
      cores:      cpus.length,
      model:      cpus[0]?.model ?? "unknown",
      avgUsagePct: avgCpuPct,
      perCore:    cpuUsagePcts,
      loadavg:    { "1m": loadavg[0].toFixed(2), "5m": loadavg[1].toFixed(2), "15m": loadavg[2].toFixed(2) },
    },
    memory: {
      totalMb:  Math.round(totalMem  / 1_048_576),
      freeMb:   Math.round(freeMem   / 1_048_576),
      usedMb:   Math.round((totalMem - freeMem) / 1_048_576),
      usedPct:  Math.round(((totalMem - freeMem) / totalMem) * 100),
    },
    disk,
    process: {
      rssKb:       Math.round(proc.rss        / 1024),
      heapUsedKb:  Math.round(proc.heapUsed   / 1024),
      heapTotalKb: Math.round(proc.heapTotal  / 1024),
      externalKb:  Math.round(proc.external   / 1024),
      pid:         process.pid,
      uptimeS:     Math.round(process.uptime()),
    },
    system: {
      uptimeS:  Math.round(sysUptime),
      platform: os.platform(),
      arch:     os.arch(),
      hostname: os.hostname(),
      release:  os.release(),
    },
    asOf: new Date().toISOString(),
  });
});

// Git / deploy info
router.get("/admin/git-info", requireAdmin, async (_req, res) => {
  try {
    const [shaOut, logOut, branchOut] = await Promise.all([
      execAsync("git rev-parse HEAD 2>/dev/null").then((r) => r.stdout.trim()).catch(() => "unknown"),
      execAsync("git log -1 --format='%s|||%aI|||%an' 2>/dev/null").then((r) => r.stdout.trim()).catch(() => "unknown|||unknown|||unknown"),
      execAsync("git branch --show-current 2>/dev/null").then((r) => r.stdout.trim()).catch(() => "unknown"),
    ]);

    const [message, date, author] = logOut.split("|||");
    const sha = shaOut;
    res.json({
      sha,
      shortSha:  sha === "unknown" ? "unknown" : sha.slice(0, 8),
      branch:    branchOut || "unknown",
      message:   message  || "unknown",
      date:      date     || null,
      author:    author   || null,
      available: sha !== "unknown",
    });
  } catch (err) {
    logger.warn({ err }, "[adminOps] git-info failed");
    res.json({ sha: "unknown", shortSha: "unknown", branch: "unknown", message: "Git info unavailable", date: null, author: null, available: false });
  }
});

// Live Verto + SIP registrations, enriched with user names
router.get("/admin/live-registrations", requireAdmin, async (_req, res) => {
  const now         = Date.now();
  const vertoRaw    = getAllSessions();
  const sipRaw      = getAllSipSessions();

  // Collect all userIds so we can batch-fetch names from DB
  const userIds = [...new Set([
    ...vertoRaw.map((s) => s.userId).filter(Boolean),
    ...sipRaw.map((s) => s.userId).filter(Boolean),
  ])] as string[];

  const nameMap: Record<string, string> = {};
  if (userIds.length > 0) {
    try {
      await connectDB();
      const users = await UserModel.find({ _id: { $in: userIds } })
        .select("_id name username email extension")
        .lean();
      for (const u of users) {
        nameMap[(u as any)._id.toString()] = (u as any).name ?? (u as any).username ?? (u as any).email ?? "Unknown";
      }
    } catch { /* DB may not be available — names are optional */ }
  }

  const verto = vertoRaw.map((s) => ({
    ...s,
    displayName: s.userId ? (nameMap[s.userId] ?? null) : null,
    pingAgeMs:   now - s.lastPingAt,
    alive:       now - s.lastPingAt < 45_000,
    transport:   "verto" as const,
  }));

  const sip = sipRaw.map((s) => ({
    ...s,
    displayName:  s.userId ? (nameMap[s.userId!] ?? null) : null,
    regAgeMs:     now - s.registeredAt,
    expiresInMs:  s.expiresAt - now,
    alive:        s.expiresAt > now,
    expired:      s.expiresAt <= now,
    transport:    "sip" as const,
  }));

  const totalOnline =
    verto.filter((s) => s.alive).length +
    sip.filter((s) => s.alive).length;

  res.json({ verto, sip, totalOnline, asOf: new Date(now).toISOString() });
});

// SSE real-time event stream
router.get("/admin/events/stream", requireAdmin, (req: Request, res: Response) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Send initial snapshot immediately
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now(), metricsInterval: 5000 })}\n\n`);
  res.write(`event: metrics\ndata: ${JSON.stringify(metrics.snapshot())}\n\n`);

  const esl = eslStatus();
  res.write(`event: esl\ndata: ${JSON.stringify({ connected: esl.connected, enabled: esl.enabled, ts: Date.now() })}\n\n`);

  addSseClient(res);

  // Heartbeat every 20 s to keep connection alive through proxies
  const hb = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      removeSseClient(res);
      clearInterval(hb);
    }
  }, 20_000);

  req.on("close", () => {
    removeSseClient(res);
    clearInterval(hb);
  });
});

// TLS certificate info for APP_URL
router.get("/admin/tls-info", requireAdmin, async (_req, res) => {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    res.json({ available: false, reason: "APP_URL not configured" });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    res.json({ available: false, reason: "APP_URL is not a valid URL" });
    return;
  }

  if (parsed.protocol !== "https:") {
    res.json({ available: false, reason: "APP_URL is not HTTPS — TLS check skipped" });
    return;
  }

  const hostname = parsed.hostname;
  const port     = parseInt(parsed.port || "443", 10);

  try {
    const certInfo = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate(false);
        socket.destroy();
        if (!cert || !cert.valid_to) { reject(new Error("No certificate returned")); return; }
        const expiresAt    = new Date(cert.valid_to);
        const daysRemaining = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
        resolve({
          subject:        cert.subject?.CN ?? hostname,
          issuer:         cert.issuer?.O  ?? cert.issuer?.CN ?? "unknown",
          validFrom:      cert.valid_from,
          validTo:        cert.valid_to,
          daysRemaining,
          fingerprint:    cert.fingerprint,
          healthy:        daysRemaining > 14,
          critical:       daysRemaining <= 7,
          warning:        daysRemaining > 7 && daysRemaining <= 30,
        });
      });
      socket.setTimeout(6_000);
      socket.on("error",   (e) => { socket.destroy(); reject(e); });
      socket.on("timeout", ()  => { socket.destroy(); reject(new Error("TLS connection timed out")); });
    });

    res.json({ available: true, hostname, ...certInfo });
  } catch (err: any) {
    logger.warn({ err: err?.message, hostname }, "[adminOps] TLS cert check failed");
    res.json({ available: false, reason: err?.message ?? "TLS check failed", hostname });
  }
});

// Push delivery statistics
router.get("/admin/push-stats", requireAdmin, (_req, res) => {
  const totalSent   = metrics.pushFcmSent + metrics.pushWebSent + metrics.pushExpoSent;
  const totalFailed = metrics.pushFcmFailed + metrics.pushWebFailed + metrics.pushExpoFailed;
  const total       = totalSent + totalFailed;
  res.json({
    fcm:     { sent: metrics.pushFcmSent,  failed: metrics.pushFcmFailed  },
    webpush: { sent: metrics.pushWebSent,  failed: metrics.pushWebFailed  },
    expo:    { sent: metrics.pushExpoSent, failed: metrics.pushExpoFailed },
    wakeups: metrics.pushWakeups,
    totals:  { sent: totalSent, failed: totalFailed, successRate: total > 0 ? Math.round((totalSent / total) * 100) : null },
    asOf:    new Date().toISOString(),
  });
});

// Last 60 concurrent-call samples (1 per minute)
router.get("/admin/concurrent-history", requireAdmin, (_req, res) => {
  res.json({ samples: concurrentHistory.slice(), asOf: new Date().toISOString() });
});

// ── Public health gate — used by pre-deploy.sh and load-balancer probes ───────
//
// No auth required.  Returns HTTP 200 when all core subsystems are healthy,
// HTTP 503 when one or more are unhealthy.  Intentionally fast (<5 ms) —
// MongoDB readyState is checked in-process with no round-trip query.
router.get("/health", async (_req, res) => {
  const esl    = eslStatus();
  const recon  = getReconciliationStats();

  // MongoDB: check Mongoose connection state (1 = connected)
  let mongoOk = false;
  try {
    await connectDB();
    mongoOk = mongoose.connection.readyState === 1;
  } catch {
    mongoOk = false;
  }

  // ESL: disabled ESL counts as "ok" — not every deployment has FreeSWITCH
  const eslOk = !esl.enabled || esl.connected;

  // Reconciliation: must have run at least once in the last 5 minutes
  const reconOk =
    recon.lastRanAt !== null &&
    Date.now() - recon.lastRanAt < 5 * 60 * 1000;

  const healthy = mongoOk && eslOk;

  res.status(healthy ? 200 : 503).json({
    healthy,
    services: {
      mongodb:        { ok: mongoOk,  readyState: mongoose.connection.readyState },
      esl:            { ok: eslOk,    enabled: esl.enabled, connected: esl.connected },
      reconciliation: { ok: reconOk,  cycles: recon.cycles, lastRanAt: recon.lastRanAt },
    },
    asOf: new Date().toISOString(),
  });
});

// ── Platform Health History — sparkline data (ring buffer, up to 60 samples) ──
router.get("/admin/platform-health-history", requireAdmin, (_req, res) => {
  res.json({ samples: getHealthHistory(), asOf: new Date().toISOString() });
});

// NOTE: GET /admin/platform-health is served by routes/health.ts, which returns
// the full shape the admin dashboard expects (db, websocket, calls, process,
// push, history, …). A stale duplicate handler that lived here returned a
// divergent shape and was removed to prevent the dashboard from crashing if it
// ever shadowed the canonical handler.

/**
 * GET /api/admin/db-info
 *
 * Returns the MongoDB connection state and the actual database name being used.
 * Used by the admin dashboard to warn when the wrong database is connected
 * (e.g. "test" instead of "prawwplus") — which would cause phone lookups to fail.
 */
router.get("/admin/db-info", requireAdmin, async (_req, res) => {
  try {
    await connectDB();
    const conn   = mongoose.connection;
    const dbName = conn.db?.databaseName ?? conn.name ?? null;
    res.json({
      connected:   conn.readyState === 1,
      readyState:  conn.readyState,
      dbName,
      correctDb:   dbName === "prawwplus",
      asOf:        new Date().toISOString(),
    });
  } catch (err: any) {
    res.json({
      connected:   false,
      readyState:  0,
      dbName:      null,
      correctDb:   false,
      error:       err?.message ?? "DB check failed",
      asOf:        new Date().toISOString(),
    });
  }
});

export default router;
