#!/usr/bin/env tsx
/**
 * scripts/verify-user.ts
 *
 * Admin tool: manually mark a user's email as verified in MongoDB.
 * Use this when:
 *   - SMTP is not configured and a user signed up before the auto-verify fix
 *   - A user lost their verification email
 *   - You need to quickly unblock a user in production
 *
 * Usage (on the VPS):
 *   cd /home/ubuntu/PRawwPlus
 *   pnpm tsx scripts/verify-user.ts user@example.com
 *
 * Or to list all unverified users:
 *   pnpm tsx scripts/verify-user.ts --list
 *
 * Or to verify ALL unverified users at once:
 *   pnpm tsx scripts/verify-user.ts --all
 */

import fs   from "fs";
import path from "path";
import mongoose from "mongoose";

// Load .env from repo root (works when run from any cwd)
function loadDotEnv() {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(import.meta.dirname, "..", ".env"),
  ];
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    for (const raw of fs.readFileSync(f, "utf-8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val.replace(/\\n/g, "\n");
    }
    break;
  }
}

loadDotEnv();

const MONGODB_URI = process.env.MONGODB_URI ?? process.env.MONGO_URI ?? "";
if (!MONGODB_URI) {
  console.error("ERROR: MONGODB_URI is not set. Make sure .env exists with MONGODB_URI.");
  process.exit(1);
}

const UserSchema = new mongoose.Schema({
  email: String,
  name: String,
  emailVerified: Boolean,
  verificationToken: String,
  verificationTokenExpiry: Date,
}, { strict: false });

const UserModel = mongoose.models["User"]
  ?? mongoose.model("User", UserSchema, "users");

async function main() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });

  const args = process.argv.slice(2);
  const first = args[0] ?? "--list";

  // ── List mode ────────────────────────────────────────────────────────────
  if (first === "--list" || first === "-l") {
    const unverified = await UserModel
      .find({ emailVerified: { $ne: true } })
      .select("email name emailVerified")
      .lean() as Array<{ email?: string; name?: string }>;

    if (unverified.length === 0) {
      console.log("All users are already verified.");
    } else {
      console.log(`\nUnverified users (${unverified.length}):`);
      for (const u of unverified) {
        console.log(`  ${u.email ?? "(no email)"}  —  ${u.name ?? "(no name)"}`);
      }
      console.log("\nVerify one:  pnpm tsx scripts/verify-user.ts <email>");
      console.log("Verify all:  pnpm tsx scripts/verify-user.ts --all");
    }
    await mongoose.disconnect();
    return;
  }

  // ── Verify all mode ──────────────────────────────────────────────────────
  if (first === "--all") {
    const result = await UserModel.updateMany(
      { emailVerified: { $ne: true } },
      { $set: { emailVerified: true }, $unset: { verificationToken: "", verificationTokenExpiry: "" } },
    );
    console.log(`\nVerified ${result.modifiedCount} user(s). They can all now log in.\n`);
    await mongoose.disconnect();
    return;
  }

  // ── Verify by email ──────────────────────────────────────────────────────
  const email = first.toLowerCase().trim();
  const user = await UserModel.findOne({ email }).lean() as { email?: string; emailVerified?: boolean } | null;

  if (!user) {
    console.error(`ERROR: No user found with email "${email}"`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (user.emailVerified) {
    console.log(`"${email}" is already verified. Nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  await UserModel.updateOne(
    { email },
    { $set: { emailVerified: true }, $unset: { verificationToken: "", verificationTokenExpiry: "" } },
  );

  console.log(`\nVerified: ${email}`);
  console.log("The user can now log in.\n");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error:", err?.message ?? err);
  process.exit(1);
});
