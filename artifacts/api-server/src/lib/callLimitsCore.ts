/** Pure helpers + env parsing — safe to unit-test without loading @workspace/db */

/** FreeSWITCH / Verto use standard UUID strings for channel IDs */
const FS_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidFsCallId(value: unknown): value is string {
  return typeof value === "string" && FS_UUID_RE.test(value.trim());
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Max simultaneous non-terminal calls per user (0 = unlimited) */
export function maxConcurrentCallsPerUser(): number {
  return parsePositiveInt(process.env.MAX_CONCURRENT_CALLS_PER_USER, 4);
}

/** Max coins recorded against external calls per user per UTC day (0 = disabled) */
export function maxCoinsSpendPerDay(): number {
  return parsePositiveInt(process.env.MAX_COINS_SPEND_PER_DAY, 0);
}

/**
 * When true, external `POST /calls` must include a valid UUID `fsCallId` (Verto / aligned clients).
 * Default false so JsSIP-only mobile builds are not blocked until FS correlates channel UUID.
 */
export function requireFsCallIdForExternal(): boolean {
  return process.env.REQUIRE_FS_CALL_ID_EXTERNAL === "true";
}
