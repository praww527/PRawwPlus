import { Router, type IRouter } from "express";
import { eslStatus } from "../lib/freeswitchESL";
import { eslBufferDepth } from "../lib/eslEventBuffer";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const esl = eslStatus();
  res.json({
    status:         "ok",
    esl: {
      enabled:      esl.enabled,
      connected:    esl.connected,
      host:         esl.host,
      port:         esl.port,
      bufferedEvents: eslBufferDepth(),
    },
  });
});

export default router;
