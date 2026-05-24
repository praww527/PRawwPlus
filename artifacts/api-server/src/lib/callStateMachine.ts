/**
 * Formal call state machine.
 *
 * States and the only valid transitions between them:
 *
 *   initiated ──────┬──► ringing ──► early_media ──► answered ──► bridged ──► ended
 *                   │               └─────────────────────────────────────── failed
 *                   ├──► answered   (ESL CHANNEL_ANSWER without prior CHANNEL_ORIGINATE)
 *                   ├──► missed
 *                   ├──► cancelled
 *                   └──► failed
 *
 *   ringing ─────── ┬──► early_media (CHANNEL_PROGRESS_MEDIA / SIP 183)
 *                   ├──► answered
 *                   ├──► missed
 *                   ├──► cancelled
 *                   ├──► rejected
 *                   ├──► voicemail
 *                   └──► failed
 *
 *   early_media ────┬──► answered
 *                   ├──► missed / cancelled / rejected / voicemail / failed / ended
 *
 *   answered ───────┬──► bridged   (CHANNEL_BRIDGE — true two-way audio)
 *                   ├──► ended     (normal completion)
 *                   ├──► completed (backward-compat alias for ended)
 *                   ├──► voicemail (went to voicemail — ATTENDED_TRANSFER)
 *                   ├──► failed
 *                   ├──► missed
 *                   └──► cancelled
 *
 *   bridged ────────┬──► ended / completed / failed / voicemail
 *
 * Terminal states accept no further transitions so duplicate ESL events / API
 * calls are safely ignored.
 *
 * Backward compatibility: "completed" and "cancelled" are kept as valid targets
 * for the webhook/REST path so existing records and clients are not broken.
 * New code should prefer "ended" (normal completion) and "rejected" (callee declined).
 */

export type CallStatus =
  | "initiated"
  | "ringing"
  | "early_media"   // SIP 183 / CHANNEL_PROGRESS_MEDIA received
  | "answered"      // CHANNEL_ANSWER fired — media flowing
  | "bridged"       // CHANNEL_BRIDGE fired — two-way audio confirmed
  | "voicemail"     // call went to voicemail (ATTENDED_TRANSFER hangup cause)
  | "missed"        // callee did not answer within timeout
  | "failed"        // network / registration error
  | "rejected"      // callee explicitly declined or USER_BUSY
  | "ended"         // normal call completion (preferred over "completed")
  | "cancelled"     // caller cancelled before answer (kept for backward compat)
  | "completed";    // kept for backward compat — treated identical to "ended"

const TERMINAL: ReadonlySet<CallStatus> = new Set([
  "voicemail", "missed", "failed", "rejected", "ended", "cancelled", "completed",
]);

const TRANSITIONS: Record<CallStatus, ReadonlyArray<CallStatus>> = {
  "initiated":   ["ringing", "early_media", "answered", "bridged", "missed", "cancelled", "rejected", "failed", "ended", "completed"],
  "ringing":     ["early_media", "answered", "bridged", "missed", "cancelled", "rejected", "voicemail", "failed", "ended", "completed"],
  "early_media": ["answered", "bridged", "missed", "cancelled", "rejected", "voicemail", "failed", "ended", "completed"],
  "answered":    ["bridged", "ended", "completed", "voicemail", "failed", "missed", "cancelled", "rejected"],
  "bridged":     ["ended", "completed", "voicemail", "failed"],
  "voicemail":   [],
  "missed":      [],
  "failed":      [],
  "rejected":    [],
  "ended":       [],
  "cancelled":   [],
  "completed":   [],
};

/** Terminal statuses — used for Mongo guards and $nin filters */
export const TERMINAL_CALL_STATUSES: ReadonlyArray<CallStatus> = Array.from(TERMINAL);

