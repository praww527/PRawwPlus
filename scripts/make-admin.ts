import { connectDB, UserModel } from "@workspace/db";

const email = process.argv[2];

if (!email) {
  console.error("Usage: pnpm tsx scripts/make-admin.ts <email>");
  process.exit(1);
}

await connectDB();

const user = await UserModel.findOne({ email: email.toLowerCase().trim() });

if (!user) {
  console.error(`No user found with email: ${email}`);
  process.exit(1);
}

const wasAdmin = user.role === "admin";
user.role = "admin";
user.approved = true;
await user.save();

if (wasAdmin) {
  console.log(`✓ ${email} was already admin — ensured approved=true`);
} else {
  console.log(`✓ ${email} promoted to admin (was: ${user.role === "admin" ? "admin" : "user/reseller"})`);
}

process.exit(0);
