import { Router, type IRouter } from "express";
import mongoose from "mongoose";
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

export default router;
