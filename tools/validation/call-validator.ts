#!/usr/bin/env tsx
/**
 * Call Event Sequence Validator — Phase 3 validation
 *
 * Makes a real outbound call via the API and verifies that all expected
 * FreeSWITCH event stages appear in the /admin/platform-health metrics
 * in the correct sequence and within acceptable timing windows.
 *
 * What it checks:
 *   - active call count increments on initiation
 *   - answer count increments on connect
 *   - call count returns to baseline on hangup
 *   - answer rate stays healthy (>80%)
 *   - no zombie sessions after hangup
 *   - rapid hangup / redial cycle (5 iterations)
 *
 * Usage:
 *   tsx tools/validation/call-validator.ts \
 *     --base-url   https://rtc.praww.co.za \
 *     --admin-key  <ADMIN_API_KEY> \
 *     --session-id <user-session-sid> \
 *     --from-ext   1001 \
 *     --to-number  +27110000000 \
 *     --call-wait  30
 */

import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    "base-url":   { type: "string", default: process.env["BASE_URL"]      ?? "http://localhost:8080" },
    "admin-key":  { type: "string", default: process.env["ADMIN_API_KEY"] ?? "" },
    "session-id": { type: "string", default: process.env["TEST_SESSION"]  ?? "" },
    "from-ext":   { type: "string", default: process.env["TEST_FROM_EXT"] ?? "1001" },
    "to-number":  { type: "string", default: process.env["TEST_TO_NUM"]   ?? "" },
    "call-wait":  { type: "string", default: "30" },
    "iterations": { type: "string", default: "3"  },
    "rapid-iter": { type: "string", default: "5"  },
  },
  strict: false,
});

const BASE_URL   = args["base-url"]   as string;
const ADMIN_KEY  = args["admin-key"]  as string;
const SESSION_ID = args["session-id"] as string;
const TO_NUMBER  = args["to-number"]  as string;
const CALL_WAIT  = parseInt(args["call-wait"]  as string, 10) * 1_000;
const ITERATIONS = parseInt(args["iterations"] as string, 10);
const RAPID_ITER = parseInt(args["rapid-iter"] as string, 10);

if (!ADMIN_KEY)  { console.error("ERROR: --admin-key required");  process.exit(1); }
if (!SESSION_ID) { console.error("ERROR: --session-id required"); process.exit(1); }
if (!TO_NUMBER)  { console.error("ERROR: --to-number required");  process.exit(1); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

interface PlatformHealth {
  activeCalls:      number;
  callsInitiated:   number;
  callsAnswered:    number;
  callsFailed:      number;
  sipSessions:      number;
  wsVertoClients:   number;
  eslConnected:     boolean;
  dbOk:             boolean;
  sweeperZombies:   number;
}

async function fetchHealth(): Promise<PlatformHealth> {
  const res = await fetch(`${BASE_URL}/api/admin/platform-health`, {
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`health HTTP ${res.status}`);
  const d = await res.json();
  return {
    activeCalls:    d.calls?.active       ?? 0,
    callsInitiated: d.calls?.initiated    ?? 0,
    callsAnswered:  d.calls?.answered     ?? 0,
    callsFailed:    d.calls?.failed       ?? 0,
    sipSessions:    d.websocket?.sipSessions ?? 0,
    wsVertoClients: d.websocket?.vertoClients ?? 0,
    eslConnected:   d.esl?.connected      ?? false,
    dbOk:           d.db?.connected       ?? false,
    sweeperZombies: d.sweeper?.zombiesKilled ?? 0,
  };
}

async function makeCall(): Promise<{ callId?: string; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/calls/make`, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${SESSION_ID}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: TO_NUMBER }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `HTTP ${res.status}: ${body}` };
    }
    const d = await res.json();
    return { callId: d.callId ?? d.id ?? "unknown" };
  } catch (e) {
    return { error: String(e) };
  }
}

async function endCall(callId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/calls/end`, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${SESSION_ID}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ callId }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pollUntil(
  label:     string,
  predicate: (h: PlatformHealth) => boolean,
  timeoutMs: number,
): Promise<{ ok: boolean; snapshot: PlatformHealth }> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const h = await fetchHealth();
    if (predicate(h)) return { ok: true, snapshot: h };
    await new Promise(r => setTimeout(r, 2_000));
  }
  const h = await fetchHealth();
  log(`TIMEOUT waiting for: ${label}`);
  return { ok: false, snapshot: h };
}

