import test from "node:test";
import assert from "node:assert/strict";
import { isValidFsCallId, maxConcurrentCallsPerUser, requireFsCallIdForExternal } from "./callLimitsCore";

test("isValidFsCallId accepts standard UUID", () => {
  assert.equal(isValidFsCallId("550e8400-e29b-41d4-a716-446655440000"), true);
});

test("isValidFsCallId rejects garbage", () => {
  assert.equal(isValidFsCallId("not-a-uuid"), false);
  assert.equal(isValidFsCallId(""), false);
  assert.equal(isValidFsCallId(null), false);
});

test("maxConcurrentCallsPerUser parses env", () => {
  const prev = process.env.MAX_CONCURRENT_CALLS_PER_USER;
  process.env.MAX_CONCURRENT_CALLS_PER_USER = "2";
  assert.equal(maxConcurrentCallsPerUser(), 2);
  if (prev === undefined) delete process.env.MAX_CONCURRENT_CALLS_PER_USER;
  else process.env.MAX_CONCURRENT_CALLS_PER_USER = prev;
});

test("requireFsCallIdForExternal respects env", () => {
  const prev = process.env.REQUIRE_FS_CALL_ID_EXTERNAL;
  delete process.env.REQUIRE_FS_CALL_ID_EXTERNAL;
  assert.equal(requireFsCallIdForExternal(), false);
  process.env.REQUIRE_FS_CALL_ID_EXTERNAL = "true";
  assert.equal(requireFsCallIdForExternal(), true);
  if (prev === undefined) delete process.env.REQUIRE_FS_CALL_ID_EXTERNAL;
  else process.env.REQUIRE_FS_CALL_ID_EXTERNAL = prev;
});
