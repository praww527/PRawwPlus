import { Router, type IRouter } from "express";
import mongoose from "mongoose";
import net from "net";
import { eslStatus } from "../lib/freeswitchESL";
import { eslBufferDepth } from "../lib/eslEventBuffer";
import { countPendingEslEvents } from "../lib/reconciliationWorker";
import { metrics } from "../lib/metrics";
import { getProcessMetrics } from "../lib/processMetrics";
import { getHealthHistory } from "../lib/healthRingBuffer";
import { getSessionCount, getSipSessionCount } from "../lib/callSession";

const router: IRouter = Router();

function missingVoiceConfig(): string[] {
  const required = [
    "FREESWITCH_DOMAIN",
    "FREESWITCH_ESL_PASSWORD",
    "FREESWITCH_SSH_KEY",
  ];
  return required.filter((key) => !process.env[key]);
}

router.get("/healthz-lite", async (_req, res) => {
  const esl = eslStatus();
  res.json({
    status: "ok",
    esl: {
      enabled:   esl.enabled,
      connected: esl.connected,
    },
    voice: {
      configured: missingVoiceConfig().length === 0,
      missing:    missingVoiceConfig(),
    },
  });
});

async function dbPing(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const state = mongoose.connection.readyState;
    if (state !== 1) return { ok: false, latencyMs: Date.now() - start };
    await mongoose.connection.db?.admin().ping();
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

router.get("/healthz", async (_req, res) => {
  const esl = eslStatus();
  const [db, pendingEslEvents] = await Promise.all([
    dbPing(),
    Promise.race([
      countPendingEslEvents(),
      new Promise<number>((resolve) => setTimeout(() => resolve(0), 750)),
    ]).catch(() => 0),
  ]);

  const overallStatus = db.ok ? "ok" : "degraded";

  res.status(db.ok ? 200 : 503).json({
    status: overallStatus,
    db: {
      ok:        db.ok,
      latencyMs: db.latencyMs,
      state:     mongoose.connection.readyState,
    },
    voice: {
      configured: missingVoiceConfig().length === 0,
      missing:    missingVoiceConfig(),
      vertoProxy: Boolean(process.env.FREESWITCH_SSH_KEY || process.env.FREESWITCH_WS_URL),
      sipProxy:   Boolean(process.env.FREESWITCH_SSH_KEY || process.env.FREESWITCH_SIP_WS_URL),
    },
    esl: {
      enabled:         esl.enabled,
      connected:       esl.connected,
      host:            esl.host,
      port:            esl.port,
      bufferedEvents:  eslBufferDepth(),
      pendingDbEvents: pendingEslEvents,
    },
  });
});

// ─── TURN / ICE health endpoint ──────────────────────────────────────────────

interface IceServerEntry {
  urls: string | string[];
  username?: string;
  credential?: string;
}

function parseIceUrl(url: string): { scheme: string; host: string; port: number } {
  // Format: stun:host:port  or  turn:host:port?transport=udp
  const clean   = url.split("?")[0];
  const scheme  = clean.split(":")[0].toLowerCase();
  const rest    = clean.slice(scheme.length + 1);           // host:port
  const lastColon = rest.lastIndexOf(":");
  const host    = lastColon >= 0 ? rest.slice(0, lastColon) : rest;
  const port    = lastColon >= 0 ? parseInt(rest.slice(lastColon + 1), 10) : (scheme === "turns" ? 5349 : 3478);
  return { scheme, host, port: isNaN(port) ? 3478 : port };
}

async function tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<{ reachable: boolean; latencyMs: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (reachable: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ reachable, latencyMs: Date.now() - start });
    };

    socket.setTimeout(timeoutMs);
    socket.connect(port, host, () => finish(true));
    socket.on("error", ()    => finish(false));
    socket.on("timeout", ()  => finish(false));
  });
}