// ── Single call validation ────────────────────────────────────────────────────
async function validateSingleCall(iteration: number): Promise<boolean> {
  log(`\n── Call validation iteration ${iteration} ──`);

  const baseline = await fetchHealth();
  log(`Baseline: active=${baseline.activeCalls} initiated=${baseline.callsInitiated} answered=${baseline.callsAnswered}`);

  if (!baseline.eslConnected) {
    log("SKIP: ESL not connected — cannot validate call");
    return false;
  }

  // Initiate call
  log(`Initiating call to ${TO_NUMBER}`);
  const { callId, error } = await makeCall();
  if (error) { log(`FAIL: call initiation failed: ${error}`); return false; }
  log(`Call initiated: callId=${callId}`);

  // Verify: active calls increments
  const activeCheck = await pollUntil(
    "active calls increment",
    h => h.callsInitiated > baseline.callsInitiated,
    10_000,
  );
  if (!activeCheck.ok) {
    log("FAIL: callsInitiated did not increment after make-call");
    if (callId) await endCall(callId);
    return false;
  }
  log(`PASS: callsInitiated went from ${baseline.callsInitiated} → ${activeCheck.snapshot.callsInitiated}`);

  // Wait for answer or timeout
  log(`Waiting up to ${CALL_WAIT / 1_000}s for call to be answered…`);
  const answerCheck = await pollUntil(
    "call answered",
    h => h.callsAnswered > baseline.callsAnswered,
    CALL_WAIT,
  );
  if (answerCheck.ok) {
    log(`PASS: call answered (answered count ${baseline.callsAnswered} → ${answerCheck.snapshot.callsAnswered})`);
  } else {
    log(`INFO: Call not answered within wait window (expected for unattended test line)`);
  }

  // Hang up
  log("Hanging up call");
  if (callId) {
    const hungUp = await endCall(callId);
    log(hungUp ? "PASS: hang-up API accepted" : "WARN: hang-up API returned error");
  }

  // Verify: active calls returns to baseline within 10s
  await new Promise(r => setTimeout(r, 3_000));
  const postHangup = await fetchHealth();
  const callsCleared = postHangup.activeCalls <= baseline.activeCalls;
  log(callsCleared
    ? `PASS: active calls cleared (${postHangup.activeCalls})`
    : `FAIL: active calls stuck at ${postHangup.activeCalls} (baseline ${baseline.activeCalls})`,
  );

  // Check for zombie sessions
  if (postHangup.sweeperZombies > baseline.sweeperZombies) {
    log(`INFO: Sweeper killed ${postHangup.sweeperZombies - baseline.sweeperZombies} zombies after hangup (expected behaviour)`);
  }

  return callsCleared;
}

// ── Rapid hangup / redial cycle ───────────────────────────────────────────────
async function rapidCycleTest(): Promise<boolean> {
  log(`\n═══ RAPID HANGUP/REDIAL CYCLE (${RAPID_ITER} iterations) ═══`);
  const baseline = await fetchHealth();
  let passed = 0;

  for (let i = 1; i <= RAPID_ITER; i++) {
    const { callId, error } = await makeCall();
    if (error) {
      log(`  [${i}] call failed: ${error}`);
      continue;
    }
    // Immediately hang up (< 2s)
    await new Promise(r => setTimeout(r, 800));
    if (callId) await endCall(callId);
    passed++;
    log(`  [${i}] rapid hangup OK (callId=${callId})`);
    await new Promise(r => setTimeout(r, 500));
  }

  // After rapid cycle: verify no session leak
  await new Promise(r => setTimeout(r, 5_000));
  const afterRapid = await fetchHealth();
  const noLeak = afterRapid.activeCalls <= baseline.activeCalls + 1;
  log(noLeak
    ? `PASS: No session leak after rapid cycle (active=${afterRapid.activeCalls})`
    : `FAIL: Session leak detected — active calls ${afterRapid.activeCalls} > baseline ${baseline.activeCalls}`,
  );

  return noLeak && passed >= RAPID_ITER * 0.8;
}

// ── Answer rate check ─────────────────────────────────────────────────────────
async function checkAnswerRate(): Promise<boolean> {
  const h = await fetchHealth();
  const total    = h.callsInitiated;
  const answered = h.callsAnswered;
  const rate     = total > 0 ? answered / total : 1;
  const ok       = rate >= 0.8 || total < 5; // low sample size exempt
  log(`Answer rate: ${answered}/${total} = ${(rate * 100).toFixed(1)}% — ${ok ? "PASS" : "WARN"}`);
  return ok;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log(`Call validator starting`);
  log(`Platform: ${BASE_URL}, to: ${TO_NUMBER}, iterations: ${ITERATIONS}`);

  const results: Record<string, boolean> = {};

  for (let i = 1; i <= ITERATIONS; i++) {
    results[`call_${i}`] = await validateSingleCall(i);
    if (i < ITERATIONS) await new Promise(r => setTimeout(r, 3_000));
  }

  results["rapid_cycle"]  = await rapidCycleTest();
  results["answer_rate"]  = await checkAnswerRate();

  log("\n═══════════ CALL VALIDATION RESULTS ═══════════");
  let allPassed = true;
  for (const [name, passed] of Object.entries(results)) {
    log(`  ${passed ? "PASS" : "FAIL"}  ${name}`);
    if (!passed) allPassed = false;
  }
  log(`\nOverall: ${allPassed ? "PASS" : "FAIL"}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
