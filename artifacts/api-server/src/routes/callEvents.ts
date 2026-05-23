/**
 * Call event timeline routes.
 *
 * GET  /api/calls/:callId/events        — retrieve the full event log for a call
 * POST /api/calls/:callId/quality       — ingest a WebRTC quality sample
 * GET  /api/admin/calls/:callId/events  — admin view (any user's call)
 */

import { Router, type IRouter } from "express";
import { connectDB, CallModel } from "@workspace/db";
import { getCallEvents, appendCallEvent } from "../lib/callEventLog";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── GET /api/calls/:callId/events ─────────────────────────────────────────

router.get("/calls/:callId/events", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    await connectDB();
    const { callId } = req.params;
    const userId = (req as any).user.id;
    const isAdmin = !!(req as any).user?.isAdmin;

    if (!isAdmin) {
      const call = await CallModel.findOne({ _id: callId, userId }).select("_id").lean();
      if (!call) { res.status(404).json({ error: "Call not found" }); return; }
    }

    const events = await getCallEvents(callId, 500);
    res.json({ events });
  } catch (err) {
    logger.error({ err }, "[CallEvents] GET error");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── POST /api/calls/:callId/quality ──────────────────────────────────────

router.post("/calls/:callId/quality", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    await connectDB();
    const { callId } = req.params;
    const userId = (req as any).user.id;

    const call = await CallModel.findOne({ _id: callId, userId })
      .select("_id userId fsCallId")
      .lean();
    if (!call) { res.status(404).json({ error: "Call not found" }); return; }

    const { ts, packetsLost, packetsSent, packetsReceived, jitterMs, rttMs,
            bytesSent, bytesReceived, candidateType, mos } = req.body;

    await appendCallEvent({
      callId:    String(call._id),
      fsCallId:  (call as any).fsCallId,
      userId:    String(call.userId),
      sessionId: req.headers["x-session-id"] as string | undefined,
      traceId:   req.headers["x-request-id"] as string | undefined,
      event:     "quality_sample",
      metadata: {
        packetsLost:     Number(packetsLost)     || 0,
        packetsSent:     Number(packetsSent)     || 0,
        packetsReceived: Number(packetsReceived) || 0,
        jitterMs:        Number(jitterMs)        || 0,
        rttMs:           Number(rttMs)           || 0,
        bytesSent:       Number(bytesSent)       || 0,
        bytesReceived:   Number(bytesReceived)   || 0,
        candidateType:   String(candidateType    || "unknown"),
        mos:             Number(mos)             || 0,
      },
      ts: ts ? new Date(ts) : new Date(),
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[CallEvents] POST quality error");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /api/admin/calls/:callId/events ───────────────────────────────────

router.get("/admin/calls/:callId/events", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!(req as any).user?.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }
  try {
    const events = await getCallEvents(req.params.callId, 500);
    res.json({ events });
  } catch (err) {
    logger.error({ err }, "[CallEvents] Admin GET error");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
