/**
 * Automatic Caller ID Selector
 *
 * Determines the correct outbound caller ID for every call based on:
 *   - Call type: internal (extension/SIP) vs external (E.164/PSTN)
 *   - Server-side ownership validation (anti-spoofing — no arbitrary injection)
 *   - Priority hierarchy for external calls:
 *       1. Admin-approved CallerIdProfile override  (explicit profileId)
 *       2. User's default CallerIdProfile           (isDefault=true, approved)
 *       3. Platform-assigned PhoneNumber (DID)      (voice capability)
 *       4. User's verified mobile                   (phoneVerified=true)
 *       5. Platform fallback                        (PLATFORM_OUTBOUND_NUMBER env)
 *
 * Every decision is structured-logged with userId, destination, callType,
 * callerIdNumber, callerIdSource, and trunk so operations teams can trace
 * every call's caller ID decision from logs alone.
 *
 * selectCallerId() never throws on missing caller ID for inbound records or
 * internal calls. For external outbound calls it throws if no valid number
 * is found — the caller in calls.ts catches and logs the error without
 * blocking the call (legacy behaviour is preserved as the safe fallback).
 */

import { connectDB, UserModel, PhoneNumberModel, CallerIdProfileModel } from "@workspace/db";
import { normalizePhoneNumber } from "./phoneNormalize";
import { logger } from "./logger";

export type CallerIdSource =
  | "extension"         // internal — extension number used as caller ID
  | "profile-override"  // admin-approved explicit CallerIdProfile (by ID)
  | "profile-default"   // admin-approved user default CallerIdProfile
  | "platform-number"   // PhoneNumber assigned to this user (DID)
  | "verified-mobile"   // user.phone (phoneVerified === true)
  | "platform-fallback" // PLATFORM_OUTBOUND_NUMBER env var
  | "none";             // no caller ID selected (inbound / unresolved)

export type CallerIdCallType = "internal" | "external-pstn";

export interface CallerIdSelection {
  callType:              CallerIdCallType;
  callerIdNumber:        string;
  callerIdName:          string;
  callerIdSource:        CallerIdSource;
  trunk:                 string;
  destinationNormalized: string;
  destinationType:       "extension" | "e164" | "unknown";
}

export interface SelectCallerIdParams {
  userId:            string;
  destination:       string;
  resolvedExtension: number | null;
  profileId?:        string | null;
  direction:         "outbound" | "inbound";
}

/**
 * Classify a dial destination as extension or E.164, and normalize it.
 */
export function detectDestinationType(
  destination: string,
  resolvedExtension: number | null,
): { type: "extension" | "e164" | "unknown"; normalized: string } {
  if (resolvedExtension !== null) {
    return { type: "extension", normalized: String(resolvedExtension) };
  }
  const trimmed = destination.trim();
  if (/^[1-9]\d{3}$/.test(trimmed)) {
    return { type: "extension", normalized: trimmed };
  }
  const norm = normalizePhoneNumber(trimmed);
  if (norm.ok) {
    return { type: "e164", normalized: norm.e164 };
  }
  const stripped = trimmed.replace(/[\s\-().]/g, "");
  if (/^\+?[1-9]\d{6,14}$/.test(stripped)) {
    const e164 = stripped.startsWith("+") ? stripped : "+" + stripped;
    return { type: "e164", normalized: e164 };
  }
  return { type: "unknown", normalized: trimmed };
}

/**
 * Select the caller ID for this outbound call.
 *
 * For external calls, throws Error if no verified outbound number exists.
 * The caller (POST /calls) catches this and uses it as a non-blocking warning
 * so legacy flows that reach FS without an injected caller ID still work.
 */