router.get("/healthz/turn", async (_req, res) => {
  const managedTurnHost   = process.env.TURN_HOST       ?? null;
  const managedTurnSecret = process.env.TURN_SECRET     ?? null;
  // TURN_PROBE_HOST overrides the TCP probe target — set to 127.0.0.1 when
  // the TURN server runs on the same VM as the API (Oracle/AWS hairpin NAT
  // drops traffic from the VM to its own public IP).
  const probeHost         = process.env.TURN_PROBE_HOST ?? managedTurnHost;
  const managed = Boolean(managedTurnHost && managedTurnSecret);

  // ICE server priority:
  //   1. Managed TURN mode (TURN_HOST + TURN_SECRET env vars) — probe the actual TURN server
  //   2. DB stored servers
  //   3. ICE_SERVERS env var
  //   4. Hardcoded STUN defaults (signals misconfiguration)
  let iceServers: IceServerEntry[] = [];

  if (managed && managedTurnHost) {
    iceServers = [
      { urls: `stun:${managedTurnHost}:3478` },
      {
        urls: [
          `turn:${managedTurnHost}:3478?transport=udp`,
          `turn:${managedTurnHost}:3478?transport=tcp`,
          `turns:${managedTurnHost}:5349?transport=tcp`,
        ],
        username:   "healthcheck",
        credential: "healthcheck",
      },
    ];
  } else {
    try {
      const { connectDB } = await import("@workspace/db");
      await connectDB();
      const { SystemConfigModel } = await import("@workspace/db");
      const sysConfig = await SystemConfigModel.findById("singleton").lean();
      if (sysConfig?.iceServers?.length) {
        iceServers = sysConfig.iceServers as IceServerEntry[];
      }
    } catch { /* DB not available */ }

    if (!iceServers.length && process.env.ICE_SERVERS) {
      try { iceServers = JSON.parse(process.env.ICE_SERVERS); } catch { /* ignore */ }
    }

    if (!iceServers.length) {
      iceServers = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ];
    }
  }

  // Probe each server
  const probeResults = await Promise.all(
    iceServers.map(async (server) => {
      const urlList = Array.isArray(server.urls) ? server.urls : [server.urls];
      const urlProbes = await Promise.all(
        urlList.map(async (url) => {
          const parsed = parseIceUrl(url);
          const isTurn = parsed.scheme === "turn" || parsed.scheme === "turns";
          // Use probeHost (TURN_PROBE_HOST or managedTurnHost) so that when
          // Coturn is co-located on the same VM we probe via 127.0.0.1 and
          // bypass Oracle/AWS hairpin-NAT dropping.
          const targetHost = (managed && probeHost && parsed.host === managedTurnHost)
            ? probeHost
            : parsed.host;
          const probe  = await tcpProbe(targetHost, parsed.port);
          return {
            url,
            scheme:     parsed.scheme,
            host:       parsed.host,
            port:       parsed.port,
            probeHost:  targetHost !== parsed.host ? targetHost : undefined,
            isTurn,
            hasAuth:    Boolean(server.username && server.credential),
            reachable:  probe.reachable,
            latencyMs:  probe.latencyMs,
          };
        }),
      );
      return urlProbes;
    }),
  );

  const flat = probeResults.flat();
  const allReachable  = flat.every((r) => r.reachable);
  const hasTurn       = flat.some((r)  => r.isTurn);
  const onlyStun      = !hasTurn;
  const turnReachable = hasTurn ? flat.filter((r) => r.isTurn).every((r) => r.reachable) : false;

  // Determine overall health — STUN-only is treated as a hard failure for
  // production because symmetric NAT (mobile carriers, corporate firewalls)
  // will drop peer-to-peer ICE candidates and calls will fail silently.
  const ok = allReachable && hasTurn && turnReachable;

  let summary: string;
  if (onlyStun) {
    summary =
      "STUN-only — TURN server not configured. " +
      "Calls will fail behind symmetric NAT (4G/LTE mobile, most corporate networks). " +
      "Deploy Coturn and set TURN_HOST + TURN_SECRET env vars before production rollout.";
  } else if (!allReachable) {
    summary =
      "One or more ICE servers are unreachable. " +
      "Check firewall rules: ports 3478 TCP/UDP (TURN), 5349 TCP (TURNS/TLS), " +
      "and relay UDP range 49152-65535 must be open.";
  } else if (!turnReachable) {
    summary =
      "TURN server is configured but unreachable. " +
      "Verify Coturn is running and ports 3478/5349 are open in the VPS firewall.";
  } else {
    summary = "TURN server reachable — relay candidates will be available for symmetric NAT traversal.";
  }

  // Automatic STUN-only fallback: if TURN is configured but completely
  // unreachable (e.g. Coturn not yet running), include STUN-only servers so
  // callers on the same network can still connect while the admin fixes TURN.
  // The "stunOnly" flag tells the client to warn the user about degraded NAT.
  const stunOnly = onlyStun;
  const turnDown = hasTurn && !turnReachable;
  const fallbackStunServers = turnDown
    ? [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ]
    : null;

  res.status(ok ? 200 : 503).json({
    ok,
    hasTurn,
    onlyStun,
    stunOnly,
    turnDown,
    turnReachable: hasTurn ? turnReachable : false,
    servers: flat,
    summary,
    // When TURN is configured but unreachable, include fallback STUN so clients
    // can still attempt calls on same-network paths while TURN is fixed.
    fallbackStunServers,
    // Expose whether managed TURN mode (HMAC credentials) is active
    managedTurn: Boolean(process.env.TURN_SECRET && process.env.TURN_HOST),
    turnHost: process.env.TURN_HOST ?? null,
  });
});

// ─── /admin/platform-health — comprehensive operator dashboard endpoint ───────
//
// Aggregates all subsystem health indicators into a single JSON response.
// Protected by a bearer token (ADMIN_API_KEY env var). If ADMIN_API_KEY is
// not set the endpoint responds 501 — do not expose unauthenticated in prod.
//
// Returns 200 when all critical subsystems are healthy, 503 when degraded.

