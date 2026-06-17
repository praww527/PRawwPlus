import test from "node:test";
import assert from "node:assert/strict";
import { isHangupCauseOffline } from "./freeswitchESL";

// ── isHangupCauseOffline ──────────────────────────────────────────────────────
//
// This function drives the hold-window retry machinery: when it returns true
// the server suppresses the missed-call record and schedules re-originate
// attempts while the FreeSWITCH dialplan keeps the A-leg alive on ringback.
//
// CRITICAL: the set of offline causes here MUST match the dialplan conditions
// in freeswitchConfig.ts (lines with UNREGISTERED|USER_NOT_REGISTERED|
// SUBSCRIBER_ABSENT|DESTINATION_OUT_OF_ORDER) and the unavailable-forwarding
// block.  Any divergence means the dialplan holds the A-leg open but the
// server never retries — wasting the hold window.

test("UNREGISTERED is an offline cause", () => {
  assert.equal(isHangupCauseOffline("UNREGISTERED"), true);
});

test("USER_NOT_REGISTERED is an offline cause", () => {
  assert.equal(isHangupCauseOffline("USER_NOT_REGISTERED"), true);
});

test("SUBSCRIBER_ABSENT is an offline cause", () => {
  assert.equal(isHangupCauseOffline("SUBSCRIBER_ABSENT"), true);
});

test("DESTINATION_OUT_OF_ORDER is an offline cause (regression: was missing, caused hold-window retries to never fire)", () => {
  assert.equal(isHangupCauseOffline("DESTINATION_OUT_OF_ORDER"), true);
});

test("NO_ANSWER is NOT an offline cause (callee was reached but did not answer)", () => {
  assert.equal(isHangupCauseOffline("NO_ANSWER"), false);
});

test("USER_BUSY is NOT an offline cause", () => {
  assert.equal(isHangupCauseOffline("USER_BUSY"), false);
});

test("NORMAL_CLEARING is NOT an offline cause", () => {
  assert.equal(isHangupCauseOffline("NORMAL_CLEARING"), false);
});

test("NORMAL_TEMPORARY_FAILURE is NOT an offline cause (has its own one-shot retry path)", () => {
  assert.equal(isHangupCauseOffline("NORMAL_TEMPORARY_FAILURE"), false);
});

test("NO_ROUTE_DESTINATION is NOT an offline cause (unroutable — no retry makes sense)", () => {
  assert.equal(isHangupCauseOffline("NO_ROUTE_DESTINATION"), false);
});

test("empty string is NOT an offline cause", () => {
  assert.equal(isHangupCauseOffline(""), false);
});

test("unknown cause is NOT an offline cause", () => {
  assert.equal(isHangupCauseOffline("SOME_FUTURE_CAUSE"), false);
});
