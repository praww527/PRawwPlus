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
 * Resolve a phone number to an internal extension (legacy: used by dialplan phone_number_lookup).
 * Extensions are internal routing keys — never exposed to callers.
 */
export async function resolvePhoneToExtension(recipientNumber: string): Promise<number | null> {
  if (!recipientNumber || typeof recipientNumber !== "string") return null;

  const trimmed = recipientNumber.trim();
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
 * Returns null if the user has no DID assigned.
 */
export async function getUserPrimaryDid(userId: string): Promise<string | null> {
  const number = await PhoneNumberModel.findOne({
    $or: [
      { userId, routeType: "agent" },
      { userId },
    ],
  })
    .sort({ assignedAt: -1 })
    .select("number")
    .lean();

  return number ? number.number : null;
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