router.get("/admin/platform-health", async (req, res) => {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    res.status(501).json({ error: "ADMIN_API_KEY not configured" });
    return;
  }
  const auth = req.headers["authorization"] ?? req.headers["x-admin-key"] ?? "";
  const token = auth.toString().replace(/^Bearer\s+/i, "").trim();
  if (token !== adminKey) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const esl     = eslStatus();
  const proc    = getProcessMetrics();
  const history = getHealthHistory();
  const snap    = metrics.snapshot();

  const [dbResult, pendingEslEvents] = await Promise.all([
    dbPing(),
    Promise.race([
      countPendingEslEvents(),
      new Promise<number>((resolve) => setTimeout(() => resolve(-1), 500)),
    ]).catch(() => -1),
  ]);

  // --- Derive overall health status ---
  const eslStaleSec = esl.lastEventAt
    ? Math.round((Date.now() - esl.lastEventAt) / 1000)
    : null;

  const healthy =
    dbResult.ok &&
    esl.connected &&
    (eslStaleSec === null || eslStaleSec < 120) &&
    proc.loopLagMs < 500;

  const status = healthy ? "ok" : "degraded";
  const httpCode = healthy ? 200 : 503;

  res.status(httpCode).json({
    status,
    ts:          new Date().toISOString(),
    uptimeSeconds: snap.uptimeSeconds,

    db: {
      ok:        dbResult.ok,
      latencyMs: dbResult.latencyMs,
      state:     mongoose.connection.readyState,
    },

    esl: {
      enabled:              esl.enabled,
      connected:            esl.connected,
      host:                 esl.host,
      port:                 esl.port,
      lastConnectedAt:      esl.lastConnectedAt,
      lastDisconnectedAt:   esl.lastDisconnectedAt,
      lastEventAt:          esl.lastEventAt,
      lastEventStaleSec:    eslStaleSec,
      lastDisconnectReason: esl.lastDisconnectReason,
      reconnectAttempt:     esl.reconnectAttempt,
      disconnectedMs:       snap.eslDisconnectedMs,
      eventsThisMinute:     esl.eventsThisMinute,
      eventsLastMinute:     esl.eventsLastMinute,
      bgapiQueueDepth:      esl.bgapiQueueDepth,
      bufferedEvents:       eslBufferDepth(),
      pendingDbEvents:      pendingEslEvents,
      stalledThroughputEvents: snap.eslStalledThroughputCount,
    },

    websocket: {
      activeVertoClients:           snap.activeVertoClients,
      activeSipClients:             snap.activeSipClients,
      activeUpstreamReconnectsVerto: snap.activeUpstreamReconnectsVerto,
      activeUpstreamReconnectsSip:   snap.activeUpstreamReconnectsSip,
      vertoSessionsInMemory:        getSessionCount(),
      sipRegistrationsInMemory:     getSipSessionCount(),
      wsConnectionsRejectedIpLimit: snap.wsConnectionsRejectedIpLimit,
    },

    calls: {
      activeCalls:       snap.activeCalls,
      callsInitiated:    snap.callsInitiated,
      callsAnswered:     snap.callsAnswered,
      callsFailed:       snap.callsFailed,
      failedOriginates:  snap.failedOriginates,
      rtpFailures:       snap.rtpFailures,
      noBridgeTimeouts:  snap.noBridgeTimeouts,
      iceFailures:       snap.iceFailures,
      voicemailFallbacks: snap.voicemailFallbacks,
      answerRatePct:     snap.callsInitiated > 0
        ? Math.round((snap.callsAnswered / snap.callsInitiated) * 1000) / 10
        : null,
      callSetupLatency:  snap.callSetupLatency,
      bridgeSetupLatency: snap.bridgeSetupLatency,
    },

    security: {
      sipFloodBlocked:       snap.sipFloodBlocked,
      callThrottleRejections: snap.callThrottleRejections,
      registrationFailures:  snap.registrationFailures,
      bgapiQueueDropped:     snap.bgapiQueueDropped,
    },

    sweeper: {
      staleSweepRuns:       snap.staleSweepRuns,
      staleSessionCleanups: snap.staleSessionCleanups,
      zombieCallsKilled:    snap.zombieCallsKilled,
    },

    push: {
      fcm:   { sent: snap.pushFcmSent,   failed: snap.pushFcmFailed   },
      web:   { sent: snap.pushWebSent,   failed: snap.pushWebFailed   },
      expo:  { sent: snap.pushExpoSent,  failed: snap.pushExpoFailed  },
      wakeups: snap.pushWakeups,
    },

    process: {
      heapUsedMb:  proc.heapUsedMb,
      heapTotalMb: proc.heapTotalMb,
      rssMb:       proc.rssMb,
      cpuUserMs:   proc.cpuUserMs,
      cpuSysMs:    proc.cpuSysMs,
      loopLagMs:   proc.loopLagMs,
      sampledAt:   proc.sampledAt ? new Date(proc.sampledAt).toISOString() : null,
    },

    history: history.slice(-15),  // last 15 samples (≈15 min of sparkline data)
  });
});

export default router;
