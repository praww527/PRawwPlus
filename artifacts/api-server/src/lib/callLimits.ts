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
