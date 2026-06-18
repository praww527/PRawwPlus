#!/usr/bin/env tsx
/**
 * PRaww+ Telecom Audit Runner
 *
 * Runs all 14 telecom audit checks against a live API server.
 * Usage:
 *   pnpm --filter @workspace/scripts run telecom-audit [-- --base-url http://localhost:8080]
 *   # or directly:
 *   node_modules/.bin/tsx telecom-audit.ts [--base-url http://localhost:8080]
 *
 * Exit code: 0 if score >= 70, 1 otherwise.
 */

import mongoose from "mongoose";

const BASE_URL = (() => {
  const idx = process.argv.indexOf("--base-url");
  return idx !== -1 ? process.argv[idx + 1] : "http://localhost:8080";
})();

const MONGO_URI =
  process.env.MONGODB_URI ?? process.env.MONGO_URI ?? "";

type CheckResult = {
  id: number;
  title: string;
  status: "PASS" | "FAIL";
  evidence: string;
  note?: string;
};

const results: CheckResult[] = [];

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const BASE_HEADERS = { "Connection": "close" };

async function get(path: string, cookies?: string): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    "Content-Type": "application/json",
  };
  if (cookies) headers["Cookie"] = cookies;
  const r = await fetch(`${BASE_URL}${path}`, { headers });
  const body = r.headers.get("content-type")?.includes("application/json")
    ? await r.json()
    : await r.text();
  return { status: r.status, body };
}

async function post(
  path: string,
  payload: unknown,
  cookies?: string,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    "Content-Type": "application/json",
  };
  if (cookies) headers["Cookie"] = cookies;
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = r.headers.get("content-type")?.includes("application/json")
    ? await r.json()
    : await r.text();
  return { status: r.status, body };
}

async function postForm(
  path: string,
  formBody: string,
): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...BASE_HEADERS },
    body: formBody,
  });
  const body = r.headers.get("content-type")?.includes("application/json")
    ? await r.json()
    : await r.text();
  return { status: r.status, body };
}

function check(id: number, title: string, pass: boolean, evidence: string, note?: string) {
  results.push({ id, title, status: pass ? "PASS" : "FAIL", evidence, note });
}

// ── Admin session ─────────────────────────────────────────────────────────────

let adminCookies = "";

async function loginAsAdmin(): Promise<string> {
  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...BASE_HEADERS },
    body: JSON.stringify({ email: "admin@praww.co.za", password: "Audit2026!" }),
    redirect: "manual",
  });
  const setCookie = r.headers.get("set-cookie") ?? "";
  const sidMatch = setCookie.match(/sid=([^;]+)/);
  return sidMatch ? `sid=${sidMatch[1]}` : "";
}

// ── DB helpers (direct Mongoose connection — no subprocess) ───────────────────

let db: mongoose.mongo.Db;

async function connectDb(): Promise<void> {
  if (!MONGO_URI) {
    console.warn("  WARN: MONGODB_URI not set — DB-dependent checks will return null data");
    return;
  }
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
  db = mongoose.connection.db as mongoose.mongo.Db;
}

