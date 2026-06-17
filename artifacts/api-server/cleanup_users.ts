import mongoose from "mongoose";
const URI = process.env.MONGODB_URI || process.env.MONGO_URI || "";
async function main() {
  await mongoose.connect(URI);
  const db = mongoose.connection.db!;
  // Show user count and any obvious test accounts
  const users = await db.collection("users").find({}, {
    projection: { email: 1, name: 1, username: 1, isAdmin: 1, orgRole: 1, createdAt: 1 }
  }).toArray();
  console.log(`Total users: ${users.length}`);
  users.forEach((u: any) => {
    const isTest = /test|demo|example\.com|fake|dummy|trial/i.test(u.email || "");
    console.log(`  ${isTest ? "🗑️ TEST" : "✅ KEEP"} | ${u.email || u.username} | admin=${u.isAdmin} | role=${u.orgRole} | created=${u.createdAt}`);
  });
  // Delete test/demo accounts (not admins)
  const testEmails = users
    .filter((u: any) => !u.isAdmin && /test|demo|example\.com|fake|dummy|trial/i.test(u.email || ""))
    .map((u: any) => u._id);
  if (testEmails.length > 0) {
    const del = await db.collection("users").deleteMany({ _id: { $in: testEmails } });
    console.log(`\nDeleted ${del.deletedCount} test/demo users`);
  } else {
    console.log("\nNo test/demo users found — nothing to delete");
  }
  // Also clean up audit logs, call events (keep recent 0 - fresh start)
  const auditDel = await db.collection("auditlogs").deleteMany({});
  const eventsDel = await db.collection("callevents").deleteMany({});
  const pendingDel = await db.collection("pendingeslevents").deleteMany({});
  console.log(`Audit logs cleared: ${auditDel.deletedCount}`);
  console.log(`Call events cleared: ${eventsDel.deletedCount}`);
  console.log(`Pending ESL events cleared: ${pendingDel.deletedCount}`);
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
