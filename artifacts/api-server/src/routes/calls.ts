import { Router, type IRouter } from "express";
import { connectDB, CallModel, UserModel } from "@workspace/db";
import { randomUUID } from "crypto";
import { resolvePhoneToExtension } from "../lib/phoneResolver";
import { normalizePhoneNumber } from "../lib/phoneNormalize";
import { endCallById, webhookUpdate, registerInitiatedCall } from "../lib/callOrchestrator";
import { sendFcmDataMessage, sendWebPushToSubscription, sendExpoPush } from "../lib/push";
import {
  isValidFsCallId,
  countActiveCallsForUser,
  clearStaleCallsForUser,
  sumExternalCoinsSpentTodayUtc,
  maxConcurrentCallsPerUser,
  maxCoinsSpendPerDay,
  requireFsCallIdForExternal,
} from "../lib/callLimits";
import { userRateLimit } from "../lib/userRateLimit";
import { logger } from "../lib/logger";
import { parsePageLimit } from "../lib/pagination";
import { isExtensionOnline, getSessionCount } from "../lib/callSession";

const router: IRouter = Router();

router.get("/calls", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { page, limit, skip } = parsePageLimit(req.query);

  const [callDocs, total] = await Promise.all([
    CallModel.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CallModel.countDocuments({ userId }),
  ]);

  res.json({
    calls: callDocs.map((c: any) => ({ ...c, id: c._id })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.post("/calls", userRateLimit(40, 60_000), async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { recipientNumber: rawRecipient, notes, fsCallId, direction, callerNumber: bodyCallerNumber } = req.body;

  if (!rawRecipient) {
    res.status(400).json({ error: "recipientNumber is required" });
    return;
  }

  // ── Normalise recipient phone number ──────────────────────────────────────
  // Try SA E.164 normalisation first.  If it succeeds (i.e. the destination is
  // a SA mobile/landline), use the +27xxxxxxxxx form for call records, billing
  // and the SIP bridge string.  If it fails (internal extension, foreign number,
  // or the user typed something invalid), keep the raw value — the extension
  // resolver or carrier will handle/reject it normally.
  const normResult      = normalizePhoneNumber(String(rawRecipient).trim());
  const recipientNumber = normResult.ok ? normResult.e164 : String(rawRecipient).trim();

  const user = await UserModel.findById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Resolve the call route first so we know whether this is an internal
  // (extension-to-extension) or external (PSTN) call before applying restrictions.
  // Internal calls between registered users never need a verified phone number.
  const resolvedExtension = direction === "inbound"
    ? null
    : await resolvePhoneToExtension(recipientNumber);
  const route = resolvedExtension
    ? { type: "internal" as const, extension: resolvedExtension }
    : { type: direction === "inbound" ? "internal" as const : "external" as const };
  const callType = route.type;

  // ── Pre-call extension online check ─────────────────────────────────────────
  // For internal (extension-to-extension) calls, verify the destination is
  // currently connected via the Verto proxy session map.
  // This gives instant feedback instead of waiting for the 20 s INITIATED timeout.
  //
  // IMPORTANT: This is a soft check — we warn but do NOT block for two reasons:
  //   1. The session map is empty right after server restart (extensions may be
  //      connected but not yet tracked because login wasn't seen since restart).
  //   2. JsSIP mobile clients register via the SIP proxy (not Verto), so they
  //      won't appear in the Verto session map.
  // Hard blocking will be added once the session map is populated reliably.
  if (callType === "internal" && resolvedExtension) {
    const sessionCount = getSessionCount();
    const online = isExtensionOnline(resolvedExtension);
    if (sessionCount > 0 && !online) {
      logger.warn(
        { extension: resolvedExtension, sessionCount },
        "[Calls] Destination extension NOT in active Verto sessions — " +
        "extension may be offline, backgrounded, or on JsSIP (mobile). " +
        "Push notification sent; 20 s INITIATED timeout is the fallback.",
      );
    } else {
      logger.info(
        { extension: resolvedExtension, online, sessionCount },
        "[Calls] Pre-call extension session check",
      );
    }
  }

  if (callType === "external") {
    // External (PSTN) calls require a verified mobile number so caller-ID
    // and billing are accurate.  Internal extension calls are exempt.
    if (direction !== "inbound" && (!user.phone || !user.phoneVerified)) {
      res.status(403).json({
        error: "Phone number required",
        message: "You must add and verify your mobile number before making external calls.",
      });
      return;
    }
    const hasFs = fsCallId != null && String(fsCallId).trim() !== "";
    if (hasFs && !isValidFsCallId(fsCallId)) {
      res.status(400).json({
        error:   "Invalid fsCallId",
        message: "fsCallId must be a UUID string when provided.",
      });
      return;
    }
    if (requireFsCallIdForExternal() && !isValidFsCallId(fsCallId)) {
      res.status(400).json({
        error:   "fsCallId required",
        message:
          "Set REQUIRE_FS_CALL_ID_EXTERNAL=false for legacy SIP clients, or pass the Verto/FS channel UUID.",
      });
      return;
    }
    const maxConc = maxConcurrentCallsPerUser();
    if (maxConc > 0) {
      // Auto-clear any calls stuck in initiated/ringing for > 3 minutes before
      // checking the limit — this prevents stale records from a failed previous
      // attempt permanently blocking new calls until the reconciliation worker
      // runs (default every 60 s, worst-case 15 min for the stale threshold).
      await clearStaleCallsForUser(userId, 3 * 60 * 1000);

      const active = await countActiveCallsForUser(userId);
      if (active >= maxConc) {
        res.status(429).json({
          error:   "Too many active calls",
          message: `You may have at most ${maxConc} active call(s). End a call before starting another.`,
        });
        return;
      }
    }
    const dailyCap = maxCoinsSpendPerDay();
    if (dailyCap > 0) {
      const spentToday = await sumExternalCoinsSpentTodayUtc(userId);
      if (spentToday >= dailyCap) {
        res.status(400).json({
          error:   "Daily external spend limit",
          message: `External calls are limited to ${dailyCap} coins per UTC day (recorded spend).`,
        });
        return;
      }
    }
    if (user.subscriptionStatus !== "active") {
      res.status(400).json({
        error:   "No active subscription",
        message: "You need an active subscription to make external calls.",
      });
      return;
    }
    if (user.coins <= 0) {
      res.status(400).json({
        error:   "Insufficient coins",
        message: "Your wallet is empty. Please top up to make external calls.",
      });
      return;
    }
  }

  // For inbound records the callee POSTs their own record after answering.
  // The frontend sends the real caller's number as bodyCallerNumber so call
  // history shows the correct "from" party.  For outbound, use the verified
  // mobile number only — never fall back to the extension (backend-only field).
  const callerNumber = direction === "inbound" && bodyCallerNumber
    ? String(bodyCallerNumber)
    : (user.phone ?? undefined);
  const callId = randomUUID();

  // Log raw vs normalised destination so outbound SIP failures can be traced
  // back to the exact number form that reached FreeSWITCH.
  {
    const { logger } = await import("../lib/logger");
    logger.info(
      {
        userId,
        callId,
        rawRecipient:         String(rawRecipient).trim(),
        normalizedRecipient:  recipientNumber,
        normalizationOk:      normResult.ok,
        ...(normResult.ok ? {} : { normalizationReason: (normResult as { reason: string }).reason }),
        callType,
        direction: direction === "inbound" ? "inbound" : "outbound",
        resolvedExtension: resolvedExtension ?? null,
      },
      "[calls] Outbound call destination",
    );
  }

  const callRecord = await CallModel.create({
    _id:             callId,
    userId,
    callerNumber,
    recipientNumber,
    callType,
    direction:       direction === "inbound" ? "inbound" : "outbound",
    status:          "initiated",
    duration:        0,
    cost:            0,
    fsCallId:        fsCallId ?? undefined,
    notes:           notes ?? undefined,
    startedAt:       new Date(),
  });

  // Start the INITIATED-state watchdog so calls that never receive a
  // FreeSWITCH CHANNEL_ORIGINATE or CHANNEL_HANGUP_COMPLETE event are
  // automatically marked failed after 20 s instead of hanging indefinitely.
  if (fsCallId && typeof fsCallId === "string" && fsCallId.trim()) {
    registerInitiatedCall(fsCallId.trim(), callId);
  }

  // ── Early wakeup push for internal calls ─────────────────────────────────
  //
  // Problem: FreeSWITCH tries to bridge to the callee the moment it receives
  // `verto.invite`.  If the callee's Verto WebSocket is not active (app
  // backgrounded / screen off), `verto_contact()` returns empty and the
  // bridge fails instantly with USER_NOT_REGISTERED — before the push
  // notification from CHANNEL_ORIGINATE can even arrive.
  //
  // Fix (backend side): Send a silent high-priority FCM data message to the
  // callee right now, at call-creation time.  FCM delivers this within ~50 ms
  // and wakes the Android app / Verto WebSocket before the caller's browser
  // waits its 2.5-second grace period and then sends verto.invite.
  //
  // Send push notifications to the callee immediately at call-creation time:
  //   - FCM data message:  silent wakeup so the Android app/Verto WebSocket
  //     reconnects before FreeSWITCH attempts verto.invite.
  //   - Web push + Expo:   visible "Incoming Call" alert with Answer/Decline so
  //     browser and iOS users are notified even without FreeSWITCH configured.
  // If FreeSWITCH IS configured, CHANNEL_ORIGINATE fires another push with the
  // real B-leg UUID; the service worker uses `tag: "incoming-call"` so the
  // second notification simply replaces the first on the user's device.
  let calleeNotified = false;
  if (callType === "internal" && resolvedExtension) {
    try {
      const calleeUser = await UserModel.findOne({ extension: resolvedExtension })
        .select("fcmToken expoPushToken webPushSubscription dnd notificationPrefs")
        .lean();

      const calleeOpts = calleeUser as any;
      if (
        calleeUser &&
        !calleeUser.dnd &&
        (calleeUser as any).notificationPrefs?.incomingCalls !== false
      ) {
        const callerDisplay = (user as any).name ?? (user as any).phone ?? String((user as any).extension ?? "caller");
        const callerPhone   = (user as any).phoneVerified ? ((user as any).phone ?? undefined) : undefined;

        // Full incoming-call push payload — same shape the service worker expects.
        const pushData: Record<string, string> = {
          type:          "incoming_call",
          callUuid:      callRecord._id.toString(),
          ...(callerPhone
            ? { fromPhone: callerPhone }
            : { fromExtension: String((user as any).extension ?? "") }),
        };

        const notifTitle = "📞 Incoming Call";
        const notifBody  = `${callerDisplay} is calling you`;

        const tasks: Promise<void>[] = [];

        // FCM — silent wakeup so the Android app/Verto WebSocket reconnects
        // before FreeSWITCH tries to deliver the verto.invite.
        if (calleeOpts.fcmToken) {
          tasks.push(
            sendFcmDataMessage(calleeOpts.fcmToken, pushData).catch((err) => {
              logger.warn({ err, resolvedExtension }, "[calls] callee FCM wakeup failed");
            }),
          );
        }

        // Web push — visible incoming-call notification with Answer / Decline
        // actions for browser users (requires VAPID keys to be configured).
        if (calleeOpts.webPushSubscription?.endpoint) {
          tasks.push(
            sendWebPushToSubscription(
              calleeOpts.webPushSubscription as { endpoint: string; keys: { auth: string; p256dh: string } },
              { ...pushData, title: notifTitle, body: notifBody },
              String((calleeUser as any)._id),
            ).then((result) => {
              if (result.error === "expired") {
                UserModel.updateOne(
                  { _id: (calleeUser as any)._id },
                  { $unset: { webPushSubscription: 1 } },
                ).catch(() => {});
              }
            }),
          );
        }

        // Expo push — for iOS/React Native users.
        if (calleeOpts.expoPushToken) {
          tasks.push(
            sendExpoPush(calleeOpts.expoPushToken, notifTitle, notifBody, pushData).catch((err) => {
              logger.warn({ err, resolvedExtension }, "[calls] callee Expo push failed");
            }),
          );
        }

        if (tasks.length > 0) {
          Promise.all(tasks).catch(() => {});
          calleeNotified = true;
          logger.info(
            { resolvedExtension, fcm: !!calleeOpts.fcmToken, web: !!calleeOpts.webPushSubscription, expo: !!calleeOpts.expoPushToken },
            "[calls] Sent incoming-call push to callee",
          );
        }
      }
    } catch (err) {
      logger.warn({ err, resolvedExtension }, "[calls] callee wakeup lookup failed — continuing");
    }
  }

  res.json({
    ...callRecord.toJSON(),
    id: callRecord._id,
    type: route.type,
    ...(route.type === "internal" && "extension" in route ? { extension: route.extension } : {}),
    dialTarget: route.type === "internal" && "extension" in route ? String(route.extension) : undefined,
    // True when a wakeup push was sent to the callee.  The frontend uses this
    // to decide whether to pause before sending verto.invite so FreeSWITCH
    // finds an active Verto session for the callee instead of failing instantly.
    calleeNotified,
  });
});

router.get("/calls/:callId", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;
  const { callId } = req.params;

  const call = await CallModel.findOne({ _id: callId, userId }).lean();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json({ ...call, id: call._id });
});

router.post("/calls/:callId/end", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId  = (req as any).user.id as string;
  const { callId } = req.params;
  const { duration, status } = req.body;

  const durationSecs = typeof duration === "number" ? Math.max(0, Math.floor(duration)) : 0;

  try {
    const result = await endCallById(callId, userId, durationSecs, status);
    res.json(result);
  } catch (err: any) {
    const code = err?.statusCode ?? 500;
    res.status(code).json({ error: err?.message ?? "Internal server error" });
  }
});

router.delete("/calls/:callId", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id as string;
  const { callId } = req.params;

  const result = await CallModel.deleteOne({ _id: callId, userId });
  if (result.deletedCount === 0) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json({ ok: true });
});

router.post("/calls/webhook/freeswitch", async (req, res) => {
  const hookSecret = process.env.FREESWITCH_WEBHOOK_SECRET;
  if (
    hookSecret &&
    String(req.get("x-fs-webhook-secret") ?? "") !== hookSecret
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { event, callId, userId, duration, status } = req.body;

  if (
    typeof callId !== "string" ||
    typeof userId !== "string" ||
    !callId.trim() ||
    !userId.trim()
  ) {
    res.sendStatus(200);
    return;
  }

  if (event != null && typeof event !== "string") {
    res.sendStatus(200);
    return;
  }

  const durationSecs = typeof duration === "number" ? Math.max(0, duration) : 0;

  try {
    await webhookUpdate(
      typeof event === "string" ? event : "",
      callId,
      userId,
      durationSecs,
      typeof status === "string" ? status : undefined,
    );
  } catch (err) {
    logger.error(
      { err, event, callId, userId },
      "[calls] webhookUpdate failed — returning 200 to avoid FS retry storm",
    );
  }

  res.sendStatus(200);
});

export default router;
