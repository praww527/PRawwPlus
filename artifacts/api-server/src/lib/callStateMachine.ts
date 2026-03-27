/**
 * Formal call state machine.
 *
 * States and the only valid transitions between them:
 *
 *   initiated ──────┬──► in-progress ──► completed
 *                   ├──► missed              └──► failed
 *                   ├──► cancelled
 *                   └──► failed
 *
 *   in-progress ────┬──► completed
 *                   ├──► failed
 *                   ├──► missed     (dialplan answered A-leg for announcement, then NO_ANSWER)
 *                   └──► cancelled  (dialplan answered A-leg for announcement, then USER_BUSY/cancel)
 *
 * Terminal states (completed, missed, cancelled, failed) accept no further
 * transitions so duplicate ESL events / API calls are safely ignored.
 */

export type CallStatus =
  | "initiated"
  | "in-progress"
  | "completed"
  | "failed"
  | "missed"
  | "cancelled";

/** Lookup: which states may a given state advance to */
const TRANSITIONS: Record<CallStatus, ReadonlyArray<CallStatus>> = {
  "initiated":   ["in-progress", "missed", "cancelled", "failed"],
  "in-progress": ["completed", "failed", "missed", "cancelled"],
  "completed":   [],
  "failed":      [],
  "missed":      [],
  "cancelled":   [],
};

/** Map FreeSWITCH hangup causes to a final CallStatus */
export function causeToStatus(cause: string): CallStatus {
  switch (cause) {
    case "NO_ANSWER":
    case "RECOVERY_ON_TIMER_EXPIRE":
      return "missed";

    case "ORIGINATOR_CANCEL":
    case "USER_BUSY":
    case "CALL_REJECTED":
      return "cancelled";

    case "NORMAL_CLEARING":
    case "ALLOTTED_TIMEOUT":
      return "completed";

    case "UNREGISTERED":
    case "USER_NOT_REGISTERED":
    case "SUBSCRIBER_ABSENT":
    case "DESTINATION_OUT_OF_ORDER":
    case "NO_ROUTE_DESTINATION":
    case "UNALLOCATED_NUMBER":
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
      return "No answer";
    case "ORIGINATOR_CANCEL":
      return "Cancelled by caller";
    case "CALL_REJECTED":
      return "Call rejected";
    case "NORMAL_CLEARING":
      return "Call ended normally";
    case "ALLOTTED_TIMEOUT":
      return "Balance exhausted";
    case "UNREGISTERED":
    case "USER_NOT_REGISTERED":
      return "Extension not registered";
    case "SUBSCRIBER_ABSENT":
    case "DESTINATION_OUT_OF_ORDER":
      return "Destination unavailable";
    case "NO_ROUTE_DESTINATION":
    case "UNALLOCATED_NUMBER":
      return "Number does not exist";
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
  const allowed = TRANSITIONS[from as CallStatus];
  if (!allowed) {
    throw new Error(`Unknown call state "${from}"`);
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
  return TRANSITIONS[from] ?? [];
}