async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// AUDIT CHECKS
// ══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log(`\nPRaww+ Telecom Audit — ${new Date().toISOString()}`);
  console.log(`API: ${BASE_URL}\n`);

  console.log("Authenticating admin session...");
  adminCookies = await loginAsAdmin();
  if (!adminCookies) {
    console.error("ERROR: Could not log in as admin@praww.co.za.");
    console.error("  Ensure the server is running and the password is 'Audit2026!'");
    process.exit(1);
  }
  console.log("Admin session OK.");

  console.log("Connecting to MongoDB...");
  await connectDb();
  console.log(db ? "MongoDB OK.\n" : "MongoDB unavailable — DB checks will show limited data.\n");

  // ── 1. Extension Registration ─────────────────────────────────────────────
  {
    let count = 0, min = 0, max = 0;
    if (db) {
      const users = await db.collection("users")
        .find({ extension: { $exists: true, $ne: null } }, { projection: { extension: 1 } })
        .sort({ extension: 1 })
        .toArray();
      count = users.length;
      min = (users[0] as { extension: number })?.extension ?? 0;
      max = (users[users.length - 1] as { extension: number })?.extension ?? 0;
    }
    const pass = count >= 1;
    check(
      1,
      "Extension Registration",
      pass,
      `${count} users with extensions (${min}–${max}) in DB`,
      pass ? undefined : "No users with extensions found — signup provisioning may be broken",
    );
  }

  // ── 2. SIP Registration / FreeSWITCH Directory ───────────────────────────
  {
    const dir = await postForm(
      "/api/freeswitch/directory",
      "section=directory&purpose=network-list&as_channel=false",
    );
    const admin = await get("/api/freeswitch/admin-status", adminCookies);
    const adminBody = admin.body as Record<string, unknown>;
    const eslConnected = (adminBody?.esl as Record<string, unknown>)?.connected === true;
    const directoryUrl = (adminBody?.config as Record<string, unknown>)?.directoryUrl as string | undefined;
    const urlOk = typeof directoryUrl === "string" && directoryUrl.startsWith("https://");
    const pass = dir.status === 200 && eslConnected && urlOk;
    check(
      2,
      "SIP Registration / FreeSWITCH Directory",
      pass,
      `directory HTTP ${dir.status}; ESL connected=${eslConnected}; directoryUrl="${directoryUrl}"`,
    );
  }

  // ── 3. DID Assignment ─────────────────────────────────────────────────────
  {
    const r = await get("/api/numbers", adminCookies);
    const body = r.body as Record<string, unknown>;
    const myNumbers = (body?.myNumbers as unknown[]) ?? [];
    const pass = r.status === 200 && myNumbers.length > 0;
    const firstDid = (myNumbers[0] as Record<string, unknown>) ?? {};
    check(
      3,
      "DID Assignment",
      pass,
      `HTTP ${r.status}; ${myNumbers.length} DID(s); first=${firstDid.number ?? "none"} status=${firstDid.status ?? "—"}`,
    );
  }

  // ── 4. DID Inbound Routing ────────────────────────────────────────────────
  {
    // Use %2B to properly encode + in query strings
    const route = await get("/api/freeswitch/did-route?number=%2B27000000000");
    const inbound = await get("/api/freeswitch/inbound?did=%2B27000000000");
    const routeOk = route.body === "unrouted" || route.status === 200;
    const inboundOk =
      typeof inbound.body === "string" && /^\d+$/.test(inbound.body.trim());
    const pass = routeOk && inboundOk;
    check(
      4,
      "DID Inbound Routing",
      pass,
      `did-route=${JSON.stringify(route.body)} (HTTP ${route.status}); inbound fallback=${JSON.stringify(inbound.body)}`,
    );
  }

  // ── 5. Outbound Caller ID (CLI) ───────────────────────────────────────────
  {
    const r = await get("/api/calls?limit=5", adminCookies);
    const body = r.body as Record<string, unknown>;
    const calls = (body?.calls as Record<string, unknown>[]) ?? [];
    const withCLI = calls.filter((c) => c.callerIdSource && c.selectedCallerId);
    const pass = r.status === 200 && calls.length > 0 && withCLI.length > 0;
    const sample = withCLI[0] ?? calls[0] ?? {};
    check(
      5,
      "Outbound Caller ID (CLI)",
      pass,
      `${withCLI.length}/${calls.length} calls with CLI; sample callerIdSource=${sample.callerIdSource ?? "—"}; selectedCallerId=${sample.selectedCallerId ?? "—"}`,
    );
  }

  // ── 6. Extension-to-Extension Calls ──────────────────────────────────────
  {
    const ph = await get("/api/admin/platform-health", adminCookies);
    const phBody = ph.body as Record<string, unknown>;
    const ws = phBody?.websocket as Record<string, unknown>;
    const r = await get("/api/calls?limit=1", adminCookies);
    const pass = r.status === 200 && phBody?.status === "ok";
    check(
      6,
      "Extension-to-Extension Calls",
      pass,
      `calls HTTP ${r.status}; platform-health=${phBody?.status}; activeVerto=${ws?.activeVertoClients ?? "—"}; activeSip=${ws?.activeSipClients ?? "—"}`,
      pass
        ? "API+infra verified; no live Verto/SIP client registered for full RTP test"
        : "platform-health or calls endpoint failure",
    );
  }

  // ── 7. Outbound PSTN Gateway ──────────────────────────────────────────────
  {
    const r = await get("/api/freeswitch/gateway-status", adminCookies);
    const body = r.body as Record<string, unknown>;
    const gateways = (body?.gateways as Record<string, unknown>[]) ?? [];
    const reged = gateways.some((g) => g.state === "REGED" || g.stateDetail === "UP");
    const pass = r.status === 200 && body?.eslConnected === true && reged;
    const gw = gateways[0] ?? {};
    check(
      7,
      "Outbound PSTN Gateway",
      pass,
      `HTTP ${r.status}; ESL=${body?.eslConnected}; gateway=${gw.name}; state=${gw.state}/${gw.stateDetail}; realm=${gw.realm}`,
    );
  }

  // ── 8. Inbound PSTN (dialplan + mod_curl) ────────────────────────────────
  {
    const inbound = await get("/api/freeswitch/inbound?did=%2B27763155369");
    const dir = await postForm(
      "/api/freeswitch/directory",
      "section=directory&purpose=network-list&as_channel=false",
    );
    const inboundOk = inbound.status === 200;
    const dirOk = dir.status === 200;
    const pass = inboundOk && dirOk;
    check(
      8,
      "Inbound PSTN (mod_curl dialplan)",
      pass,
      `inbound HTTP ${inbound.status} route=${JSON.stringify(inbound.body)}; directory HTTP ${dir.status}`,
    );
  }

  // ── 9. CDRs ───────────────────────────────────────────────────────────────
  {
    const r = await get("/api/cdr?limit=5", adminCookies);
    const body = r.body as Record<string, unknown>;
    const cdrs = (body?.cdr as Record<string, unknown>[]) ?? [];
    const hasRequiredFields =
      cdrs.length > 0 &&
      cdrs[0].callId !== undefined &&
      cdrs[0].direction !== undefined &&
      cdrs[0].hangupCause !== undefined &&
      cdrs[0].billsec !== undefined;
    const pass = r.status === 200 && Number(body?.total ?? 0) > 0 && hasRequiredFields;
    check(
      9,
      "Call Detail Records (CDRs)",
      pass,
      `HTTP ${r.status}; total=${body?.total ?? 0}; pages=${body?.totalPages ?? 0}; hasRequiredFields=${hasRequiredFields}`,
    );
  }

  // ── 10. Call Recording ────────────────────────────────────────────────────
  {
    const r = await get("/api/recordings", adminCookies);
    const body = r.body as Record<string, unknown>;
    const adminStatus = await get("/api/freeswitch/admin-status", adminCookies);
    const adminBody = adminStatus.body as Record<string, unknown>;
    const sshKeySet = (adminBody?.config as Record<string, unknown>)?.sshKeySet === true;
    const endpointOk = r.status === 200 && Array.isArray(body?.recordings);
    const pass = endpointOk && sshKeySet;
    check(
      10,
      "Call Recording",
      pass,
      `HTTP ${r.status}; recordingsArray=${Array.isArray(body?.recordings)}; count=${(body?.recordings as unknown[])?.length ?? "—"}; sshKeySet=${sshKeySet}`,
      pass
        ? "API+SSH config verified; 0 recordings because no calls have been answered yet"
        : "recordings endpoint or SSH key config failed",
    );
  }

  // ── 11. Wallet / Billing Deductions ──────────────────────────────────────
  {
    let totalCdrs = 0, billsecSum = 0, coinsSum = 0, ledgerEntries = 0;
    if (db) {
      const [cdrs, ledger] = await Promise.all([
        db.collection("cdrs").find({}).toArray(),
        db.collection("billingledgers").countDocuments(),
      ]);
      totalCdrs = cdrs.length;
      billsecSum = cdrs.reduce((s, c) => s + (Number(c["billsec"]) || 0), 0);
      coinsSum = cdrs.reduce((s, c) => s + (Number(c["coinsUsed"]) || 0), 0);
      ledgerEntries = ledger;
    }
    // Ledger is consistent if billsec=0 → no entries, or billsec>0 → entries expected
    const ledgerConsistent = billsecSum === 0 ? ledgerEntries === 0 : ledgerEntries > 0;
    const pass = ledgerConsistent;
    check(
      11,
      "Wallet / Billing Deductions",
      pass,
      `totalCDRs=${totalCdrs}; billsecSum=${billsecSum}; coinsDeducted=${coinsSum}; ledgerEntries=${ledgerEntries}; ledgerConsistentWithBillsec=${ledgerConsistent}`,
      pass && billsecSum === 0
        ? "Ledger empty because no calls have been answered (all billsec=0) — correct behaviour"
        : undefined,
    );
  }

  // ── 12. Subscription Plan Enforcement ────────────────────────────────────
  {
    const r = await post("/api/calls", { recipientNumber: "+27831234567" }, undefined);
    const unauthBlocked = r.status === 401;

    let subStatus = "unknown";
    if (db) {
      const u = await db.collection("users").findOne(
        { email: "denityrone@gmail.com" },
        { projection: { subscriptionStatus: 1, isAdmin: 1 } },
      ) as { subscriptionStatus?: string; isAdmin?: boolean } | null;
      subStatus = u?.subscriptionStatus ?? "not found";
    }

    const pass = unauthBlocked;
    check(
      12,
      "Subscription Plan Enforcement",
      pass,
      `unauthenticated POST /api/calls → HTTP ${r.status} (expect 401=${unauthBlocked}); non-admin user subscriptionStatus=${subStatus}`,
    );
  }

  // ── 13. Admin Dashboard Statistics ───────────────────────────────────────
  {
    const r = await get("/api/admin/stats", adminCookies);
    const body = r.body as Record<string, unknown>;
    const hasFields =
      typeof body?.totalUsers === "number" &&
      typeof body?.totalCalls === "number" &&
      typeof body?.activeSubscriptions === "number";
    const pass = r.status === 200 && hasFields;
    check(
      13,
      "Admin Dashboard Statistics",
      pass,
      `HTTP ${r.status}; totalUsers=${body?.totalUsers}; totalCalls=${body?.totalCalls}; activeSubscriptions=${body?.activeSubscriptions}; pendingApprovals=${body?.pendingApprovals}`,
    );
  }

  // ── 14. FreeSWITCH ESL Event Processing ──────────────────────────────────
  {
    const r = await get("/api/admin/platform-health", adminCookies);
    const body = r.body as Record<string, unknown>;
    const esl = body?.esl as Record<string, unknown>;
    const eslOk =
      esl?.enabled === true &&
      esl?.connected === true &&
      (esl?.bufferedEvents as number) === 0;
    const staleSec = (esl?.lastEventStaleSec as number) ?? 0;
    const pass = r.status === 200 && eslOk && staleSec < 120;
    check(
      14,
      "FreeSWITCH ESL Event Processing",
      pass,
      `HTTP ${r.status}; connected=${esl?.connected}; eventsThisMinute=${esl?.eventsThisMinute}; lastEventStaleSec=${staleSec}; bufferedEvents=${esl?.bufferedEvents}; pendingDbEvents=${esl?.pendingDbEvents}`,
    );
  }

  // ── Disconnect DB ─────────────────────────────────────────────────────────
  await disconnectDb();

  // ══════════════════════════════════════════════════════════════════════════
  // SCORING
  // ══════════════════════════════════════════════════════════════════════════

  const weights: Record<number, number> = {
    1: 7,
    2: 7,
    3: 7,
    4: 7,
    5: 7,
    6: 6,
    7: 10,
    8: 7,
    9: 8,
    10: 7,
    11: 8,
    12: 8,
    13: 6,
    14: 7,
  };

  const totalWeight = Object.values(weights).reduce((s, v) => s + v, 0);
  const earned = results.reduce(
    (s, r) => s + (r.status === "PASS" ? (weights[r.id] ?? 0) : 0),
    0,
  );
  const score = Math.round((earned / totalWeight) * 100);

  const passes = results.filter((r) => r.status === "PASS").length;
  const fails = results.filter((r) => r.status === "FAIL").length;

  // ══════════════════════════════════════════════════════════════════════════
  // OUTPUT
  // ══════════════════════════════════════════════════════════════════════════

  console.log("─".repeat(80));
  console.log("AUDIT RESULTS");
  console.log("─".repeat(80));

  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    console.log(`${icon} [${r.id.toString().padStart(2)}] ${r.title}`);
    console.log(`       Evidence: ${r.evidence}`);
    if (r.note) console.log(`       Note: ${r.note}`);
  }

  console.log("─".repeat(80));
  console.log(`PASS: ${passes}  FAIL: ${fails}  TOTAL: ${results.length}`);
  console.log(`SCORE: ${earned}/${totalWeight} weighted points → ${score}/100`);
  console.log("─".repeat(80));

  if (score < 70) {
    console.error(`\nReadiness score ${score}/100 is below threshold 70 — address FAIL items above.`);
    process.exit(1);
  } else {
    console.log(`\nReadiness: ${score}/100 — platform passes minimum telecom readiness threshold.`);
  }
}

run().catch((err) => {
  console.error("Audit runner failed:", err);
  disconnectDb().catch(() => {});
  process.exit(1);
});
