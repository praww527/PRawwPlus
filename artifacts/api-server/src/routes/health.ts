import { Router, type IRouter } from "express";
import mongoose from "mongoose";
import net from "net";
import { eslStatus } from "../lib/freeswitchESL";
import { eslBufferDepth } from "../lib/eslEventBuffer";
import { countPendingEslEvents } from "../lib/reconciliationWorker";

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
  const managedTurnHost   = process.env.TURN_HOST   ?? null;
  const managedTurnSecret = process.env.TURN_SECRET ?? null;
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
          const probe  = await tcpProbe(parsed.host, parsed.port);
          return {
            url,
            scheme:     parsed.scheme,
            host:       parsed.host,
            port:       parsed.port,
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

  res.status(ok ? 200 : 503).json({
    ok,
    hasTurn,
    onlyStun,
    turnReachable: hasTurn ? turnReachable : false,
    servers: flat,
    summary,
    // Expose whether managed TURN mode (HMAC credentials) is active
    managedTurn: Boolean(process.env.TURN_SECRET && process.env.TURN_HOST),
    turnHost: process.env.TURN_HOST ?? null,
  });
});

export default router;
