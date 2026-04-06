/**
 * Formal call state machine.
 *
 * States and the only valid transitions between them:
 *
 *   initiated ──────┬──► ringing ──► answered ──► completed
 *                   │               └──────────── failed
 *                   ├──► answered   (ESL CHANNEL_ANSWER without prior CHANNEL_ORIGINATE)
 *                   ├──► missed
 *                   ├──► cancelled
 *                   └──► failed
 *
 *   ringing ─────── ┬──► answered
 *                   ├──► missed
 *                   ├──► cancelled
 *                   └──► failed
 *
 *   answered ───────┬──► completed
 *                   ├──► failed
 *                   ├──► missed     (dialplan answered A-leg for announcement, then NO_ANSWER)
 *                   └──► cancelled  (dialplan answered A-leg for announcement, then USER_BUSY/cancel)
 *
 * Terminal states (completed, missed, cancelled, failed) accept no further
 * transitions so duplicate ESL events / API calls are safely ignored.
 */

export type CallStatus =
  | "initiated"
  | "ringing"
  | "answered"
  | "completed"
  | "failed"
  | "missed"
  | "cancelled";

/** Lookup: which states may a given state advance to */
const TRANSITIONS: Record<CallStatus, ReadonlyArray<CallStatus>> = {
  "initiated": ["ringing", "answered", "missed", "cancelled", "failed"],
  "ringing":   ["answered", "missed", "cancelled", "failed"],
  "answered":  ["completed", "failed", "missed", "cancelled"],
  "completed": [],
  "failed":    [],
  "missed":    [],
  "cancelled": [],
};

/** Terminal statuses — used for Mongo guards and $nin filters */
export const TERMINAL_CALL_STATUSES: ReadonlyArray<CallStatus> = [
  "completed",
  "failed",
  "missed",
  "cancelled",
];

/** Map FreeSWITCH hangup causes to a final CallStatus */
export function causeToStatus(cause: string): CallStatus {
  switch (cause) {
    case "NO_ANSWER":
    case "RECOVERY_ON_TIMER_EXPIRE":
    case "RECOVERY_ON_TIMER_EXPIRY":
      return "missed";

    case "ORIGINATOR_CANCEL":
    case "USER_BUSY":
    case "CALL_REJECTED":
    case "LOSE_RACE":
      return "cancelled";

    case "NORMAL_CLEARING":
    case "ALLOTTED_TIMEOUT":
    case "NORMAL_UNSPECIFIED":
    case "ATTENDED_TRANSFER":
      return "completed";

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
  const normalizedFrom =
    from === "in-progress" || from === "in_progress" ? "answered" : from;
  const allowed = TRANSITIONS[normalizedFrom as CallStatus];
  if (!allowed) {
    // Unknown / corrupt state — do not allow arbitrary transitions (billing safety)
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
