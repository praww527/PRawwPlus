import { connectDB, RatePlanModel, UserModel } from "@workspace/db";

export async function resolveCoinsPerMinuteForUser(
  userId: string,
  destination: string,
): Promise<number> {
  await connectDB();

  const user = await UserModel.findById(userId).select("ratePlanId").lean();
  const ratePlanId = user?.ratePlanId;

  const plan = ratePlanId
    ? await RatePlanModel.findById(ratePlanId).lean()
    : await RatePlanModel.findOne({ isActive: true }).sort({ updatedAt: -1 }).lean();

  const defaultRate = plan?.defaultCoinsPerMinute ?? 1;
  const digits = String(destination ?? "").replace(/\D/g, "");
  if (!plan?.rates?.length || !digits) return defaultRate;

  let best = defaultRate;
  let bestLen = 0;
  for (const r of plan.rates) {
    const prefix = String(r.prefix ?? "").replace(/\D/g, "");
    if (!prefix) continue;
    if (digits.startsWith(prefix) && prefix.length > bestLen) {
      best = Number(r.coinsPerMinute) || defaultRate;
      bestLen = prefix.length;
    }
  }
  return best;
}

export function calcCoinsFromBillsec(billsec: number, coinsPerMinute: number): number {
  const s = Math.max(0, Math.floor(Number.isFinite(billsec) ? billsec : 0));
  if (s <= 0) return 0;
  const rate = Math.max(0, Number.isFinite(coinsPerMinute) ? coinsPerMinute : 0);
  if (rate <= 0) return 0;
  return Math.ceil((s / 60) * rate);
}
