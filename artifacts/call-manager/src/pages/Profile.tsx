import { useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import {
  useGetMe, useListPayments, useInitiateSubscription,
  useTopUpCredits, useListMyNumbers, useRemoveNumber,
} from "@workspace/api-client-react";
import type { OwnedNumber, PaymentRecord } from "@workspace/api-client-react";
import {
  ChevronRight, LogOut, Trash2, User, Phone, Coins, Receipt,
  Star, Zap, Bell, Mic, Hash, FileText, ShieldCheck,
  HelpCircle, Mail, CreditCard, Loader2, Shuffle, CheckCircle2,
  AlertCircle, Plus, UserCircle2, PhoneCall, Users,
} from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const PLANS = [
  { id: "basic", name: "Basic", price: 59, maxNumbers: 1 },
  { id: "pro",   name: "Pro",   price: 109, maxNumbers: 2 },
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

function SettingsRow({
  icon, iconBg = "bg-white/8", label, value, chevron = true, onClick, danger = false, className = "",
}: {
  icon: React.ReactNode; iconBg?: string; label: string; value?: string;
  chevron?: boolean; onClick?: () => void; danger?: boolean; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 w-full px-4 py-3.5 transition-colors text-left",
        onClick ? "active:bg-white/5 cursor-pointer" : "cursor-default",
        className,
      )}
    >
      <div className={cn("w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0", iconBg)}>
        {icon}
      </div>
      <span className={cn("flex-1 text-sm font-medium", danger ? "text-red-400" : "text-white")}>
        {label}
      </span>
      {value && <span className="text-xs text-white/35 mr-1">{value}</span>}
      {chevron && onClick && (
        <ChevronRight className="h-3.5 w-3.5 text-white/25 shrink-0" />
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-1 pb-1.5 text-[11px] font-semibold text-white/35 uppercase tracking-widest">
        {title}
      </p>
      <div className="glass rounded-2xl border border-white/10 overflow-hidden divide-y divide-white/8">
        {children}
      </div>
    </div>
  );
}

export default function Profile() {
  const { logout } = useAuth();
  const { data: user, isLoading } = useGetMe();
  const { data: paymentData } = useListPayments();
  const { data: numbersData, refetch: refetchNumbers } = useListMyNumbers();
  const { mutateAsync: subscribe, isPending: subscribing } = useInitiateSubscription();
  const { mutateAsync: topup, isPending: toppingUp } = useTopUpCredits();
  const { mutateAsync: removeNum, isPending: removing } = useRemoveNumber();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [pfData, setPfData] = useState<any>(null);
  const [sheet, setSheet] = useState<"none" | "topup" | "plan" | "history" | "numbers">("none");
  const [topupAmount, setTopupAmount] = useState("50");
  const [selectedPlan, setSelectedPlan] = useState<"basic" | "pro">("basic");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const isActive   = user?.subscriptionStatus === "active";
  const currentPlan = user?.subscriptionPlan ?? "basic";
  const coins       = user?.coins ?? 0;
  const myNumbers   = numbersData?.myNumbers ?? [];
  const maxNumbers  = numbersData?.maxNumbers ?? 1;
  const canAddMore  = myNumbers.length < maxNumbers;
  const primaryNumber = myNumbers[0]?.number ?? null;
  const recentPayments = paymentData?.payments?.slice(0, 5) ?? [];

  const handleSubscribe = async () => {
    try {
      const res = await subscribe({ data: { plan: selectedPlan } });
      setPfData(res);
      setTimeout(() => (document.getElementById("pf-form") as HTMLFormElement)?.submit(), 100);
    } catch { toast({ title: "Failed to initiate payment", variant: "destructive" }); }
  };

  const handleTopup = async () => {
    const amount = parseFloat(topupAmount);
    if (!amount || amount < 10) { toast({ title: "Minimum top-up is R10", variant: "destructive" }); return; }
    try {
      const res = await topup({ data: { amount } });
      setPfData(res);
      setTimeout(() => (document.getElementById("pf-form") as HTMLFormElement)?.submit(), 100);
    } catch { toast({ title: "Failed to initiate top-up", variant: "destructive" }); }
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
    } finally { setRemovingId(null); }
  };

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse pt-1">
        <div className="h-28 rounded-2xl glass" />
        <div className="h-14 rounded-2xl glass" />
        <div className="h-48 rounded-2xl glass" />
        <div className="h-48 rounded-2xl glass" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-400 pb-6">
      <PayFastRedirect data={pfData} />

      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex flex-col items-center pt-3 pb-1 gap-2">
        <div className="w-16 h-16 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center">
          <UserCircle2 className="h-8 w-8 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-white leading-tight">
            {user?.name || user?.username || "—"}
          </p>
          {primaryNumber && (
            <p className="text-sm font-mono text-white/50 mt-0.5">{primaryNumber}</p>
          )}
          <div className={cn(
            "inline-flex items-center gap-1 mt-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full",
            isActive
              ? "bg-green-500/12 text-green-400 border border-green-500/22"
              : "bg-white/6 text-white/35 border border-white/10",
          )}>
            {isActive ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
            {isActive ? "Active" : "Inactive"}
          </div>
        </div>
      </div>

      {/* ── Quick Actions ──────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <PhoneCall className="h-5 w-5 text-green-400" />, label: "Call", bg: "bg-green-500/12 border-green-500/20", action: () => setLocation("/") },
          { icon: <Users className="h-5 w-5 text-blue-400" />, label: "Contacts", bg: "bg-blue-500/12 border-blue-500/20", action: () => setLocation("/contacts") },
          { icon: <Coins className="h-5 w-5 text-amber-400" />, label: "Top Up", bg: "bg-amber-500/12 border-amber-500/20", action: () => setSheet("topup") },
        ].map(({ icon, label, bg, action }) => (
          <button
            key={label}
            onClick={action}
            className={cn("flex flex-col items-center gap-1.5 py-3.5 rounded-2xl border glass transition-all active:scale-95", bg)}
          >
            {icon}
            <span className="text-[11px] font-semibold text-white/70">{label}</span>
          </button>
        ))}
      </div>

      {/* ── Account ───────────────────────────────────── */}
      <Section title="Account">
        <SettingsRow
          icon={<Hash className="h-4 w-4 text-white" />}
          iconBg="bg-blue-500/70"
          label="Phone Number"
          value={primaryNumber ?? "None"}
          onClick={() => setSheet("numbers")}
        />
        <SettingsRow
          icon={<Star className="h-4 w-4 text-white" />}
          iconBg="bg-amber-500/70"
          label="Subscription Plan"
          value={isActive ? `${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} · Active` : "None"}
          onClick={() => { setSelectedPlan(currentPlan as "basic" | "pro"); setSheet("plan"); }}
        />
        <SettingsRow
          icon={<Mail className="h-4 w-4 text-white" />}
          iconBg="bg-purple-500/70"
          label="Email / Login"
          value={user?.email ?? user?.username ?? ""}
          chevron={false}
        />
      </Section>

      {/* ── Billing ───────────────────────────────────── */}
      <Section title="Billing">
        <SettingsRow
          icon={<Coins className="h-4 w-4 text-white" />}
          iconBg="bg-amber-500/70"
          label="Coin Balance"
          value={`${coins} coins`}
          chevron={false}
        />
        <SettingsRow
          icon={<Plus className="h-4 w-4 text-white" />}
          iconBg="bg-green-500/70"
          label="Top Up Coins"
          onClick={() => setSheet("topup")}
        />
        <SettingsRow
          icon={<CreditCard className="h-4 w-4 text-white" />}
          iconBg="bg-indigo-500/70"
          label="Payment Methods"
          value="PayFast"
          chevron={false}
        />
        <SettingsRow
          icon={<Receipt className="h-4 w-4 text-white" />}
          iconBg="bg-slate-500/70"
          label="Transaction History"
          onClick={() => setSheet("history")}
        />
      </Section>

      {/* ── Preferences ───────────────────────────────── */}
      <Section title="Preferences">
        <SettingsRow
          icon={<Bell className="h-4 w-4 text-white" />}
          iconBg="bg-red-500/70"
          label="Notifications"
          value="Coming soon"
          chevron={false}
        />
        <SettingsRow
          icon={<Phone className="h-4 w-4 text-white" />}
          iconBg="bg-green-600/70"
          label="Call Settings"
          value="Coming soon"
          chevron={false}
        />
        <SettingsRow
          icon={<Mic className="h-4 w-4 text-white" />}
          iconBg="bg-orange-500/70"
          label="Caller ID"
          value={primaryNumber ?? "Not set"}
          chevron={false}
        />
      </Section>

      {/* ── Legal & Support ───────────────────────────── */}
      <Section title="Legal & Support">
        <SettingsRow
          icon={<FileText className="h-4 w-4 text-white" />}
          iconBg="bg-slate-600/70"
          label="Terms of Service"
          onClick={() => toast({ title: "Coming soon" })}
        />
        <SettingsRow
          icon={<ShieldCheck className="h-4 w-4 text-white" />}
          iconBg="bg-slate-600/70"
          label="Privacy Policy"
          onClick={() => toast({ title: "Coming soon" })}
        />
        <SettingsRow
          icon={<HelpCircle className="h-4 w-4 text-white" />}
          iconBg="bg-blue-600/70"
          label="Help / Support"
          onClick={() => toast({ title: "Coming soon" })}
        />
        <SettingsRow
          icon={<Mail className="h-4 w-4 text-white" />}
          iconBg="bg-teal-600/70"
          label="Contact Us"
          onClick={() => toast({ title: "Coming soon" })}
        />
      </Section>

      {/* ── Bottom actions ────────────────────────────── */}
      <div className="glass rounded-2xl border border-white/10 overflow-hidden divide-y divide-white/8">
        <SettingsRow
          icon={<LogOut className="h-4 w-4 text-red-400" />}
          iconBg="bg-red-500/12"
          label="Log Out"
          danger
          onClick={logout}
        />
        <SettingsRow
          icon={<Trash2 className="h-4 w-4 text-red-400" />}
          iconBg="bg-red-500/12"
          label="Delete Account"
          danger
          onClick={() => toast({ title: "Contact support to delete your account.", variant: "destructive" })}
        />
      </div>

      {/* ── Sheet: Top Up ─────────────────────────────── */}
      {sheet === "topup" && (
        <BottomSheet title="Top Up Coins" onClose={() => setSheet("none")}>
          <p className="text-xs text-white/40 text-center mb-4">1 coin = R0.90 · ~1 min of call time</p>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {["20", "50", "100", "200"].map((amt) => {
              const c = Math.floor(Number(amt) / 0.9);
              return (
                <button
                  key={amt}
                  onClick={() => setTopupAmount(amt)}
                  className={cn(
                    "py-3 rounded-xl text-xs font-bold transition-all active:scale-95 flex flex-col items-center gap-0.5 border",
                    topupAmount === amt
                      ? "bg-amber-500/20 border-amber-500/35 text-amber-400"
                      : "glass border-white/10 text-white/50 hover:text-white"
                  )}
                >
                  <span>R{amt}</span>
                  <span className="text-[9px] opacity-60">{c}c</span>
                </button>
              );
            })}
          </div>
          <button
            onClick={handleTopup}
            disabled={toppingUp}
            className="w-full py-3 rounded-2xl bg-amber-500/18 border border-amber-500/28 text-amber-400 text-sm font-semibold hover:bg-amber-500/28 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {toppingUp
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : `Pay R${topupAmount} → ${Math.floor(Number(topupAmount) / 0.9)} coins`}
          </button>
        </BottomSheet>
      )}

      {/* ── Sheet: Plan picker ────────────────────────── */}
      {sheet === "plan" && (
        <BottomSheet title="Subscription Plan" onClose={() => setSheet("none")}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-white">
                {isActive
                  ? `${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} Plan — Active`
                  : "No Active Plan"}
              </p>
              {user?.nextPaymentDate && (
                <p className="text-xs text-white/35 mt-0.5">
                  Renews {format(new Date(user.nextPaymentDate), "MMM d, yyyy")}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {PLANS.map((plan) => (
              <button
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                className={cn(
                  "p-4 rounded-2xl text-left border transition-all active:scale-95",
                  selectedPlan === plan.id
                    ? plan.id === "pro"
                      ? "bg-violet-500/18 border-violet-500/35 text-violet-300"
                      : "bg-primary/18 border-primary/35 text-primary"
                    : "glass border-white/10 text-white/50"
                )}
              >
                {plan.id === "pro" ? <Zap className="h-4 w-4 mb-2" /> : <Star className="h-4 w-4 mb-2" />}
                <p className="font-bold text-sm">{plan.name}</p>
                <p className="text-[11px] font-semibold opacity-80 mt-0.5">R{plan.price}/mo</p>
                <p className="text-[10px] opacity-55 mt-0.5">{plan.maxNumbers} number{plan.maxNumbers > 1 ? "s" : ""}</p>
              </button>
            ))}
          </div>
          <button
            onClick={handleSubscribe}
            disabled={subscribing}
            className="w-full py-3 rounded-2xl bg-primary/18 border border-primary/28 text-primary text-sm font-semibold hover:bg-primary/28 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {subscribing
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : `Pay R${PLANS.find(p => p.id === selectedPlan)?.price}/mo`}
          </button>
        </BottomSheet>
      )}

      {/* ── Sheet: Transaction History ─────────────────── */}
      {sheet === "history" && (
        <BottomSheet title="Transaction History" onClose={() => setSheet("none")}>
          {recentPayments.length === 0 ? (
            <p className="text-sm text-white/35 text-center py-4">No transactions yet</p>
          ) : (
            <div className="space-y-0 divide-y divide-white/8 -mx-4">
              {recentPayments.map((p: PaymentRecord) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-white capitalize">
                      {p.paymentType === "number_change" ? "Number Change" : p.paymentType}
                      {p.subscriptionPlan ? ` · ${p.subscriptionPlan}` : ""}
                    </p>
                    <p className="text-[11px] text-white/35 mt-0.5">
                      {format(new Date(p.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-white">R{p.amount.toFixed(2)}</p>
                    <p className={cn(
                      "text-[10px] font-semibold uppercase tracking-wider",
                      p.status === "completed" ? "text-green-400"
                        : p.status === "pending" ? "text-amber-400" : "text-red-400"
                    )}>{p.status}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </BottomSheet>
      )}

      {/* ── Sheet: Phone Numbers ──────────────────────── */}
      {sheet === "numbers" && (
        <BottomSheet title="Phone Numbers" onClose={() => setSheet("none")}>
          <p className="text-xs text-white/35 mb-3">{myNumbers.length}/{maxNumbers} numbers on {currentPlan} plan</p>
          {myNumbers.length === 0 ? (
            <p className="text-sm text-white/35 text-center py-4">No numbers yet</p>
          ) : (
            <div className="space-y-2 mb-3">
              {myNumbers.map((n: OwnedNumber) => (
                <div key={n.id} className="flex items-center gap-3 px-3 py-3 rounded-2xl glass border border-white/10">
                  <div className="w-8 h-8 rounded-full bg-green-500/12 border border-green-500/20 flex items-center justify-center shrink-0">
                    <Phone className="h-3.5 w-3.5 text-green-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-semibold text-white">{n.number}</p>
                    <p className="text-[10px] text-green-400 font-semibold">● Active</p>
                  </div>
                  <button
                    onClick={() => { setSheet("none"); setLocation(`/buy-number?mode=change&oldId=${n.id}&oldNumber=${encodeURIComponent(n.number)}`); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold glass border border-white/12 text-white/50 hover:text-amber-400 hover:border-amber-500/25 transition-all active:scale-90"
                  >
                    <Shuffle className="h-3 w-3" /> Change
                  </button>
                  <button
                    onClick={() => handleRemoveNumber(n.id, n.number)}
                    disabled={removingId === n.id || removing}
                    className="w-7 h-7 rounded-xl glass border border-white/10 flex items-center justify-center text-white/30 hover:text-red-400 hover:border-red-500/20 transition-all active:scale-90 disabled:opacity-40"
                  >
                    {removingId === n.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => { setSheet("none"); setLocation("/buy-number"); }}
            disabled={!isActive || !canAddMore}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold border transition-all active:scale-[0.98]",
              isActive && canAddMore
                ? "bg-primary/14 border-primary/24 text-primary hover:bg-primary/24"
                : "glass border-white/10 text-white/25 cursor-not-allowed"
            )}
          >
            <Plus className="h-4 w-4" />
            {!isActive ? "Subscribe to buy numbers" : !canAddMore ? `Limit reached (${maxNumbers} max)` : "Add Number"}
          </button>
        </BottomSheet>
      )}
    </div>
  );
}

function BottomSheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
      <div
        className="glass border border-white/12 rounded-t-3xl px-4 pt-4 pb-8 animate-in slide-in-from-bottom-8 duration-300"
        style={{ maxHeight: "80dvh", overflowY: "auto" }}
      >
        <div className="flex items-center justify-between mb-5">
          <p className="text-base font-bold text-white">{title}</p>
          <button onClick={onClose} className="text-white/40 hover:text-white text-sm font-medium transition-colors">
            Done
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
