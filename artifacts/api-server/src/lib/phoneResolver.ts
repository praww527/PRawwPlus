import { UserModel } from "@workspace/db";

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

  if (digits.length >= 10 && !candidates.includes("+" + digits)) {
    candidates.push("+" + digits);
  }

  return [...new Set(candidates)];
}

export async function resolvePhoneToExtension(recipientNumber: string): Promise<number | null> {
  if (!recipientNumber || typeof recipientNumber !== "string") return null;

  const trimmed = recipientNumber.trim();

  // Fast path: bare 4-digit extension number (e.g. "1002").
  // The dialpad allows these directly; resolve by extension field rather than
  // the phone-number normalisation path which would produce no candidates.
  if (/^[1-9]\d{3}$/.test(trimmed)) {
    const extNum = parseInt(trimmed, 10);
    const byExt = await UserModel.findOne({
      extension: extNum,
    }).select("extension").lean();
    return byExt?.extension ?? null;
  }

  const candidates = normalizePhoneForLookup(trimmed);
  if (candidates.length === 0) return null;

  const user = await UserModel.findOne({
    phone: { $in: candidates },
    phoneVerified: true,
    extension: { $exists: true, $ne: null },
  }).select("extension").lean();

  return user?.extension ?? null;
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
