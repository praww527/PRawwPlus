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

test("NORMAL_CLEARING maps to completed", () => {
  assert.equal(causeToStatus("NORMAL_CLEARING"), "completed");
});

test("causeToLabel returns sensible default for empty cause", () => {
  assert.ok(causeToLabel("").length > 0);
});
