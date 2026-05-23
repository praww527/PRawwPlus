/**
 * South African phone number normaliser.
 *
 * Accepted inputs (all produce "+27636545019"):
 *   0636545019
 *   636545019
 *   +27636545019
 *   27636545019
 *   063 654 5019 / (063) 654-5019 / etc.
 *
 * Rules applied after stripping whitespace / dashes / brackets / dots:
 *   1. starts with +27  → validate 9 digits follow, keep as-is
 *   2. starts with 27   → prepend +
 *   3. starts with 0    → replace leading 0 with +27
 *   4. exactly 9 digits, no 0/27 prefix → prepend +27
 *   5. anything else    → rejection with reason string
 *
 * The helper is intentionally pure / synchronous so it can be used in any
 * layer — API routes, ESL event handlers, dialplan generation, frontend utils.
 */

export interface NormalizeOk {
  ok: true;
  e164: string;
}

export interface NormalizeErr {
  ok: false;
  reason: string;
}

export type NormalizeResult = NormalizeOk | NormalizeErr;

/**
 * Normalise a raw phone number string to South African E.164 (+27xxxxxxxxx).
 * Returns { ok: true, e164 } on success or { ok: false, reason } on failure.
 */
export function normalizePhoneNumber(raw: string): NormalizeResult {
  if (!raw || typeof raw !== "string") {
    return { ok: false, reason: "Empty input" };
  }

  const hasPlus = raw.trimStart().startsWith("+");
  const stripped = raw.replace(/[\s\-().+]/g, "");
  const digits   = stripped.replace(/\D/g, "");

  let normalized: string;

  if (hasPlus && digits.startsWith("27")) {
    normalized = "+" + digits;
  } else if (!hasPlus && digits.startsWith("27") && digits.length >= 10) {
    normalized = "+" + digits;
  } else if (digits.startsWith("0")) {
    normalized = "+27" + digits.slice(1);
  } else if (digits.length === 9 && !digits.startsWith("0")) {
    normalized = "+27" + digits;
  } else {
    return {
      ok: false,
      reason: `Cannot determine SA number format: raw="${raw}" digits="${digits}"`,
    };
  }

  if (!/^\+27\d{9}$/.test(normalized)) {
    return {
      ok: false,
      reason: `Normalised to "${normalized}" — not a valid +27xxxxxxxxx (need exactly 9 digits after +27)`,
    };
  }

  return { ok: true, e164: normalized };
}

/**
 * Normalise a destination for a SIP bridge string.
 *
 * Logs raw → normalised mapping at INFO level so admins can trace PSTN failures.
 * Falls back to the original string if normalisation fails so the call still
 * proceeds (carrier will reject it naturally if invalid).
 *
 * Usage:
 *   const dest = normalizeForBridge(rawNumber, logger.info.bind(logger));
 *   eslClient.sendApiCommand(`originate sofia/gateway/${gw}/${dest} ...`);
 */
export function normalizeForBridge(
  raw: string,
  logFn: (data: object, msg: string) => void,
): string {
  const result = normalizePhoneNumber(raw);
  logFn(
    {
      rawDestination:        raw,
      normalizedDestination: result.ok ? result.e164 : "(failed — using raw)",
      ok:                    result.ok,
      ...(result.ok ? {} : { reason: (result as NormalizeErr).reason }),
    },
    "[phoneNormalize] SIP bridge destination",
  );
  return result.ok ? result.e164 : raw;
}
