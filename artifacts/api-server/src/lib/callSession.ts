/**
 * In-memory Verto/SIP session tracker.
 *
 * Verto (WebRTC/browser) sessions are tracked by the Verto proxy which parses
 * each JSON-RPC login message and calls registerVertoSession here.
 *
 * SIP (JsSIP/mobile) sessions are tracked via two complementary mechanisms:
 *   1. SIP proxy: parses SIP REGISTER / 200 OK messages as they transit the proxy.
 *   2. FreeSWITCH ESL: sofia::register / sofia::unregister / sofia::expire events
 *      provide ground-truth confirmation directly from FreeSWITCH.
 * Both sources call registerSipSession / unregisterSipSession here.
 *
 * isExtensionOnline() checks BOTH maps so a call is considered routable if the
 * user is reachable via either WebRTC (browser) or SIP (mobile).
 *
 * This is intentionally in-memory — it does NOT persist across server restarts.
 * After a restart the maps are empty and routing decisions fall back to the ESL
 * `show registrations` check and the existing INITIATED-timeout watchdog.
 */

// ── Verto (WebRTC/browser) sessions ──────────────────────────────────────────

export interface VertoSession {
  extension:      number;
  userId?:        string;
  sessId:         string;
  connectedAt:    number;
  lastPingAt:     number;
  reconnectCount: number;
}

const vertoSessions = new Map<number, VertoSession>();

export function registerVertoSession(session: VertoSession): void {
  const prev = vertoSessions.get(session.extension);
  if (prev && prev.sessId !== session.sessId) {
    vertoSessions.set(session.extension, { ...session, reconnectCount: prev.reconnectCount + 1 });
  } else {
    vertoSessions.set(session.extension, session);
  }
}

export function unregisterVertoSession(extension: number, sessId?: string): void {
  const existing = vertoSessions.get(extension);
  if (!existing) return;
  if (sessId && existing.sessId !== sessId) return;
  vertoSessions.delete(extension);
}

export function touchVertoSession(extension: number): void {
  const s = vertoSessions.get(extension);
  if (s) s.lastPingAt = Date.now();
}

export function getVertoSession(extension: number): VertoSession | null {
  return vertoSessions.get(extension) ?? null;
}

export function getAllSessions(): VertoSession[] {
  return Array.from(vertoSessions.values());
}

export function getSessionCount(): number {
  return vertoSessions.size;
}

// ── SIP (JsSIP/mobile) sessions ───────────────────────────────────────────────

export interface SipSession {
  extension:    number;
  userId?:      string;
  contact?:     string;   // SIP Contact URI from REGISTER (e.g. sip:1001@ws.client)
  networkIp?:   string;   // Client IP as reported by FreeSWITCH via ESL event
  registeredAt: number;   // Unix ms of last successful registration / refresh
  expiresAt:    number;   // Unix ms when this registration should expire
}

/** Default SIP registration lifetime when no Expires value is available. */
const DEFAULT_SIP_EXPIRES_S = 3600;

const sipSessions = new Map<number, SipSession>();

export function registerSipSession(session: SipSession): void {
  sipSessions.set(session.extension, session);
}

export function unregisterSipSession(extension: number): void {
  sipSessions.delete(extension);
}

/**
 * Refresh the registeredAt timestamp on an existing SIP session.
 * Used on SIP OPTIONS / re-REGISTER without changing the expiry window.
 */
export function touchSipSession(extension: number): void {
  const s = sipSessions.get(extension);
  if (s) s.registeredAt = Date.now();
}

export function getSipSession(extension: number): SipSession | null {
  return sipSessions.get(extension) ?? null;
}

export function getAllSipSessions(): SipSession[] {
  return Array.from(sipSessions.values());
}

export function getSipSessionCount(): number {
  return sipSessions.size;
}

export function getTotalSessionCount(): number {
  return vertoSessions.size + sipSessions.size;
}

/**
 * Factory helper that builds a SipSession with a computed expiresAt.
 * Callers pass raw values; this centralises the expiry calculation.
 */
export function buildSipSession(
  extension: number,
  opts?: {
    contact?:    string;
    networkIp?:  string;
    userId?:     string;
    expiresSec?: number;
  },
): SipSession {
  const expiresSec = Math.max(1, opts?.expiresSec ?? DEFAULT_SIP_EXPIRES_S);
  const now = Date.now();
  return {
    extension,
    contact:      opts?.contact,
    networkIp:    opts?.networkIp,
    userId:       opts?.userId,
    registeredAt: now,
    expiresAt:    now + expiresSec * 1_000,
  };
}

