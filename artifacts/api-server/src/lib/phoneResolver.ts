import { UserModel, PhoneNumberModel, CallQueueModel, RingGroupModel } from "@workspace/db";
import { assignExtensionIfNeeded } from "./extension";
import { logger } from "./logger";

function normalizePhoneForLookup(raw: string): string[] {
  if (!raw || typeof raw !== "string") return [];
  const digits = raw.replace(/\D/g, "");
  const candidates: string[] = [];

  if (raw.startsWith("+")) candidates.push("+" + digits);

  if (digits.startsWith("27") && digits.length === 11) {
    candidates.push("+" + digits);
    candidates.push("+27" + digits.slice(2));
  }

  if (digits.startsWith("0") && digits.length === 10) {
    candidates.push("+27" + digits.slice(1));
  }

  if (digits.length >= 10 && !digits.startsWith("0") && !candidates.includes("+" + digits)) {
    candidates.push("+" + digits);
  }

  return [...new Set(candidates)];
}

/**
 * Resolve a phone number or direct extension to an internal extension.
 * Accepts:
 *   - A 4-digit extension (1000–9999) — returned directly without a DB lookup
 *   - A phone number (E.164 or local format) — looked up against user records
 */
export async function resolvePhoneToExtension(recipientNumber: string): Promise<number | null> {
  if (!recipientNumber || typeof recipientNumber !== "string") return null;

  const trimmed = recipientNumber.trim();

  // Direct extension input (1000–9999) — route internally without phone lookup
  if (/^[1-9][0-9]{3}$/.test(trimmed)) {
    const ext = parseInt(trimmed, 10);
    const user = await UserModel.findOne({ extension: ext }).select("_id extension").lean();
    if (user) return ext;
    return null;
  }

  const candidates = normalizePhoneForLookup(trimmed);
  if (candidates.length === 0) return null;

  const user = await UserModel.findOne({
    phone: { $in: candidates },
  }).sort({ phoneVerified: -1 }).select("_id extension").lean();

  if (!user) return null;

  if (user.extension) return user.extension;

  logger.info(
    { userId: String(user._id), candidates },
    "[phoneResolver] User found by phone but has no extension — provisioning now",
  );
  const ext = await assignExtensionIfNeeded(String(user._id));
  return ext?.extension ?? null;
}

export type DidRouteType = "agent" | "ring_group" | "queue" | "unrouted";

export interface DidRouteResult {
  type: DidRouteType;
  /** For agent: extension number */
  extension?: number;
  /** For ring_group: array of extensions to dial simultaneously or in order */
  extensions?: number[];
  /** For ring_group: strategy */
  strategy?: "ring-all" | "round-robin";
  /** For queue: FreeSWITCH callcenter queue name */
  queueName?: string;
  /** Human-readable name for logging */
  label?: string;
}

/**
 * Resolve an inbound DID number to its configured route.
 *
 * Route types:
 *   agent      → single extension to bridge to
 *   ring_group → list of extensions + strategy (ring-all / round-robin)
 *   queue      → callcenter queue name
 *   unrouted   → no route configured
 */
export async function resolveDIDRoute(didNumber: string): Promise<DidRouteResult> {
  const candidates = normalizePhoneForLookup(didNumber);
  const searchNumbers = candidates.length > 0 ? candidates : [didNumber];

  const phoneRecord = await PhoneNumberModel.findOne({
    number: { $in: searchNumbers },
  }).lean();

  if (!phoneRecord) {
    return { type: "unrouted" };
  }

  const routeType = (phoneRecord as any).routeType ?? "agent";
  const routeTarget = (phoneRecord as any).routeTarget ?? phoneRecord.userId;

  if (routeType === "agent") {
    const targetUserId = routeTarget ?? phoneRecord.userId;
    if (!targetUserId) return { type: "unrouted" };

    const user = await UserModel.findById(targetUserId).select("_id extension name").lean();
    if (!user) return { type: "unrouted" };

    let extension = (user as any).extension as number | undefined;
    if (!extension) {
      const ext = await assignExtensionIfNeeded(String(user._id));
      extension = ext?.extension ?? undefined;
    }
    if (!extension) return { type: "unrouted" };

    return { type: "agent", extension, label: (user as any).name ?? String(user._id) };
  }

  if (routeType === "ring_group") {
    const group = await RingGroupModel.findById(routeTarget).lean();
    if (!group || !group.active) return { type: "unrouted" };

    const members = await UserModel.find({
      _id: { $in: group.members },
    }).select("_id extension").lean();

    const extensions: number[] = [];
    for (const m of members) {
      let ext = (m as any).extension as number | undefined;
      if (!ext) {
        const provisioned = await assignExtensionIfNeeded(String(m._id));
        ext = provisioned?.extension ?? undefined;
      }
      if (ext) extensions.push(ext);
    }

    if (extensions.length === 0) return { type: "unrouted" };

    return {
      type: "ring_group",
      extensions,
      strategy: group.strategy,
      label: group.name,
    };
  }

  if (routeType === "queue") {
    const queue = await CallQueueModel.findById(routeTarget).lean();
    if (!queue || !queue.active) return { type: "unrouted" };

    return {
      type: "queue",
      queueName: queue.name,
      label: queue.name,
    };
  }

  return { type: "unrouted" };
}

/**
 * Get the primary DID number assigned to a user (for outbound caller ID).
 *
 * Source-of-truth resolution order:
 *   1. DID where routeType === "agent" AND routeTarget === userId   (canonical new model)
 *   2. DID where userId === userId (legacy / backward compat)
 *
 * Returns null if the user has no DID assigned.
 */
export async function getUserPrimaryDid(userId: string): Promise<string | null> {
  // 1. Canonical: agent DID explicitly routed to this user
  const canonical = await PhoneNumberModel.findOne({
    routeType: "agent",
    routeTarget: userId,
  })
    .sort({ assignedAt: -1 })
    .select("number")
    .lean();

  if (canonical) return canonical.number;

  // 2. Legacy fallback: userId field set (pre-routeTarget era)
  const legacy = await PhoneNumberModel.findOne({
    userId,
    $or: [
      { routeType: { $exists: false } },
      { routeType: "agent" },
    ],
  })
    .sort({ assignedAt: -1 })
    .select("number")
    .lean();

  return legacy ? legacy.number : null;
}

export async function lookupUserByPhone(phone: string): Promise<{
  found: boolean;
  name?: string;
  phoneVerified?: boolean;
} | null> {
  const candidates = normalizePhoneForLookup(phone);
  if (candidates.length === 0) return null;

  const user = await UserModel.findOne({
    phone: { $in: candidates },
    phoneVerified: true,
  }).select("name phoneVerified").lean();

  if (!user) return { found: false };
  return { found: true, name: user.name ?? undefined, phoneVerified: user.phoneVerified };
}
