import { useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { useGetMe, useListPayments, useInitiateSubscription, useTopUpCredits, useListMyNumbers, useRemoveNumber } from "@workspace/api-client-react";
import type { OwnedNumber, PaymentRecord } from "@workspace/api-client-react";
import {
  LogOut, Coins, Zap, Receipt,
  ShieldCheck, AlertCircle, CheckCircle2, Loader2, User, ChevronRight, Star,
  Phone, Plus, Shuffle, Trash2, Hash,
} from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const PLANS = [
  { id: "basic", name: "Basic", price: 59, maxNumbers: 1, color: "primary", icon: Star },
  { id: "pro", name: "Pro", price: 109, maxNumbers: 2, color: "violet", icon: Zap },
] as const;

function PayFastRedirect({ data }: { data: any }) {
  if (!data) return null;
  return (
    <form method="POST" action={data.paymentUrl} target="_self" className="hidden" id="pf-form">
      {Object.entries(data.formFields as Record<string, string>).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </form>
  );
}

export default function Profile() {
  const { user: authUser, logout } = useAuth();
  const { data: user, isLoading } = useGetMe();
  const { data: paymentData } = useListPayments();
  const { data: numbersData, refetch: refetchNumbers } = useListMyNumbers();
  const { mutateAsync: subscribe, isPending: subscribing } = useInitiateSubscription();
  const { mutateAsync: topup, isPending: toppingUp } = useTopUpCredits();
  const { mutateAsync: removeNum, isPending: removing } = useRemoveNumber();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [pfData, setPfData] = useState<any>(null);
  const [topupAmount, setTopupAmount] = useState("50");
  const [showTopup, setShowTopup] = useState(false);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"basic" | "pro">("basic");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleSubscribe = async () => {
    try {
      const res = await subscribe({ data: { plan: selectedPlan } });
      setPfData(res);
      setTimeout(() => {
        (document.getElementById("pf-form") as HTMLFormElement)?.submit();
      }, 100);
    } catch {
      toast({ title: "Failed to initiate payment", variant: "destructive" });
    }
  };

  const handleTopup = async () => {
    const amount = parseFloat(topupAmount);
    if (!amount || amount < 10) {
      toast({ title: "Minimum top-up is R10", variant: "destructive" });
      return;
    }
    try {
      const res = await topup({ data: { amount } });
      setPfData(res);
      setTimeout(() => {
        (document.getElementById("pf-form") as HTMLFormElement)?.submit();
      }, 100);
    } catch {
      toast({ title: "Failed to initiate top-up", variant: "destructive" });
    }
  };

  const handleRemoveNumber = async (id: string, number: string) => {
    if (!confirm(`Remove ${number}? This cannot be undone.`)) return;
    setRemovingId(id);
    try {
      await removeNum({ id });
      toast({ title: "Number removed", description: `${number} has been released.` });
      refetchNumbers();
    } catch (err: any) {
      toast({ title: "Failed to remove number", description: err?.message, variant: "destructive" });
    } finally {
      setRemovingId(null);
    }
  };

  const isActive = user?.subscriptionStatus === "active";
  const currentPlan = user?.subscriptionPlan ?? "basic";
  const coins = user?.coins ?? 0;
  const recentPayments = paymentData?.payments?.slice(0, 5) ?? [];
  const myNumbers = numbersData?.myNumbers ?? [];
  const maxNumbers = numbersData?.maxNumbers ?? 1;
  const canAddMore = myNumbers.length < maxNumbers;

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse pt-1">
        <div className="h-16 rounded-2xl glass" />
        <div className="h-36 rounded-2xl glass" />
        <div className="h-24 rounded-2xl glass" />
        <div className="h-16 rounded-2xl glass" />
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-400 pb-2">
      <PayFastRedirect data={pfData} />

      <h1 className="text-xl font-bold text-white pt-1">Profile</h1>

      {/* Profile Card */}
      <div className="glass rounded-2xl px-3.5 py-3 border border-white/10 flex items-center gap-3">
        <div className="w-11 h-11 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0 overflow-hidden">
          {authUser?.profileImage ? (
            <img src={authUser.profileImage} alt="" className="w-full h-full object-cover" />
          ) : (
            <User className="h-5 w-5 text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-sm truncate">{user?.name || user?.username}</p>
          <p className="text-xs text-white/40 truncate">@{user?.username}</p>
          {user?.isAdmin && (
            <span className="inline-flex items-center gap-1 mt-0.5 text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-primary/12 border border-primary/22 text-primary">
              <ShieldCheck className="h-2.5 w-2.5" /> ADMIN
            </span>
          )}
        </div>
        <button
          onClick={logout}
          className="w-9 h-9 rounded-full glass border border-white/10 text-white/40 hover:text-red-400 hover:border-red-500/20 flex items-center justify-center transition-colors active:scale-90"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* My Numbers */}
      <div className="glass rounded-2xl border border-white/10 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
          <Hash className="h-3.5 w-3.5 text-primary" />
          <p className="text-sm font-semibold text-white">My Numbers</p>
          <span className="ml-auto text-[11px] text-white/30">{myNumbers.length}/{maxNumbers}</span>
        </div>

        {myNumbers.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <Phone className="h-8 w-8 text-white/15 mx-auto mb-2" />
            <p className="text-sm text-white/40">No numbers purchased yet</p>
            <p className="text-xs text-white/25 mt-0.5">Buy a number to start making calls</p>
          </div>
        ) : (
          <div className="divide-y divide-white/8">
            {myNumbers.map((n: OwnedNumber) => (
              <div key={n.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-full bg-green-500/12 border border-green-500/20 flex items-center justify-center shrink-0">
                  <Phone className="h-3.5 w-3.5 text-green-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm font-semibold text-white">{n.number}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-semibold text-green-400">● Active</span>
                    <span className="text-[10px] text-white/30">·</span>
                    <span className="text-[10px] text-white/35">{coins} coins</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setLocation(`/buy-number?mode=change&oldId=${n.id}&oldNumber=${encodeURIComponent(n.number)}`)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold glass border border-white/12 text-white/50 hover:text-amber-400 hover:border-amber-500/25 transition-all active:scale-90"
                  >
                    <Shuffle className="h-3 w-3" />
                    Change
                  </button>
                  <button
                    onClick={() => handleRemoveNumber(n.id, n.number)}
                    disabled={removingId === n.id || removing}
                    className="w-7 h-7 rounded-xl glass border border-white/10 flex items-center justify-center text-white/30 hover:text-red-400 hover:border-red-500/20 transition-all active:scale-90 disabled:opacity-40"
                  >
                    {removingId === n.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-4 py-3 border-t border-white/8">
          <button
            onClick={() => setLocation("/buy-number")}
            disabled={!isActive}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all border active:scale-[0.98]",
              isActive && canAddMore
                ? "bg-primary/14 border-primary/24 text-primary hover:bg-primary/24"
                : isActive && !canAddMore
                ? "glass border-white/10 text-white/30 cursor-not-allowed"
                : "glass border-white/10 text-white/25 cursor-not-allowed"
            )}
          >
            <Plus className="h-4 w-4" />
            {!isActive
              ? "Subscribe to buy numbers"
              : !canAddMore
              ? `Limit reached (${maxNumbers} max on ${currentPlan})`
              : "Add Another Number"}
          </button>
        </div>
      </div>

      {/* Balance */}
      <div className="glass rounded-2xl px-4 py-3.5 border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold mb-0.5">
              Coin Balance
            </p>
            <div className="flex items-baseline gap-1.5">
              <p className={cn(
                "text-3xl font-display font-bold leading-none",
                coins > 20 ? "text-white" : coins > 5 ? "text-amber-400" : "text-red-400"
              )}>
                {coins}
              </p>
              <span className="text-xs text-white/30">coins</span>
            </div>
            <p className="text-[11px] text-white/30 mt-1">1 Coin = R0.90</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold",
              isActive
                ? "bg-green-500/12 text-green-400 border border-green-500/22"
                : "bg-red-500/10 text-red-400 border border-red-500/18"
            )}>
              {isActive ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {isActive ? "Active" : "Inactive"}
            </div>
            {isActive && (
              <span className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full",
                currentPlan === "pro"
                  ? "bg-violet-500/12 text-violet-400 border border-violet-500/18"
                  : "bg-primary/10 text-primary border border-primary/18"
              )}>
                {currentPlan.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        <div className="border-t border-white/8 pt-3">
          {!showTopup ? (
            <button
              onClick={() => setShowTopup(true)}
              className="flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl glass border border-white/10 hover:border-white/20 transition-all active:scale-[0.98] group"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-amber-500/12 flex items-center justify-center shrink-0">
                  <Coins className="h-4 w-4 text-amber-400" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-white leading-snug">Top Up Coins</p>
                  <p className="text-[11px] text-white/40">1 coin = R0.90 · 0.89 coins/min</p>
                </div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-white/30 group-hover:text-white transition-colors" />
            </button>
          ) : (
            <div className="px-3.5 py-3 rounded-xl glass border border-amber-500/20 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Coins className="h-3.5 w-3.5 text-amber-400" />
                  <p className="text-sm font-semibold text-white">Top Up Amount</p>
                </div>
                <button onClick={() => setShowTopup(false)} className="text-[11px] text-white/40 hover:text-white">Cancel</button>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {["20", "50", "100", "200"].map((amt) => {
                  const coins = Math.floor(Number(amt) / 0.9);
                  return (
                    <button
                      key={amt}
                      onClick={() => setTopupAmount(amt)}
                      className={cn(
                        "py-2 rounded-xl text-xs font-bold transition-all active:scale-95 flex flex-col items-center",
                        topupAmount === amt
                          ? "bg-amber-500/20 border border-amber-500/35 text-amber-400"
                          : "glass border border-white/10 text-white/50 hover:text-white"
                      )}
                    >
                      <span>R{amt}</span>
                      <span className="text-[9px] opacity-60">{coins}c</span>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={handleTopup}
                disabled={toppingUp}
                className="w-full py-2.5 rounded-xl bg-amber-500/18 border border-amber-500/28 text-amber-400 text-sm font-semibold hover:bg-amber-500/28 transition-all active:scale-[0.98] flex items-center justify-center"
              >
                {toppingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : `Pay R${topupAmount} → ${Math.floor(Number(topupAmount) / 0.9)} coins`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Subscription */}
      <div className="glass rounded-2xl px-4 py-3.5 border border-white/10 space-y-3">
        <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold">Subscription</p>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-white">
              {isActive ? `${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} Plan` : "No Active Plan"}
            </p>
            <p className="text-xs text-white/40 mt-0.5">
              {isActive
                ? `R${currentPlan === "pro" ? "109" : "59"}/month · ${numbersData?.maxNumbers ?? 1} number${(numbersData?.maxNumbers ?? 1) > 1 ? "s" : ""}`
                : "Subscribe to access phone numbers"}
            </p>
            {user?.nextPaymentDate && (
              <p className="text-[10px] text-white/30 mt-1">
                Renews {format(new Date(user.nextPaymentDate), "MMM d, yyyy")}
              </p>
            )}
          </div>
        </div>

        {!showPlanPicker ? (
          <button
            onClick={() => { setShowPlanPicker(true); setSelectedPlan(currentPlan as "basic" | "pro"); }}
            className="flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl bg-primary/12 border border-primary/22 hover:bg-primary/20 transition-all active:scale-[0.98] group"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <Star className="h-4 w-4 text-primary" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-white leading-snug">
                  {isActive ? "Change / Renew Plan" : "Subscribe Now"}
                </p>
                <p className="text-[11px] text-white/40">Basic R59 · Pro R109/month</p>
              </div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-white/30 group-hover:text-primary transition-colors" />
          </button>
        ) : (
          <div className="rounded-xl glass border border-primary/20 space-y-2.5 p-3.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Choose Plan</p>
              <button onClick={() => setShowPlanPicker(false)} className="text-[11px] text-white/40 hover:text-white">Cancel</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PLANS.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan.id)}
                  className={cn(
                    "p-3 rounded-xl text-left transition-all border active:scale-95",
                    selectedPlan === plan.id
                      ? plan.id === "pro"
                        ? "bg-violet-500/18 border-violet-500/35 text-violet-300"
                        : "bg-primary/18 border-primary/35 text-primary"
                      : "glass border-white/10 text-white/50"
                  )}
                >
                  <plan.icon className="h-4 w-4 mb-1.5" />
                  <p className="font-bold text-sm">{plan.name}</p>
                  <p className="text-[11px] font-semibold opacity-80">R{plan.price}/mo</p>
                  <p className="text-[10px] opacity-60 mt-0.5">{plan.maxNumbers} number{plan.maxNumbers > 1 ? "s" : ""}</p>
                </button>
              ))}
            </div>
            <button
              onClick={handleSubscribe}
              disabled={subscribing}
              className="w-full py-2.5 rounded-xl bg-primary/18 border border-primary/28 text-primary text-sm font-semibold hover:bg-primary/28 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {subscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : `Pay R${PLANS.find(p => p.id === selectedPlan)?.price}`}
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="glass rounded-2xl px-4 py-3 border border-white/10 text-center">
          <p className="text-xl font-bold text-white">{user?.totalCallsUsed ?? 0}</p>
          <p className="text-[11px] text-white/40 mt-0.5">Total Calls</p>
        </div>
        <div className="glass rounded-2xl px-4 py-3 border border-white/10 text-center">
          <p className="text-xl font-bold text-white">{user?.totalCoinsUsed ?? 0}</p>
          <p className="text-[11px] text-white/40 mt-0.5">Coins Used</p>
        </div>
      </div>

      {/* Payment History */}
      {recentPayments.length > 0 && (
        <div className="glass rounded-2xl border border-white/10 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
            <Receipt className="h-3.5 w-3.5 text-white/40" />
            <p className="text-sm font-semibold text-white">Recent Payments</p>
          </div>
          <div className="divide-y divide-white/8">
            {recentPayments.map((p: PaymentRecord) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-white capitalize">
                    {p.paymentType === "number_change" ? "Number Change" : p.paymentType}
                    {p.subscriptionPlan ? ` · ${p.subscriptionPlan}` : ""}
                  </p>
                  <p className="text-[11px] text-white/40 mt-0.5">
                    {format(new Date(p.createdAt), "MMM d, yyyy")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-white">R{p.amount.toFixed(2)}</p>
                  <p className={cn(
                    "text-[10px] font-semibold uppercase tracking-wider",
                    p.status === "completed" ? "text-green-400" :
                    p.status === "pending" ? "text-amber-400" : "text-red-400"
                  )}>
                    {p.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
