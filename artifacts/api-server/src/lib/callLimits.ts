import { CallModel } from "@workspace/db";
import { TERMINAL_CALL_STATUSES } from "./callStateMachine";

export {
  isValidFsCallId,
  maxConcurrentCallsPerUser,
  maxCoinsSpendPerDay,
  requireFsCallIdForExternal,
} from "./callLimitsCore";

export async function countActiveCallsForUser(userId: string): Promise<number> {
  const terminal = TERMINAL_CALL_STATUSES as unknown as string[];
  return CallModel.countDocuments({
    userId,
    endedAt: null,
    status: { $nin: terminal },
  });
}

/**
 * Force-close any calls for this user that have been stuck in a non-terminal
 * state for longer than `thresholdMs` (default 3 minutes).  Returns the
 * number of records closed.  Used to auto-clear stale initiated/ringing
 * entries that block new calls due to the concurrent-call limit.
 */
export async function clearStaleCallsForUser(
  userId: string,
  thresholdMs = 3 * 60 * 1000,
): Promise<number> {
  const terminal = TERMINAL_CALL_STATUSES as unknown as string[];
  const cutoff   = new Date(Date.now() - thresholdMs);
  const result   = await CallModel.updateMany(
    {
      userId,
      endedAt:   null,
      status:    { $nin: terminal },
      createdAt: { $lt: cutoff },
    },
    {
      $set: {
        status:     "failed",
        endedAt:    new Date(),
        failReason: "Stale call auto-cleared on new call attempt",
        duration:   0,
        cost:       0,
      },
    },
  );
  return result.modifiedCount;
}

/** Sum of `cost` for completed external calls since UTC midnight */
export async function sumExternalCoinsSpentTodayUtc(userId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const agg = await CallModel.aggregate<{ total: number }>([
    {
      $match: {
        userId,
        callType: "external",
        endedAt:  { $gte: start },
        cost:     { $gt: 0 },
      },
    },
    { $group: { _id: null, total: { $sum: "$cost" } } },
  ]);
  return agg[0]?.total ?? 0;
}
