import { useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { useGetMe, useListPayments, useInitiateSubscription, useTopUpCredits } from "@workspace/api-client-react";
import {
  LogOut, CreditCard, Zap, Receipt,
  ShieldCheck, AlertCircle, CheckCircle2, Loader2, User, ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

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
  const { mutateAsync: subscribe, isPending: subscribing } = useInitiateSubscription();
  const { mutateAsync: topup, isPending: toppingUp } = useTopUpCredits();
  const { toast } = useToast();
  const [pfData, setPfData] = useState<any>(null);
  const [topupAmount, setTopupAmount] = useState("50");
  const [showTopup, setShowTopup] = useState(false);

  const handleSubscribe = async () => {
    try {
      const res = await subscribe();
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

  const isActive = user?.subscriptionStatus === "active";
  const recentPayments = paymentData?.payments?.slice(0, 5) ?? [];

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse pt-1">
        <div className="h-24 rounded-3xl glass" />
        <div className="h-48 rounded-3xl glass" />
        <div className="h-24 rounded-3xl glass" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-2">
      <PayFastRedirect data={pfData} />

      <div className="pt-1">
        <h1 className="text-2xl font-bold text-white">Profile</h1>
      </div>

      {/* Profile Card */}
      <div className="glass rounded-3xl p-4 border border-white/10 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0 overflow-hidden">
          {authUser?.profileImage ? (
            <img src={authUser.profileImage} alt="" className="w-full h-full object-cover" />
          ) : (
            <User className="h-7 w-7 text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-base truncate">
            {user?.name || user?.username}
          </p>
          <p className="text-sm text-white/40 truncate">@{user?.username}</p>
          {user?.isAdmin && (
            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-primary/12 border border-primary/22 text-primary">
              <ShieldCheck className="h-3 w-3" /> ADMIN
            </span>
          )}
        </div>
        <button
          onClick={logout}
          className="w-10 h-10 rounded-full glass border border-white/10 text-white/40 hover:text-red-400 hover:border-red-500/20 flex items-center justify-center transition-colors active:scale-90"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>

      {/* Balance + Subscription */}
      <div className="glass rounded-3xl p-5 border border-white/10 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-white/40 uppercase tracking-widest font-semibold mb-1">
              Credit Balance
            </p>
            <p
              className={cn(
                "text-4xl font-display font-bold",
                (user?.creditBalance ?? 0) > 10
                  ? "text-white"
                  : (user?.creditBalance ?? 0) > 0
                  ? "text-amber-400"
                  : "text-red-400"
              )}
            >
              R{(user?.creditBalance ?? 0).toFixed(2)}
            </p>
          </div>
          <div
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold",
              isActive
                ? "bg-green-500/12 text-green-400 border border-green-500/22"
                : "bg-red-500/10 text-red-400 border border-red-500/18"
            )}
          >
            {isActive ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5" />
            )}
            {isActive ? "Active" : "Inactive"}
          </div>
        </div>

        {user?.nextPaymentDate && (
          <p className="text-xs text-white/35">
            Renews {format(new Date(user.nextPaymentDate), "MMMM d, yyyy")}
          </p>
        )}

        <div className="border-t border-white/8 pt-4 space-y-3">
          {/* Subscribe */}
          <button
            onClick={handleSubscribe}
            disabled={subscribing}
            className="flex items-center justify-between w-full px-4 py-3.5 rounded-2xl bg-primary/12 border border-primary/22 hover:bg-primary/20 transition-all active:scale-[0.98] group"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center">
                <CreditCard className="h-4.5 w-4.5 text-primary" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-white">
                  {isActive ? "Renew Subscription" : "Subscribe Now"}
                </p>
                <p className="text-xs text-white/40">R100/month · R20 credit</p>
              </div>
            </div>
            {subscribing ? (
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
            ) : (
              <ChevronRight className="h-4 w-4 text-white/30 group-hover:text-primary transition-colors" />
            )}
          </button>

          {/* Top Up */}
          {!showTopup ? (
            <button
              onClick={() => setShowTopup(true)}
              className="flex items-center justify-between w-full px-4 py-3.5 rounded-2xl glass border border-white/10 hover:border-white/20 transition-all active:scale-[0.98] group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-amber-500/12 flex items-center justify-center">
                  <Zap className="h-4.5 w-4.5 text-amber-400" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-white">Top Up Credits</p>
                  <p className="text-xs text-white/40">Add more calling credit</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-white/30 group-hover:text-white transition-colors" />
            </button>
          ) : (
            <div className="px-4 py-4 rounded-2xl glass border border-amber-500/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-400" />
                  <p className="text-sm font-semibold text-white">Top Up Amount</p>
                </div>
                <button
                  onClick={() => setShowTopup(false)}
                  className="text-xs text-white/40 hover:text-white"
                >
                  Cancel
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {["20", "50", "100", "200"].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setTopupAmount(amt)}
                    className={cn(
                      "py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95",
                      topupAmount === amt
                        ? "bg-amber-500/20 border border-amber-500/35 text-amber-400"
                        : "glass border border-white/10 text-white/55 hover:text-white"
                    )}
                  >
                    R{amt}
                  </button>
                ))}
              </div>
              <button
                onClick={handleTopup}
                disabled={toppingUp}
                className="w-full py-3 rounded-2xl bg-amber-500/18 border border-amber-500/28 text-amber-400 text-sm font-semibold hover:bg-amber-500/28 transition-all active:scale-[0.98] flex items-center justify-center"
              >
                {toppingUp ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  `Pay R${topupAmount}`
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="glass rounded-2xl p-4 border border-white/10 text-center">
          <p className="text-2xl font-bold text-white">{user?.totalCallsUsed ?? 0}</p>
          <p className="text-xs text-white/40 mt-1">Total Calls</p>
        </div>
        <div className="glass rounded-2xl p-4 border border-white/10 text-center">
          <p className="text-2xl font-bold text-white">
            R{(user?.totalCreditUsed ?? 0).toFixed(2)}
          </p>
          <p className="text-xs text-white/40 mt-1">Total Spent</p>
        </div>
      </div>

      {/* Payment History */}
      {recentPayments.length > 0 && (
        <div className="glass rounded-3xl border border-white/10 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-white/8">
            <Receipt className="h-4 w-4 text-white/40" />
            <p className="text-sm font-semibold text-white">Recent Payments</p>
          </div>
          <div className="divide-y divide-white/8">
            {recentPayments.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-white capitalize">{p.paymentType}</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {format(new Date(p.createdAt), "MMM d, yyyy")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-white">R{p.amount.toFixed(2)}</p>
                  <p
                    className={cn(
                      "text-[10px] font-semibold uppercase tracking-wider",
                      p.status === "completed"
                        ? "text-green-400"
                        : p.status === "pending"
                        ? "text-amber-400"
                        : "text-red-400"
                    )}
                  >
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
