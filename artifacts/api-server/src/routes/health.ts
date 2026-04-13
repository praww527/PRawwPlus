import { Router, type IRouter } from "express";
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

router.get("/healthz", async (_req, res) => {
  const esl = eslStatus();
  let pendingEslEvents = 0;
  try {
    pendingEslEvents = await Promise.race([
      countPendingEslEvents(),
      new Promise<number>((resolve) => setTimeout(() => resolve(0), 750)),
    ]);
  } catch {
    /* DB optional on health scrape */
  }
  res.json({
    status:         "ok",
    voice: {
      configured: missingVoiceConfig().length === 0,
      missing:    missingVoiceConfig(),
      vertoProxy: Boolean(process.env.FREESWITCH_SSH_KEY || process.env.FREESWITCH_WS_URL),
      sipProxy:   Boolean(process.env.FREESWITCH_SSH_KEY || process.env.FREESWITCH_SIP_WS_URL),
    },
    esl: {
      enabled:          esl.enabled,
      connected:        esl.connected,
      host:             esl.host,
      port:             esl.port,
      bufferedEvents:   eslBufferDepth(),
      pendingDbEvents:  pendingEslEvents,
    },
  });
});

export default router;
