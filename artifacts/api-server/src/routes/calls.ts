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
import { isExtensionOnline, getTotalSessionCount } from "../lib/callSession";
import {
  recordBLegInit,
  recordWakeupSent,
  waitForRegistration,
  getBLegDiagnostics,
} from "../lib/bLegManager";
import {
  recordALegInit,
  validateALegSource,
  getALegDiagnostics,
} from "../lib/aLegManager";
import { eslStatus, sendEslBgapiAwait, registerCallerIdInjection } from "../lib/freeswitchESL";
import { selectCallerId } from "../lib/callerIdSelector";

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
  const { recipientNumber: rawRecipient, notes, fsCallId, direction, callerNumber: bodyCallerNumber, callerIdProfileId } = req.body;

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

  // ── ESL pre-flight: block immediately if FreeSWITCH is unreachable ─────────
  // Without this, the call is saved as "initiated", the 20 s watchdog fires,
  // and it writes a failed record — leading to the "109 call errors" pile-up.
  // Only block when ESL is explicitly enabled (FREESWITCH_DOMAIN is set) and
  // currently disconnected.  If ESL is not configured at all, proceed normally.
  const esl = eslStatus();
  if (esl.enabled && !esl.connected) {
    logger.warn(
      { userId, recipientNumber, eslReconnectAttempt: esl.reconnectAttempt },
      "[Calls] Rejecting call — FreeSWITCH ESL offline",
    );
    res.status(503).json({
      error:   "FreeSWITCH unavailable",
      message: "The call system is temporarily offline. Please try again in a few seconds.",
      eslOffline: true,
    });
    return;
  }

  if (user.locked) {
    res.status(403).json({
      error:   "Account locked",
      message: "Your account has been locked. Please contact support.",
    });
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
  // For internal (extension-to-extension) calls, check whether the destination
  // is currently reachable via either the Verto (WebRTC/browser) or SIP (mobile)
  // session maps.  isExtensionOnline() now covers both protocols.
  //
  // IMPORTANT: This is a soft check — we warn but do NOT block for one reason:
  //   The session map is empty right after a server restart (extensions may be
  //   connected but not yet tracked because no login/REGISTER has been seen
  //   since the restart).  Hard blocking is deferred until the map is warm.
  if (callType === "internal" && resolvedExtension) {
    const sessionCount = getTotalSessionCount();
    const online = isExtensionOnline(resolvedExtension);
    if (sessionCount > 0 && !online) {
      logger.warn(
        { extension: resolvedExtension, sessionCount },
        "[Calls] Destination extension not in active sessions (Verto + SIP checked) — " +
        "may be offline or between registrations. " +
        "Push wakeup sent; 20 s INITIATED timeout is the fallback.",
      );
    } else {
      logger.info(
        { extension: resolvedExtension, online, sessionCount },
        "[Calls] Pre-call extension session check (Verto + SIP)",
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
  // history shows the correct "from" party.  Sanitize to digits, "+", and
  // basic punctuation only — never trust arbitrary user-supplied strings.
  // For outbound, use the server-side verified mobile number only.
  const sanitizedBodyCallerNumber =
    direction === "inbound" && bodyCallerNumber
      ? String(bodyCallerNumber).replace(/[^\d+\-() ]/g, "").slice(0, 30) || undefined
      : undefined;
  const callerNumber = sanitizedBodyCallerNumber ?? (user.phone ?? undefined);
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

  // ── Automatic caller ID selection ────────────────────────────────────────
  // Resolve the correct outbound caller ID server-side (anti-spoofing).
  // This is non-blocking: if selection fails the call proceeds with the
  // legacy behaviour (callerNumber from user.phone) so existing integrations
  // are not broken.  The selected values are stored on the call record and
  // injected into FreeSWITCH via uuid_setvar_multi on CHANNEL_CREATE.
  let selectedCallerId: string | undefined;
  let callerIdName:     string | undefined;
  let callerIdSource:   string | undefined;

  try {
    const cidSel = await selectCallerId({
      userId,
      destination:       recipientNumber,
      resolvedExtension: resolvedExtension ?? null,
      profileId:         callerIdProfileId ?? null,
      direction:         direction === "inbound" ? "inbound" : "outbound",
    });
    selectedCallerId = cidSel.callerIdNumber || undefined;
    callerIdName     = cidSel.callerIdName   || undefined;
    callerIdSource   = cidSel.callerIdSource;

    // Register the injection so CHANNEL_CREATE fires uuid_setvar_multi
    if (fsCallId && typeof fsCallId === "string" && fsCallId.trim() && selectedCallerId) {
      registerCallerIdInjection(
        fsCallId.trim(),
        selectedCallerId,
        callerIdName ?? "",
        cidSel.callType,
      );
    }
  } catch (cidErr) {
    logger.warn(
      { userId, callId, recipientNumber, err: String(cidErr) },
      "[calls] Caller ID selection failed — proceeding without injection",
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
    selectedCallerId,
    callerIdName,
    callerIdSource,
  });

  // Start the INITIATED-state watchdog so calls that never receive a
  // FreeSWITCH CHANNEL_ORIGINATE or CHANNEL_HANGUP_COMPLETE event are
  // automatically marked failed after 20 s instead of hanging indefinitely.
  if (fsCallId && typeof fsCallId === "string" && fsCallId.trim()) {
    registerInitiatedCall(fsCallId.trim(), callId);
  }

  // Record A-leg lifecycle state so the A-leg manager can track the caller's
  // session, validate source liveness, and arm the disconnect watchdog.
  {
    const callerExtension = typeof (user as any).extension === "number"
      ? (user as any).extension
      : parseInt(String((user as any).extension ?? ""), 10) || undefined;
    const fsCallIdStr = fsCallId && typeof fsCallId === "string" && fsCallId.trim()
      ? fsCallId.trim() : undefined;
    recordALegInit(callId, callerExtension ?? undefined, userId, fsCallIdStr);

    // Pre-flight: validate the caller's session liveness and log the result.
    // This is a soft check — it never blocks the call.
    if (callerExtension != null && callerExtension >= 1000 && callerExtension <= 9999) {
      validateALegSource(callId, callerExtension);
    }
  }

  // Record B-leg lifecycle state for internal calls so pre-originate validation,
  // recovery orchestration, and admin observability can track this call.
  if (callType === "internal" && resolvedExtension) {
    const calleeUserId = String((await (async () => {
      try {
        const { connectDB: cdb, UserModel: UM } = await import("@workspace/db");
        await cdb();
        const u = await UM.findOne({ extension: resolvedExtension }).select("_id").lean();
        return u?._id ?? "";
      } catch { return ""; }
    })()));
    recordBLegInit(callId, resolvedExtension, calleeUserId || undefined);
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
          type:          "call_wakeup",
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
          Promise.all(tasks).catch((err) => {
            logger.warn({ err, resolvedExtension }, "[calls] One or more callee push notifications failed");
          });
          calleeNotified = true;
          recordWakeupSent(callId);
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

/**
 * GET /api/calls/active
 * Returns all non-terminal calls for the authenticated user.
 * Used by the frontend on reconnect to rehydrate call state without
 * losing an in-progress call when the page refreshes or WebSocket drops.
 */
/**
 * GET /api/calls/:callId/callee-ready?extension=NNNN[&timeout=12000]
 *
 * Long-poll endpoint the caller client uses after receiving `calleeNotified:true`
 * from POST /api/calls.  Blocks until the callee's extension appears in the
 * Verto or SIP session maps, or until the timeout expires.
 *
 * The client should call this before sending `verto.invite` to FreeSWITCH so
 * that the callee's device has had time to wake up and re-register.
 *
 * Max timeout: 15 s (enforced server-side).
 *
 * Response
 *   { ready: true,  transport: "verto"|"sip", elapsedMs: N }  — callee registered
 *   { ready: false, transport: null, elapsedMs: N, reason: "timeout"|"call_terminal" }
 */
router.get("/calls/:callId/callee-ready", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { callId } = req.params;
  const extensionStr = String(req.query.extension ?? "").trim();
  const rawTimeout   = parseInt(String(req.query.timeout ?? "12000"), 10);
  const timeoutMs    = Math.min(15_000, Math.max(1_000, Number.isFinite(rawTimeout) ? rawTimeout : 12_000));

  if (!/^[1-9]\d{3}$/.test(extensionStr)) {
    res.status(400).json({ error: "extension query param required (4-digit extension)" });
    return;
  }

  const extension = parseInt(extensionStr, 10);
  const userId    = (req as any).user.id as string;

  await connectDB();

  // Verify the call belongs to this user and is still active
  const call = await CallModel.findOne({ _id: callId, userId }).select("status").lean();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  const TERMINAL = ["completed", "failed", "missed", "cancelled"];
  if (TERMINAL.includes(call.status)) {
    res.json({ ready: false, transport: null, elapsedMs: 0, reason: "call_terminal", status: call.status });
    return;
  }

  logger.info(
    { callId, extension, timeoutMs, userId },
    "[calls] callee-ready: waiting for registration",
  );

  const result = await waitForRegistration(extension, timeoutMs);

  logger.info(
    { callId, extension, registered: result.registered, transport: result.transport, elapsedMs: result.elapsedMs },
    "[calls] callee-ready: result",
  );

  res.json({
    ready:     result.registered,
    transport: result.transport,
    elapsedMs: result.elapsedMs,
    ...(result.registered ? {} : { reason: "timeout" }),
  });
});

/**
 * GET /api/calls/:callId/bleg-diagnostics
 *
 * Returns the in-memory B-leg lifecycle state for a call.
 * Includes pre-originate validation result, recovery attempt count,
 * originate confirmation timestamp, and current live session status.
 * Authenticated to the call owner only (admin uses /admin/calls/:id/bleg).
 */
router.get("/calls/:callId/bleg-diagnostics", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await connectDB();
  const userId = (req as any).user.id as string;
  const { callId } = req.params;

  const call = await CallModel.findOne({ _id: callId, userId }).select("status").lean();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  const diag = getBLegDiagnostics(callId);
  if (!diag) {
    res.json({ available: false, reason: "State not found — call may have ended or server restarted" });
    return;
  }

  res.json({ available: true, ...diag });
});

/**
 * GET /api/calls/:callId/aleg-diagnostics
 *
 * Returns the in-memory A-leg lifecycle state for a call.
 * Includes pre-flight validation result, transport detection, FS UUID,
 * disconnect watchdog status, and current live session liveness.
 * Authenticated to the call owner only (admin uses admin routes for full view).
 */
router.get("/calls/:callId/aleg-diagnostics", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await connectDB();
  const userId = (req as any).user.id as string;
  const { callId } = req.params;

  const call = await CallModel.findOne({ _id: callId, userId }).select("status").lean();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  const diag = getALegDiagnostics(callId);
  if (!diag) {
    res.json({ available: false, reason: "State not found — call may have ended or server restarted" });
    return;
  }

  res.json({ available: true, ...diag });
});

router.get("/calls/active", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await connectDB();
  const userId = (req as any).user.id;

  const ACTIVE_STATUSES = ["initiated", "ringing", "answered", "bridged", "early_media"];
  const activeCalls = await CallModel.find({
    userId,
    status: { $in: ACTIVE_STATUSES },
    endedAt: null,
  })
    .sort({ startedAt: -1 })
    .lean();

  res.json({
    calls: activeCalls.map((c: any) => ({ ...c, id: c._id })),
    count: activeCalls.length,
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

  // Validate status against the allowed set so a malformed client payload
  // can't write an arbitrary string into the call record.
  const ALLOWED_END_STATUSES = ["completed", "missed", "failed", "rejected", "cancelled"];
  if (status !== undefined && (typeof status !== "string" || !ALLOWED_END_STATUSES.includes(status))) {
    res.status(400).json({ error: `Invalid status — must be one of: ${ALLOWED_END_STATUSES.join(", ")}` });
    return;
  }

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

/**
 * POST /api/calls/:callId/transfer
 *
 * Transfer an active call to another extension or bridge two calls together.
 *
 * Blind transfer  (type="blind", target="NNNN" or "+27xxx"):
 *   FreeSWITCH uuid_transfer moves the A-leg to a new dialplan destination.
 *   Loop guard: target cannot equal the caller's own extension.
 *
 * Attended transfer (type="attended", targetCallId="<uuid>"):
 *   FreeSWITCH uuid_bridge connects two existing active channels directly.
 *   Both calls must belong to the authenticated user.
 */
router.post("/calls/:callId/transfer", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = (req as any).user.id as string;
  const { callId } = req.params;
  const {
    type         = "blind",
    target,
    targetCallId,
  } = req.body as { type?: string; target?: string; targetCallId?: string };

  if (!["blind", "attended"].includes(String(type))) {
    res.status(400).json({ error: "type must be 'blind' or 'attended'" });
    return;
  }

  await connectDB();
  const call = await CallModel.findOne({ _id: callId, userId })
    .select("fsCallId status")
    .lean();

  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  const ACTIVE_STATUSES = ["ringing", "early_media", "answered", "bridged"];
  if (!ACTIVE_STATUSES.includes(call.status)) {
    res.status(400).json({ error: `Call is in '${call.status}' state — must be active to transfer` });
    return;
  }

  if (!call.fsCallId) {
    res.status(400).json({ error: "Call has no FreeSWITCH UUID yet — cannot transfer" });
    return;
  }

  if (type === "blind") {
    const rawTarget = String(target ?? "").trim();
    if (!rawTarget) {
      res.status(400).json({ error: "target is required for blind transfer" });
      return;
    }

    // Loop guard: prevent transferring the call back to the caller's own extension
    const callerUser = await UserModel.findById(userId).select("extension").lean();
    const callerExt  = String((callerUser as any)?.extension ?? "");
    if (callerExt && rawTarget === callerExt) {
      res.status(400).json({ error: "Cannot transfer a call to your own extension" });
      return;
    }

    const isExt   = /^[1-9]\d{3}$/.test(rawTarget);
    const isPhone = /^\+?[1-9]\d{6,14}$/.test(rawTarget);
    if (!isExt && !isPhone) {
      res.status(400).json({
        error: "target must be a 4-digit internal extension or a valid phone number",
      });
      return;
    }

    const result  = await sendEslBgapiAwait(
      `uuid_transfer ${call.fsCallId} ${rawTarget} XML prawwplus`,
      8_000,
    );
    const success = result.startsWith("+OK");

    logger.info(
      { callId, fsCallId: call.fsCallId, target: rawTarget, result },
      "[Calls] Blind transfer",
    );

    if (!success) {
      res.status(502).json({ error: "Transfer failed", detail: result });
      return;
    }
    res.json({ success: true, type: "blind", target: rawTarget });
    return;
  }

  // Attended transfer: bridge two active legs via uuid_bridge
  if (!targetCallId) {
    res.status(400).json({ error: "targetCallId is required for attended transfer" });
    return;
  }

  if (targetCallId === callId) {
    res.status(400).json({ error: "Cannot bridge a call to itself" });
    return;
  }

  const targetCall = await CallModel.findOne({ _id: targetCallId, userId })
    .select("fsCallId status")
    .lean();

  if (!targetCall) {
    res.status(404).json({ error: "Target call not found" });
    return;
  }

  if (!ACTIVE_STATUSES.includes(targetCall.status)) {
    res.status(400).json({ error: "Target call is not active" });
    return;
  }

  if (!targetCall.fsCallId) {
    res.status(400).json({ error: "Target call has no FreeSWITCH UUID yet" });
    return;
  }

  const result  = await sendEslBgapiAwait(
    `uuid_bridge ${call.fsCallId} ${targetCall.fsCallId}`,
    8_000,
  );
  const success = result.startsWith("+OK");

  logger.info({ callId, targetCallId, result }, "[Calls] Attended transfer (uuid_bridge)");

  if (!success) {
    res.status(502).json({ error: "Attended transfer failed", detail: result });
    return;
  }
  res.json({ success: true, type: "attended" });
});

/**
 * POST /api/calls/:callId/hold
 *
 * Place an active call on hold via FreeSWITCH uuid_hold.
 * The caller hears hold music; media from the bridged party is suspended.
 * Only valid for calls in answered/bridged/early_media state.
 */
router.post("/calls/:callId/hold", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId  = (req as any).user.id as string;
  const { callId } = req.params;

  await connectDB();
  const call = await CallModel.findOne({ _id: callId, userId })
    .select("fsCallId status")
    .lean();

  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  const HOLDABLE = ["early_media", "answered", "bridged"];
  if (!HOLDABLE.includes(call.status)) {
    res.status(400).json({
      error: `Call is in '${call.status}' state — must be answered or bridged to hold`,
    });
    return;
  }

  if (!call.fsCallId) {
    res.status(400).json({ error: "Call has no FreeSWITCH UUID yet" });
    return;
  }

  const result  = await sendEslBgapiAwait(`uuid_hold ${call.fsCallId}`, 5_000);
  const success = !result.startsWith("-ERR");

  logger.info({ callId, fsCallId: call.fsCallId, result }, "[Calls] Hold applied");
  res.json({ success, held: true });
});

/**
 * POST /api/calls/:callId/unhold
 *
 * Resume a held call via FreeSWITCH uuid_hold off.
 * Works regardless of current call status — safe to call even if not currently held.
 */
router.post("/calls/:callId/unhold", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId  = (req as any).user.id as string;
  const { callId } = req.params;

  await connectDB();
  const call = await CallModel.findOne({ _id: callId, userId })
    .select("fsCallId status")
    .lean();

  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  if (!call.fsCallId) {
    res.status(400).json({ error: "Call has no FreeSWITCH UUID yet" });
    return;
  }

  const result  = await sendEslBgapiAwait(`uuid_hold off ${call.fsCallId}`, 5_000);
  const success = !result.startsWith("-ERR");

  logger.info({ callId, fsCallId: call.fsCallId, result }, "[Calls] Unhold applied");
  res.json({ success, held: false });
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
