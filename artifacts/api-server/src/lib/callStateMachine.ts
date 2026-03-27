/**
 * Formal call state machine.
 *
 * States and the only valid transitions between them:
 *
 *   initiated ──────┬──► in-progress ──► completed
 *                   ├──► missed
 *                   ├──► cancelled
 *                   └──► failed
 *
 *   in-progress ────┬──► completed
 *                   └──► failed
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
  "in-progress": ["completed", "failed"],
  "completed":   [],
  "failed":      [],
  "missed":      [],
  "cancelled":   [],
};

/** Map FreeSWITCH hangup causes to a final CallStatus */
export function causeToStatus(cause: string): CallStatus {
  switch (cause) {
    case "NO_ANSWER":
      return "missed";
    case "ORIGINATOR_CANCEL":
    case "USER_BUSY":
    case "CALL_REJECTED":
      return "cancelled";
    case "NORMAL_CLEARING":
    case "ALLOTTED_TIMEOUT":
      return "completed";
    default:
      return "failed";
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
