import crypto from "crypto";
import { UserModel } from "@workspace/db";

const EXTENSION_START = 1001;

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateSipPassword(): string {
  const bytes = crypto.randomBytes(12);
  let pw = "";
  for (let i = 0; i < 12; i++) pw += ALNUM[bytes[i] % ALNUM.length];
  return pw;
}

export async function assignExtensionIfNeeded(userId: string): Promise<{ extension: number; fsPassword: string } | null> {
  const user = await UserModel.findById(userId).select("extension fsPassword");
  if (!user) return null;

  // Both already assigned — nothing to do
  if (user.extension && user.fsPassword) {
    return { extension: user.extension, fsPassword: user.fsPassword };
  }

  // Has extension but missing fsPassword — just generate the password
  if (user.extension && !user.fsPassword) {
    const fsPassword = generateSipPassword();
    await UserModel.updateOne({ _id: userId }, { $set: { fsPassword } });
    return { extension: user.extension, fsPassword };
  }

  // Neither exists — assign next available extension + generate password.
  // Retry up to 10 times to handle concurrent signups: two callers may both
  // read the same max extension and try to assign the same next value. The
  // unique sparse index on `extension` means the second write gets a duplicate
  // key error (code 11000), so we simply re-read the new max and try again.
  const fsPassword = generateSipPassword();

  for (let attempt = 0; attempt < 10; attempt++) {
    const maxUser = await UserModel.findOne({ extension: { $exists: true, $ne: null } })
      .sort({ extension: -1 })
      .select("extension");

    const nextExtension = maxUser?.extension != null ? maxUser.extension + 1 : EXTENSION_START;

    try {
      const result = await UserModel.updateOne(
        { _id: userId, $or: [{ extension: { $exists: false } }, { extension: null }] },
        { $set: { extension: nextExtension, fsPassword } }
      );

      if (result.modifiedCount === 0) {
        // Another concurrent request already assigned this user an extension.
        break;
      }

      // Successfully assigned — fall through to final read.
      break;
    } catch (err: any) {
      // Duplicate key on the unique extension index — another user grabbed the
      // same extension between our read and write. Loop and try the next value.
      if (err?.code === 11000) continue;
      throw err;
    }
  }

  const updated = await UserModel.findById(userId).select("extension fsPassword");
  if (!updated?.extension || !updated?.fsPassword) return null;
  return { extension: updated.extension, fsPassword: updated.fsPassword };
}

export function isInternalNumber(number: string): boolean {
  const digits = number.replace(/\D/g, "");
  // Extensions are always 4 digits (EXTENSION_START = 1001, range 1000-9999).
  // Dialplan pattern: ^([1-9][0-9]{3})$ — matches 1000-9999 only.
  return digits.length === 4;
}
