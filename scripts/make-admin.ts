#!/usr/bin/env tsx
/**
 * scripts/make-admin.ts
 *
 * Promote a user to the admin role in MongoDB.
 *
 * Usage (on the VPS):
 *   cd /home/ubuntu/PRawwPlus
 *   pnpm --filter @workspace/scripts run make-admin admin@praww.co.za
 */

import fs from "fs";
import path from "path";
import mongoose from "mongoose";

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
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
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

const UserSchema = new mongoose.Schema({ email: String, role: String, approved: Boolean }, { strict: false });
const UserModel = mongoose.models["User"] ?? mongoose.model("User", UserSchema, "users");

const email = process.argv[2];
if (!email) {
  console.error("Usage: pnpm --filter @workspace/scripts run make-admin <email>");
  process.exit(1);
}

await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });

const user = await UserModel.findOne({ email: email.toLowerCase().trim() }).lean() as any;
if (!user) {
  console.error(`No user found with email: ${email}`);
  await mongoose.disconnect();
  process.exit(1);
}

const prevRole = user.role ?? "user";
await UserModel.updateOne({ _id: user._id }, { $set: { role: "admin", approved: true } });

console.log(`✓ ${email} promoted to admin (was: ${prevRole})`);
await mongoose.disconnect();
