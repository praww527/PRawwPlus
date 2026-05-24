/**
 * In-memory Verto/SIP session tracker.
 *
 * The Verto proxy parses the JSON-RPC login message from each browser client
 * and registers the extension → sessId mapping here.  The calls route reads
 * this map to detect whether a destination extension is currently connected
 * before creating a call record, enabling an early USER_NOT_REGISTERED response
 * instead of waiting for the 20-second INITIATED timeout.
 *
 * This is intentionally an in-memory map — it does NOT persist across restarts.
 * After a server restart the map is empty and all registration decisions fall
 * back to the ESL `show registrations` check or the existing INITIATED timeout.
 */

export interface VertoSession {
  extension:      number;
  userId?:        string;
  sessId:         string;
  connectedAt:    number;
  lastPingAt:     number;
  reconnectCount: number;
}

const sessions = new Map<number, VertoSession>();

export function registerVertoSession(session: VertoSession): void {
  const prev = sessions.get(session.extension);
  if (prev && prev.sessId !== session.sessId) {
    sessions.set(session.extension, { ...session, reconnectCount: prev.reconnectCount + 1 });
  } else {
    sessions.set(session.extension, session);
  }
}

export function unregisterVertoSession(extension: number, sessId?: string): void {
  const existing = sessions.get(extension);
  if (!existing) return;
  if (sessId && existing.sessId !== sessId) return;
  sessions.delete(extension);
}

export function touchVertoSession(extension: number): void {
  const s = sessions.get(extension);
  if (s) s.lastPingAt = Date.now();
}

export function getVertoSession(extension: number): VertoSession | null {
  return sessions.get(extension) ?? null;
}

/**
 * Returns true if the extension has an active session that pinged within
 * the last `maxAgeMs` milliseconds (default 45 s — 3× the 15 s heartbeat).
 */
export function isExtensionOnline(extension: number, maxAgeMs = 45_000): boolean {
  const s = sessions.get(extension);
  if (!s) return false;
  return Date.now() - s.lastPingAt < maxAgeMs;
}

export function getAllSessions(): VertoSession[] {
  return Array.from(sessions.values());
}

export function getSessionCount(): number {
  return sessions.size;
}
