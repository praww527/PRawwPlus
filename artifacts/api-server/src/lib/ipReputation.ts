/**
 * ipReputation — in-memory IP block list with DB persistence and auto-blocking.
 *
 * Tracks per-IP request rates. Automatically blocks IPs that exceed:
 *  - SIP_FLOOD_THRESHOLD REGISTER events/minute
 *  - LOGIN_FLOOD_THRESHOLD failed logins/minute
 *
 * Block list is persisted to the SystemConfig.blockedIps array in MongoDB
 * so it survives server restarts.
 *
 * Usage:
 *   ipReputation.isBlocked(ip)       — check before handling request
 *   ipReputation.recordEvent(ip, type) — increment counter
 *   ipReputation.block(ip, reason, durationMs?) — manual block
 *   ipReputation.unblock(ip)         — manual unblock
 */

import { logger } from "./logger";

const SIP_FLOOD_THRESHOLD   = 100; // REGISTER events/min
const LOGIN_FLOOD_THRESHOLD = 20;  // failed logins/min
const WINDOW_MS             = 60_000;
const AUTO_BLOCK_DURATION   = 30 * 60_000; // 30 minutes

type EventType = "sip_register" | "login_fail" | "verto_invite";

interface IpCounter {
  counts: Map<EventType, number>;
  windowStart: number;
}

interface BlockEntry {
  reason: string;
  blockedAt: number;
  expiresAt: number | null;
  auto: boolean;
}

class IpReputationStore {
  private blocked = new Map<string, BlockEntry>();
  private counters = new Map<string, IpCounter>();

  isBlocked(ip: string): boolean {
    const entry = this.blocked.get(ip);
    if (!entry) return false;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.blocked.delete(ip);
      return false;
    }
    return true;
  }

  block(ip: string, reason: string, durationMs?: number, auto = false): void {
    this.blocked.set(ip, {
      reason,
      blockedAt: Date.now(),
      expiresAt: durationMs ? Date.now() + durationMs : null,
      auto,
    });
    logger.warn({ ip, reason, auto }, "[IpReputation] IP blocked");
    this.syncToDb().catch(() => {});
  }

  unblock(ip: string): boolean {
    const had = this.blocked.has(ip);
    this.blocked.delete(ip);
    if (had) this.syncToDb().catch(() => {});
    return had;
  }

  recordEvent(ip: string, type: EventType): void {
    const now = Date.now();
    let counter = this.counters.get(ip);

    if (!counter || now - counter.windowStart > WINDOW_MS) {
      counter = { counts: new Map(), windowStart: now };
      this.counters.set(ip, counter);
    }

    const prev = counter.counts.get(type) ?? 0;
    counter.counts.set(type, prev + 1);

    // Auto-block on flood
    if (type === "sip_register" && (prev + 1) > SIP_FLOOD_THRESHOLD) {
      if (!this.isBlocked(ip)) {
        this.block(ip, "SIP REGISTER flood", AUTO_BLOCK_DURATION, true);
      }
    }
    if (type === "login_fail" && (prev + 1) > LOGIN_FLOOD_THRESHOLD) {
      if (!this.isBlocked(ip)) {
        this.block(ip, "Login brute-force", AUTO_BLOCK_DURATION, true);
      }
    }
  }

  getAll(): Array<{ ip: string } & BlockEntry> {
    const now = Date.now();
    const results: Array<{ ip: string } & BlockEntry> = [];
    for (const [ip, entry] of this.blocked.entries()) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.blocked.delete(ip);
        continue;
      }
      results.push({ ip, ...entry });
    }
    return results.sort((a, b) => b.blockedAt - a.blockedAt);
  }

  getRates(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const [ip, counter] of this.counters.entries()) {
      const obj: Record<string, number> = {};
      counter.counts.forEach((v, k) => { obj[k] = v; });
      out[ip] = obj;
    }
    return out;
  }

  /** Load persisted blocks from SystemConfig.blockedIps */
  async loadFromDb(): Promise<void> {
    try {
      const { connectDB, SystemConfigModel } = await import("@workspace/db");
      await connectDB();
      const config = await SystemConfigModel.findById("singleton").lean();
      const ips: Array<{ ip: string; reason: string; expiresAt?: number }> =
        (config as any)?.blockedIps ?? [];
      const now = Date.now();
      for (const entry of ips) {
        if (entry.expiresAt && now > entry.expiresAt) continue;
        this.blocked.set(entry.ip, {
          reason: entry.reason,
          blockedAt: now,
          expiresAt: entry.expiresAt ?? null,
          auto: false,
        });
      }
      logger.info({ count: this.blocked.size }, "[IpReputation] Loaded persisted blocks");
    } catch { /* DB not available on startup */ }
  }

  private async syncToDb(): Promise<void> {
    try {
      const { connectDB, SystemConfigModel } = await import("@workspace/db");
      await connectDB();
      const entries = this.getAll().map(({ ip, reason, expiresAt }) => ({ ip, reason, expiresAt }));
      await SystemConfigModel.findByIdAndUpdate(
        "singleton",
        { $set: { blockedIps: entries } },
        { upsert: true },
      );
    } catch { /* best-effort */ }
  }
}

export const ipReputation = new IpReputationStore();
