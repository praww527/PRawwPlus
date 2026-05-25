/**
 * CNAM (Caller Name) Lookup — Phase 5
 *
 * Resolves a caller's name from a phone number.
 * Uses a configurable provider (default: OpenCNAM or local DB lookup).
 * Results are cached in-memory with a configurable TTL to avoid repeated lookups.
 */

import { logger } from "./logger";
import { connectDB, PhoneNumberModel, UserModel } from "@workspace/db";

interface CnamEntry {
  name:       string;
  source:     "local-db" | "opencnam" | "numverify" | "cache" | "unknown";
  resolvedAt: number;
}

const cache = new Map<string, CnamEntry>();
const CACHE_TTL_MS = parseInt(process.env.CNAM_CACHE_TTL_MS ?? String(24 * 3600 * 1000), 10);

/** Resolve a phone number to a caller name. */
export async function lookupCnam(number: string): Promise<CnamEntry> {
  const normalised = normaliseNumber(number);
  if (!normalised) return { name: number, source: "unknown", resolvedAt: Date.now() };

  const cached = cache.get(normalised);
  if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS) {
    return { ...cached, source: "cache" };
  }

  let entry = await lookupLocalDb(normalised);
  if (!entry) entry = await lookupOpenCnam(normalised);
  if (!entry) entry = { name: formatNumber(normalised), source: "unknown", resolvedAt: Date.now() };

  cache.set(normalised, entry);
  return entry;
}

/** Bulk lookup for an array of numbers. */
export async function bulkLookupCnam(numbers: string[]): Promise<Record<string, CnamEntry>> {
  const results: Record<string, CnamEntry> = {};
  await Promise.all(
    numbers.map(async (n) => {
      results[n] = await lookupCnam(n);
    }),
  );
  return results;
}

/** Override CNAM for a number in our local DB (for owned/hosted numbers). */
export async function setCnamOverride(number: string, name: string): Promise<void> {
  const normalised = normaliseNumber(number);
  if (!normalised) return;

  await connectDB();
  await PhoneNumberModel.findOneAndUpdate(
    { number: normalised },
    { $set: { cnamName: name.trim().slice(0, 15) } },
    { upsert: false },
  );

  const entry: CnamEntry = { name, source: "local-db", resolvedAt: Date.now() };
  cache.set(normalised, entry);
  logger.info({ number: normalised, name }, "[cnam] Override set");
}

export function clearCnamCache(): void {
  cache.clear();
}

export function getCnamCacheStats(): { size: number; oldestMs: number } {
  let oldest = Date.now();
  for (const v of cache.values()) {
    if (v.resolvedAt < oldest) oldest = v.resolvedAt;
  }
  return { size: cache.size, oldestMs: Date.now() - oldest };
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function lookupLocalDb(number: string): Promise<CnamEntry | null> {
  try {
    await connectDB();

    const pn = await PhoneNumberModel.findOne({ number }).select("cnamName userId").lean();
    if (pn && (pn as any).cnamName) {
      return { name: (pn as any).cnamName, source: "local-db", resolvedAt: Date.now() };
    }

    if (pn && (pn as any).userId) {
      const user = await UserModel.findById((pn as any).userId).select("name username").lean();
      const name = (user as any)?.name ?? (user as any)?.username;
      if (name) return { name, source: "local-db", resolvedAt: Date.now() };
    }

    return null;
  } catch (err) {
    logger.debug({ err }, "[cnam] Local DB lookup failed");
    return null;
  }
}

async function lookupOpenCnam(number: string): Promise<CnamEntry | null> {
  const sid    = process.env.OPENCNAM_SID;
  const token  = process.env.OPENCNAM_TOKEN;

  if (!sid || !token) return null;

  try {
    const url = `https://api.opencnam.com/v3/phone/${encodeURIComponent(number)}?account_sid=${sid}&auth_token=${token}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const name = data?.name ?? data?.cnam;
    if (!name || typeof name !== "string") return null;
    return { name: name.trim().slice(0, 30), source: "opencnam", resolvedAt: Date.now() };
  } catch (err) {
    logger.debug({ err }, "[cnam] OpenCNAM lookup failed");
    return null;
  }
}

function normaliseNumber(n: string): string {
  const digits = n.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0") && digits.length === 10) return `+27${digits.slice(1)}`;
  if (digits.startsWith("27") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length >= 7) return `+${digits}`;
  return digits;
}

function formatNumber(n: string): string {
  if (n.startsWith("+27") && n.length === 12) {
    return `0${n.slice(3, 5)} ${n.slice(5, 8)} ${n.slice(8)}`;
  }
  return n;
}