/** Map FreeSWITCH hangup causes to a final CallStatus */
export function causeToStatus(cause: string): CallStatus {
  switch (cause) {
    case "NO_ANSWER":
    case "RECOVERY_ON_TIMER_EXPIRE":
    case "RECOVERY_ON_TIMER_EXPIRY":
      return "missed";

    case "ORIGINATOR_CANCEL":
      return "cancelled";

    case "USER_BUSY":
    case "CALL_REJECTED":
    case "LOSE_RACE":
      return "rejected";

    case "ATTENDED_TRANSFER":
      return "voicemail";

    case "NORMAL_CLEARING":
    case "NORMAL_UNSPECIFIED":
    case "ALLOTTED_TIMEOUT":
      return "ended";

    case "UNREGISTERED":
    case "USER_NOT_REGISTERED":
    case "SUBSCRIBER_ABSENT":
    case "DESTINATION_OUT_OF_ORDER":
    case "NO_ROUTE_DESTINATION":
    case "UNALLOCATED_NUMBER":
    case "NETWORK_OUT_OF_ORDER":
    case "SERVICE_UNAVAILABLE":
    case "INCOMPATIBLE_DESTINATION":
    case "MANDATORY_IE_MISSING":
    case "BEARERCAPABILITY_NOTIMPL":
    case "CHAN_NOT_IMPLEMENTED":
    case "FACILITY_NOT_IMPLEMENTED":
    case "INVALID_CALL_REFERENCE_VALUE":
    case "MEDIA_TIMEOUT":
    case "GATEWAY_DOWN":
    case "NO_PICKUP":
      return "failed";

    default:
      return "failed";
  }
}

/** Human-readable reason string for a FreeSWITCH hangup cause */
export function causeToLabel(cause: string): string {
  switch (cause) {
    case "USER_BUSY":
      return "Busy";
    case "NO_ANSWER":
    case "RECOVERY_ON_TIMER_EXPIRE":
    case "RECOVERY_ON_TIMER_EXPIRY":
    case "NO_PICKUP":
      return "No answer";
    case "ORIGINATOR_CANCEL":
      return "Cancelled by caller";
    case "CALL_REJECTED":
    case "LOSE_RACE":
      return "Call rejected";
    case "NORMAL_CLEARING":
    case "NORMAL_UNSPECIFIED":
      return "Call ended normally";
    case "ALLOTTED_TIMEOUT":
      return "Insufficient balance";
    case "ATTENDED_TRANSFER":
      return "Went to voicemail";
    case "UNREGISTERED":
    case "USER_NOT_REGISTERED":
      return "Extension not registered";
    case "SUBSCRIBER_ABSENT":
    case "DESTINATION_OUT_OF_ORDER":
    case "GATEWAY_DOWN":
      return "Destination unavailable";
    case "NO_ROUTE_DESTINATION":
    case "UNALLOCATED_NUMBER":
      return "Number does not exist";
    case "NETWORK_OUT_OF_ORDER":
    case "SERVICE_UNAVAILABLE":
    case "MEDIA_TIMEOUT":
      return "Network error";
    default:
      return `Call failed (${cause})`;
  }
}

/**
 * Return true if the transition is permitted, false if the current state is
 * already terminal (idempotent) — the caller should silently skip processing.
 * Throws only when the transition is genuinely invalid (not just terminal).
 */
export function isTransitionAllowed(
  from: string,
  to: CallStatus,
): boolean {
  // Normalise legacy status aliases
  const normalizedFrom =
    from === "in-progress" || from === "in_progress" ? "answered" : from;
  const allowed = TRANSITIONS[normalizedFrom as CallStatus];
  if (!allowed) {
    return false;
  }
  if (allowed.length === 0) {
    // Terminal state — already done, silently skip
    return false;
  }
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid call state transition: "${from}" → "${to}". ` +
      `Allowed: [${allowed.join(", ")}]`,
    );
  }
  return true;
}

/** Return the set of valid next states for a given current state */
export function allowedTransitions(from: CallStatus): ReadonlyArray<CallStatus> {
  return TRANSITIONS[from as CallStatus] ?? [];
}

/** Returns true if the given status string is a terminal state */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status as CallStatus);
}
