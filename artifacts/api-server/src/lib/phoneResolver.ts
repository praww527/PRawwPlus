import { UserModel } from "@workspace/db";
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

  // Only add bare digits as +digits if they could be valid E.164 (no leading 0)
  if (digits.length >= 10 && !digits.startsWith("0") && !candidates.includes("+" + digits)) {
    candidates.push("+" + digits);
  }

  return [...new Set(candidates)];
}

export async function resolvePhoneToExtension(recipientNumber: string): Promise<number | null> {
  if (!recipientNumber || typeof recipientNumber !== "string") return null;

  const trimmed = recipientNumber.trim();

  // Extensions are strictly backend-only routing identifiers; users always
  // dial by verified mobile number.  Bare 4-digit strings are therefore NOT
  // treated as direct extension dials — they fall through to the phone-number
  // normalisation path which will produce no candidates and return null,
  // causing the call to be classified as external (PSTN) and rejected if no
  // PSTN gateway is configured.  This prevents extension enumeration.

  const candidates = normalizePhoneForLookup(trimmed);
  if (candidates.length === 0) return null;

  // Find user by phone — regardless of whether they have an extension yet.
  // Prefer verified phone matches; sort desc so verified wins when two users
  // share the same stored number (one verified, one not).
  const user = await UserModel.findOne({
    phone: { $in: candidates },
  }).sort({ phoneVerified: -1 }).select("_id extension").lean();

  if (!user) return null;

  // User found — ensure they have an extension (lazy provisioning for users
  // created after the last server startup).
  if (user.extension) return user.extension;

  logger.info(
    { userId: String(user._id), candidates },
    "[phoneResolver] User found by phone but has no extension — provisioning now",
  );
  const ext = await assignExtensionIfNeeded(String(user._id));
  return ext?.extension ?? null;
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
