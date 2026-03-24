import crypto from "crypto";
import { UserModel } from "@workspace/db";

const EXTENSION_START = 1000;

export async function assignExtensionIfNeeded(userId: string): Promise<{ extension: number; fsPassword: string } | null> {
  const user = await UserModel.findById(userId).select("extension fsPassword");
  if (!user) return null;

  // Both already assigned — nothing to do
  if (user.extension && user.fsPassword) {
    return { extension: user.extension, fsPassword: user.fsPassword };
  }

  // Has extension but missing fsPassword — just generate the password
  if (user.extension && !user.fsPassword) {
    const fsPassword = crypto.randomBytes(10).toString("hex");
    await UserModel.updateOne({ _id: userId }, { $set: { fsPassword } });
    return { extension: user.extension, fsPassword };
  }

  // Neither exists — assign next available extension + generate password
  const maxUser = await UserModel.findOne({ extension: { $exists: true, $ne: null } })
    .sort({ extension: -1 })
    .select("extension");

  const nextExtension = maxUser?.extension != null ? maxUser.extension + 1 : EXTENSION_START;
  const fsPassword = crypto.randomBytes(10).toString("hex");

  // Use $exists: false to guard against race conditions
  await UserModel.updateOne(
    { _id: userId, $or: [{ extension: { $exists: false } }, { extension: null }] },
    { $set: { extension: nextExtension, fsPassword } }
  );

  const updated = await UserModel.findById(userId).select("extension fsPassword");
  if (!updated?.extension || !updated?.fsPassword) return null;
  return { extension: updated.extension, fsPassword: updated.fsPassword };
}

export function isInternalNumber(number: string): boolean {
  const digits = number.replace(/\D/g, "");
  return digits.length >= 3 && digits.length <= 4;
}
