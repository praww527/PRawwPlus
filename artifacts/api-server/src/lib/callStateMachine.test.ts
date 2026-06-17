import test from "node:test";
import assert from "node:assert/strict";
import {
  isTransitionAllowed,
  causeToStatus,
  causeToLabel,
  TERMINAL_CALL_STATUSES,
} from "./callStateMachine";

test("terminal states reject further transitions", () => {
  for (const s of TERMINAL_CALL_STATUSES) {
    assert.equal(isTransitionAllowed(s as string, "completed"), false);
  }
});

test('legacy "in-progress" normalizes to answered for transition checks', () => {
  assert.equal(isTransitionAllowed("in-progress", "completed"), true);
});

test("unknown from-state is not a free pass", () => {
  assert.equal(isTransitionAllowed("not-a-real-status", "completed"), false);
});

test("NO_ANSWER maps to missed", () => {
  assert.equal(causeToStatus("NO_ANSWER"), "missed");
});

test("NORMAL_CLEARING maps to ended", () => {
  assert.equal(causeToStatus("NORMAL_CLEARING"), "ended");
});

test("CALL_REJECTED maps to rejected", () => {
  assert.equal(causeToStatus("CALL_REJECTED"), "rejected");
});

test("ATTENDED_TRANSFER maps to voicemail", () => {
  assert.equal(causeToStatus("ATTENDED_TRANSFER"), "voicemail");
});

test("causeToLabel returns sensible default for empty cause", () => {
  assert.ok(causeToLabel("").length > 0);
});

test("DESTINATION_OUT_OF_ORDER maps to failed status", () => {
  assert.equal(causeToStatus("DESTINATION_OUT_OF_ORDER"), "failed");
});

test("DESTINATION_OUT_OF_ORDER maps to Destination unavailable label", () => {
  assert.equal(causeToLabel("DESTINATION_OUT_OF_ORDER"), "Destination unavailable");
});

test("UNREGISTERED maps to failed status", () => {
  assert.equal(causeToStatus("UNREGISTERED"), "failed");
});

test("USER_NOT_REGISTERED maps to failed status", () => {
  assert.equal(causeToStatus("USER_NOT_REGISTERED"), "failed");
});

test("SUBSCRIBER_ABSENT maps to failed status", () => {
  assert.equal(causeToStatus("SUBSCRIBER_ABSENT"), "failed");
});
