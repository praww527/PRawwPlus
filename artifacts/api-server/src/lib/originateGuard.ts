/**
 * Originate guard — pre-flight validation before any FreeSWITCH originate.
 *
 * Validates:
 *   1. Destination is not empty
 *   2. For external calls: destination is a valid E.164 number
 *   3. For internal calls: destination extension is a positive integer
 *   4. Verto session is live and heartbeat is fresh (if session map is populated)
 *   5. Caller endpoint is non-empty
 *
 * Returns a structured result so callers can fail fast with a meaningful error
 * instead of attempting a risky originate that will silently time out.
 */

import { normalizePhoneNumber } from "./phoneNormalize";
import { isExtensionOnline, getSessionCount, getVertoSession } from "./callSession";
import { metrics } from "./metrics";
import { logger } from "./logger";

export interface OriginateGuardInput {
  destination:   string;         // raw destination (phone or extension)
  callType:      "internal" | "external";
  extension?:    number;         // resolved internal extension (if known)
  callerEndpoint?: string;       // bridge string / SIP URI for the caller leg
  fsCallId?:     string;         // channel UUID (for logging)
  userId?:       string;         // for logging
}

export type OriginateGuardResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

/**
 * Run all pre-flight checks. Returns { ok: true } when safe to originate.
 * Never throws — all errors are returned as structured results.
 */
export function checkOriginateGuard(input: OriginateGuardInput): OriginateGuardResult {
  const { destination, callType, extension, callerEndpoint, fsCallId, userId } = input;

  const ctx = { destination, callType, extension, fsCallId, userId };

  // ── 1. Non-empty destination ──────────────────────────────────────────────
  if (!destination || !destination.trim()) {
    logger.warn({ ...ctx }, "[OriginateGuard] Empty destination");
    metrics.failedOriginates++;
    return { ok: false, code: "EMPTY_DESTINATION", message: "Call destination is empty" };
  }

  // ── 2. Non-empty caller endpoint ──────────────────────────────────────────
  if (callerEndpoint !== undefined && !callerEndpoint.trim()) {
    logger.warn({ ...ctx }, "[OriginateGuard] Empty caller endpoint / bridge string");
    metrics.failedOriginates++;
    return { ok: false, code: "EMPTY_ENDPOINT", message: "Caller endpoint is empty — SIP profile may be misconfigured" };
  }

  // ── 3. Type-specific destination validation ────────────────────────────────
  if (callType === "external") {
    const norm = normalizePhoneNumber(destination.trim());
    if (!norm.ok) {
      logger.warn({ ...ctx, normReason: norm.reason }, "[OriginateGuard] Invalid E.164 destination for external call");
      metrics.failedOriginates++;
      return {
        ok: false,
        code: "INVALID_E164",
        message: `Destination "${destination}" is not a valid phone number: ${norm.reason}`,
      };
    }
  } else {
    // Internal call — extension must be a positive integer
    const ext = extension ?? parseInt(destination.trim(), 10);
    if (!Number.isInteger(ext) || ext <= 0) {
      logger.warn({ ...ctx }, "[OriginateGuard] Invalid internal extension");
      metrics.failedOriginates++;
      return {
        ok: false,
        code: "INVALID_EXTENSION",
        message: `Extension "${destination}" is not a valid integer`,
      };
    }
  }

  // ── 4. Verto session liveness check (soft — skipped if map is empty) ───────
  if (callType === "internal" && extension != null) {
    const sessionCount = getSessionCount();
    if (sessionCount > 0) {
      const online = isExtensionOnline(extension);
      const session = getVertoSession(extension);

      if (!online) {
        // Log the detail (last ping age, reconnect count) for diagnostics
        const lastPingAgoMs = session ? Date.now() - session.lastPingAt : null;
        logger.warn(
          { ...ctx, sessionCount, lastPingAgoMs, reconnectCount: session?.reconnectCount ?? 0 },
          "[OriginateGuard] Destination extension is NOT online in Verto session map — " +
          "may be offline, backgrounded, or on SIP/JsSIP. Proceeding with push fallback.",
        );
        // NOTE: we do NOT fail here — the extension may be a SIP/JsSIP client.
        // The INITIATED watchdog is the real safety net.
      } else {
        const session2 = getVertoSession(extension);
        logger.debug(
          { ...ctx, sessId: session2?.sessId, reconnectCount: session2?.reconnectCount ?? 0 },
          "[OriginateGuard] Extension online — session verified",
        );
      }
    }
  }

  logger.debug({ ...ctx }, "[OriginateGuard] Pre-flight passed");
  return { ok: true };
}

/**
 * Strict variant: returns false for internal calls where the extension is
 * definitively known to be offline (session map has entries, but not this one).
 * Used for early rejection on routes that prefer failing fast over push wakeup.
 */
export function isExtensionDefinitelyOffline(extension: number): boolean {
  const sessionCount = getSessionCount();
  if (sessionCount === 0) return false; // map unpopulated — can't know
  return !isExtensionOnline(extension);
}
