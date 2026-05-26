/**
 * Shared WebSocket proxy buffer utilities.
 * Used by vertoProxy.ts and sipProxy.ts.
 *
 * Provides:
 *   • Timestamped, priority-tagged message buffer with configurable per-client size cap
 *   • TTL-based stale-message eviction (drops stale REGISTER/login packets before replay)
 *   • Priority-aware stable sort for auth-first replay ordering
 *     (guarantees: login → verto.attach, REGISTER → INVITE)
 *   • Reconnect storm protection (global cap on concurrent upstream reconnects)
 *   • Structured upstream disconnect reason classifier
 */
import type { WebSocket } from "ws";
import { logger } from "./logger";

// ── Buffer types ──────────────────────────────────────────────────────────────

export interface BufferedMessage {
  data:       Parameters<WebSocket["send"]>[0];
  isBinary:   boolean;
  enqueuedAt: number;
  /**
   * Replay-ordering priority:
   *   1 = auth message (login / REGISTER) — flushed first so FreeSWITCH has an
   *       authenticated session before any INVITE / verto.attach arrives.
   *   0 = normal message (sent after auth confirmation).
   */
  priority: 0 | 1;
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface ProxyBufferConfig {
  /** Max messages per client before oldest non-priority messages are evicted. */
  limit: number;
  /** Max age (ms) a buffered message may have; older ones are dropped on flush. */
  ttlMs: number;
}

export function readProxyBufferConfig(protocol: "verto" | "sip"): ProxyBufferConfig {
  const pfx   = protocol.toUpperCase();
  const limit = parseInt(
    process.env[`PROXY_BUFFER_LIMIT_${pfx}`] ?? process.env.PROXY_BUFFER_LIMIT ?? "50",
    10,
  );
  const ttlMs = parseInt(
    process.env[`PROXY_BUFFER_TTL_MS_${pfx}`] ?? process.env.PROXY_BUFFER_TTL_MS ?? "30000",
    10,
  );
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
    ttlMs: Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 30_000,
  };
}

// ── Buffer helpers ─────────────────────────────────────────────────────────────

/**
 * Enqueue a message.
 * If the buffer is at capacity, evict the oldest non-priority message first;
 * if all are priority, evict the oldest overall.
 * Returns "enqueued" or "dropped_overflow".
 */
export function enqueueMessage(
  queue: BufferedMessage[],
  entry: Omit<BufferedMessage, "enqueuedAt">,
  limit: number,
): "enqueued" | "dropped_overflow" {
  if (queue.length < limit) {
    queue.push({ ...entry, enqueuedAt: Date.now() });
    return "enqueued";
  }
  const evict = queue.findIndex((m) => m.priority === 0);
  queue.splice(evict !== -1 ? evict : 0, 1);
  queue.push({ ...entry, enqueuedAt: Date.now() });
  return "dropped_overflow";
}

/**
 * Remove messages older than ttlMs in-place.
 * Returns the number of messages dropped.
 */
export function evictStaleMessages(
  queue:    BufferedMessage[],
  ttlMs:    number,
  protocol: string,
): number {
  const now = Date.now();
  let dropped = 0;
  let i = 0;
  while (i < queue.length) {
    if (now - queue[i].enqueuedAt > ttlMs) {
      queue.splice(i, 1);
      dropped++;
    } else {
      i++;
    }
  }
  if (dropped > 0) {
    logger.warn({ dropped, ttlMs, protocol }, "[ProxyBuf] Evicted stale buffered messages (TTL expired)");
  }
  return dropped;
}

/**
 * Stable-sort the buffer so priority=1 (auth) messages come first.
 * Within the same priority tier, original insertion order is preserved.
 * V8's Array.prototype.sort has been stable since Node 11.
 */
export function sortBufferForReplay(queue: BufferedMessage[]): void {
  queue.sort((a, b) => b.priority - a.priority);
}

// ── Reconnect storm protection ─────────────────────────────────────────────────

const MAX_CONCURRENT_RECONNECTS = Math.max(
  1,
  parseInt(process.env.PROXY_MAX_CONCURRENT_RECONNECTS ?? "10", 10) || 10,
);

let _activeReconnectsVerto = 0;
let _activeReconnectsSip   = 0;

/**
 * Attempt to reserve a reconnect slot.
 * Returns false when the global cap is already saturated (storm guard).
 * Callers should apply extra jitter before retrying when this returns false.
 */
export function acquireReconnectSlot(protocol: "verto" | "sip"): boolean {
  const cur = protocol === "verto" ? _activeReconnectsVerto : _activeReconnectsSip;
  if (cur >= MAX_CONCURRENT_RECONNECTS) {
    logger.warn(
      { protocol, active: cur, max: MAX_CONCURRENT_RECONNECTS },
      "[ProxyBuf] Reconnect storm guard: slot unavailable — extra jitter will be applied",
    );
    return false;
  }
  if (protocol === "verto") _activeReconnectsVerto++;
  else                      _activeReconnectsSip++;
  return true;
}

/** Release a reconnect slot after the attempt completes (open, error, or retries-exhausted). */
export function releaseReconnectSlot(protocol: "verto" | "sip"): void {
  if (protocol === "verto") {
    _activeReconnectsVerto = Math.max(0, _activeReconnectsVerto - 1);
  } else {
    _activeReconnectsSip = Math.max(0, _activeReconnectsSip - 1);
  }
}

export function getActiveReconnectCount(protocol: "verto" | "sip"): number {
  return protocol === "verto" ? _activeReconnectsVerto : _activeReconnectsSip;
}

// ── Disconnect reason classifier ──────────────────────────────────────────────

export type DisconnectReason =
  | "freeswitch_restart"  // ECONNREFUSED — FS process down / restarting
  | "network_loss"        // ECONNRESET / ETIMEDOUT / code 1006 — path failure
  | "auth_rejection"      // code 1008 / FS refused login
  | "upstream_timeout"    // no data within deadline (code 1001 + ETIMEDOUT)
  | "normal_close"        // clean code 1000 / 1001 from FS
  | "unknown";

export function classifyDisconnectReason(
  code:   number,
  reason: string,
  err?:   Error,
): DisconnectReason {
  const em = err?.message ?? "";
  const rl = reason.toLowerCase();

  if (code === 1008 || rl.includes("auth") || rl.includes("unauthorized") || rl.includes("forbidden")) {
    return "auth_rejection";
  }
  if (em.includes("ECONNREFUSED") || em.includes("ENOENT") || rl.includes("restart")) {
    return "freeswitch_restart";
  }
  if (em.includes("ETIMEDOUT") || rl.includes("timeout")) {
    return "upstream_timeout";
  }
  if (
    code === 1006 ||
    em.includes("ECONNRESET") ||
    em.includes("EPIPE") ||
    em.includes("ENETUNREACH")
  ) {
    return "network_loss";
  }
  if (code === 1000 || code === 1001) return "normal_close";
  return "unknown";
}