// ── Combined helpers ──────────────────────────────────────────────────────────

/**
 * Returns true when the extension is reachable via Verto (WebRTC) OR SIP (mobile).
 *
 * Verto:  session must have pinged within `maxAgeMs` (default 45 s — 3× the 15 s heartbeat).
 * SIP:    registration must not have expired (expiresAt is in the future).
 */
export function isExtensionOnline(extension: number, maxAgeMs = 45_000): boolean {
  const verto = vertoSessions.get(extension);
  if (verto && Date.now() - verto.lastPingAt < maxAgeMs) return true;

  const sip = sipSessions.get(extension);
  if (sip && sip.expiresAt > Date.now()) return true;

  return false;
}

/**
 * Returns true when a SIP registration exists AND is fresher than `maxAgeMs`.
 * Useful for distinguishing a registration that technically hasn't expired yet
 * but hasn't sent a re-REGISTER recently (which can indicate a dead socket).
 */
export function isSipRegistrationFresh(
  extension: number,
  maxAgeMs  = 30 * 60_000,   // default 30 min — SIP re-registers every ~1 h
): boolean {
  const sip = sipSessions.get(extension);
  if (!sip) return false;
  if (sip.expiresAt <= Date.now()) return false;          // hard-expired
  return Date.now() - sip.registeredAt < maxAgeMs;
}

/**
 * Evicts all SIP sessions whose `expiresAt` timestamp has passed.
 * Called by the session watchdog (every 5 min) and the admin `kick-session` endpoint.
 * Returns the number of stale sessions removed.
 */
export function cleanExpiredSipSessions(): number {
  const now     = Date.now();
  let   removed = 0;
  for (const [ext, sip] of sipSessions) {
    if (sip.expiresAt <= now) {
      sipSessions.delete(ext);
      removed++;
    }
  }
  return removed;
}

/**
 * Force-evict the Verto and SIP sessions for a specific extension.
 * Used by the admin `kick-session` endpoint so a stale session doesn't
 * block a fresh login / re-registration from being recognised.
 * Returns which sessions were removed.
 */
export function evictSessionsForExtension(extension: number): {
  vertoEvicted: boolean;
  sipEvicted:   boolean;
} {
  const vertoEvicted = vertoSessions.has(extension);
  const sipEvicted   = sipSessions.has(extension);
  vertoSessions.delete(extension);
  sipSessions.delete(extension);
  return { vertoEvicted, sipEvicted };
}

/**
 * Returns a rich diagnostics snapshot for a specific extension.
 * Includes Verto session detail, SIP session detail, and derived liveness flags.
 * Used by the admin session-status endpoint and the B-leg observability panel.
 */
export function getExtensionDiagnostics(extension: number): {
  extension:     number;
  online:        boolean;
  verto:         (VertoSession & { pingAgeMs: number; alive: boolean }) | null;
  sip:           (SipSession   & { regAgeMs: number; expiresInMs: number; alive: boolean; expired: boolean }) | null;
  bestTransport: "verto" | "sip" | null;
  asOf:          string;
} {
  const now   = Date.now();
  const verto = vertoSessions.get(extension) ?? null;
  const sip   = sipSessions.get(extension)   ?? null;

  const vertoPingAgeMs = verto ? now - verto.lastPingAt   : 0;
  const vertoAlive     = verto != null && vertoPingAgeMs < 45_000;

  const sipRegAgeMs    = sip ? now - sip.registeredAt     : 0;
  const sipExpiresInMs = sip ? sip.expiresAt - now        : 0;
  const sipAlive       = sip != null && sipExpiresInMs > 0;
  const sipExpired     = sip != null && !sipAlive;

  const online        = vertoAlive || sipAlive;
  const bestTransport = vertoAlive ? "verto" : sipAlive ? "sip" : null;

  return {
    extension,
    online,
    verto: verto
      ? { ...verto, pingAgeMs: vertoPingAgeMs, alive: vertoAlive }
      : null,
    sip: sip
      ? { ...sip, regAgeMs: sipRegAgeMs, expiresInMs: sipExpiresInMs, alive: sipAlive, expired: sipExpired }
      : null,
    bestTransport,
    asOf: new Date(now).toISOString(),
  };
}