export async function selectCallerId(
  params: SelectCallerIdParams,
): Promise<CallerIdSelection> {
  const { userId, destination, resolvedExtension, profileId, direction } = params;

  await connectDB();

  const { type: destinationType, normalized: destinationNormalized } =
    detectDestinationType(destination, resolvedExtension);

  const gateway  = (process.env.PSTN_GATEWAY_NAME ?? process.env.FREESWITCH_GATEWAY ?? "").trim();
  const trunk    = gateway ? `gateway:${gateway}` : "gateway:default";

  // ── Internal call ───────────────────────────────────────────────────────────
  if (destinationType === "extension" || direction === "inbound") {
    const user = await UserModel.findById(userId)
      .select("extension name email")
      .lean();

    const ext  = String((user as any)?.extension ?? "");
    const name =
      (user as any)?.name ||
      ((user as any)?.email ?? "").split("@")[0] ||
      "PRaww+ User";

    const sel: CallerIdSelection = {
      callType:              "internal",
      callerIdNumber:        ext,
      callerIdName:          name,
      callerIdSource:        "extension",
      trunk:                 "internal",
      destinationNormalized,
      destinationType:       destinationType === "unknown" ? "unknown" : destinationType,
    };

    logger.info(
      {
        userId,
        destination,
        destinationNorm: destinationNormalized,
        callType:        "internal",
        callerIdNumber:  ext,
        callerIdName:    name,
        callerIdSource:  "extension",
        trunk:           "internal",
      },
      "[callerIdSelector] internal — using extension caller ID",
    );

    return sel;
  }

  // ── External / PSTN ─────────────────────────────────────────────────────────
  const user = await UserModel.findById(userId)
    .select("name email phone phoneVerified")
    .lean();

  const displayName =
    (user as any)?.name ||
    ((user as any)?.email ?? "").split("@")[0] ||
    `user-${userId.slice(0, 6)}`;

  // Priority 1: Explicit CallerIdProfile override (client-supplied profileId)
  if (profileId) {
    const profile = await CallerIdProfileModel.findOne({
      _id:    profileId,
      userId,
      status: "approved",
    }).lean();

    if (profile) {
      const numNorm = normalizePhoneNumber((profile as any).number);
      const number  = numNorm.ok ? numNorm.e164 : (profile as any).number;
      const name    = (profile as any).name || displayName;

      const sel: CallerIdSelection = {
        callType:              "external-pstn",
        callerIdNumber:        number,
        callerIdName:          name,
        callerIdSource:        "profile-override",
        trunk,
        destinationNormalized,
        destinationType:       destinationType === "unknown" ? "unknown" : destinationType,
      };

      logger.info(
        { userId, destination, destinationNorm: destinationNormalized, callerIdNumber: number, callerIdName: name, callerIdSource: "profile-override", profileId, trunk },
        "[callerIdSelector] PSTN — using approved profile override",
      );
      return sel;
    }

    logger.warn(
      { userId, profileId },
      "[callerIdSelector] Requested CallerIdProfile not found or not approved — falling through",
    );
  }

  // Priority 2: User's default CallerIdProfile (isDefault=true, approved)
  const defaultProfile = await CallerIdProfileModel.findOne({
    userId,
    status:    "approved",
    isDefault: true,
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (defaultProfile) {
    const numNorm = normalizePhoneNumber((defaultProfile as any).number);
    const number  = numNorm.ok ? numNorm.e164 : (defaultProfile as any).number;
    const name    = (defaultProfile as any).name || displayName;

    const sel: CallerIdSelection = {
      callType:              "external-pstn",
      callerIdNumber:        number,
      callerIdName:          name,
      callerIdSource:        "profile-default",
      trunk,
      destinationNormalized,
      destinationType:       destinationType === "unknown" ? "unknown" : destinationType,
    };

    logger.info(
      { userId, destination, destinationNorm: destinationNormalized, callerIdNumber: number, callerIdName: name, callerIdSource: "profile-default", profileId: String((defaultProfile as any)._id), trunk },
      "[callerIdSelector] PSTN — using user default CallerIdProfile",
    );
    return sel;
  }

  // Priority 3: Platform-assigned PhoneNumber (DID) owned by this user
  const platformNumber = await PhoneNumberModel.findOne({
    userId,
    capabilities: "voice",
  })
    .sort({ assignedAt: 1 })
    .lean();

  if (platformNumber) {
    const numNorm = normalizePhoneNumber((platformNumber as any).number);
    const number  = numNorm.ok ? numNorm.e164 : (platformNumber as any).number;
    const name    = (platformNumber as any).cnamName || displayName;

    const sel: CallerIdSelection = {
      callType:              "external-pstn",
      callerIdNumber:        number,
      callerIdName:          name,
      callerIdSource:        "platform-number",
      trunk,
      destinationNormalized,
      destinationType:       destinationType === "unknown" ? "unknown" : destinationType,
    };

    logger.info(
      { userId, destination, destinationNorm: destinationNormalized, callerIdNumber: number, callerIdName: name, callerIdSource: "platform-number", platformNumberId: String((platformNumber as any)._id), trunk },
      "[callerIdSelector] PSTN — using platform-assigned DID number",
    );
    return sel;
  }

  // Priority 4: User's verified mobile number
  if ((user as any)?.phone && (user as any)?.phoneVerified) {
    const numNorm = normalizePhoneNumber((user as any).phone);
    const number  = numNorm.ok ? numNorm.e164 : (user as any).phone;

    const sel: CallerIdSelection = {
      callType:              "external-pstn",
      callerIdNumber:        number,
      callerIdName:          displayName,
      callerIdSource:        "verified-mobile",
      trunk,
      destinationNormalized,
      destinationType:       destinationType === "unknown" ? "unknown" : destinationType,
    };

    logger.info(
      { userId, destination, destinationNorm: destinationNormalized, callerIdNumber: number, callerIdName: displayName, callerIdSource: "verified-mobile", trunk },
      "[callerIdSelector] PSTN — using verified mobile number",
    );
    return sel;
  }

  // Priority 5: Platform fallback number
  const fallback = (process.env.PLATFORM_OUTBOUND_NUMBER ?? "").trim();
  if (fallback) {
    const numNorm = normalizePhoneNumber(fallback);
    const number  = numNorm.ok ? numNorm.e164 : fallback;

    const sel: CallerIdSelection = {
      callType:              "external-pstn",
      callerIdNumber:        number,
      callerIdName:          "PRaww+",
      callerIdSource:        "platform-fallback",
      trunk,
      destinationNormalized,
      destinationType:       destinationType === "unknown" ? "unknown" : destinationType,
    };

    logger.warn(
      { userId, destination, destinationNorm: destinationNormalized, callerIdNumber: number, callerIdSource: "platform-fallback", trunk, note: "No verified mobile or platform DID — using platform fallback" },
      "[callerIdSelector] PSTN — using platform fallback number",
    );
    return sel;
  }

  throw new Error(
    "No verified outbound caller ID available for PSTN call. " +
    "Verify your mobile number, request a platform number, or set PLATFORM_OUTBOUND_NUMBER.",
  );
}
