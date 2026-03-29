import { Router, type IRouter } from "express";
import { eslStatus } from "../lib/freeswitchESL";
import { eslBufferDepth } from "../lib/eslEventBuffer";
import { countPendingEslEvents } from "../lib/reconciliationWorker";

const router: IRouter = Router();

router.get("/healthz-lite", async (_req, res) => {
  const esl = eslStatus();
  res.json({
    status: "ok",
    esl: {
      enabled:   esl.enabled,
      connected: esl.connected,
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
