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
  AlertCircle, Plus, UserCircle2, PhoneCall, Users, X,
} from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const PLANS = [
  { id: "basic", name: "Basic", price: 59, maxNumbers: 1 },
  { id: "pro",   name: "Pro",   price: 109, maxNumbers: 2 },
] as const;

const CONTACT_EMAIL = "info@prawwplus.co.za";

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
  icon, iconBg = "bg-foreground/8", label, value, chevron = true, onClick, danger = false, className = "",
}: {
  icon: React.ReactNode; iconBg?: string; label: string; value?: string;
  chevron?: boolean; onClick?: () => void; danger?: boolean; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 w-full px-4 py-3.5 transition-colors text-left",
        onClick ? "active:bg-foreground/5 cursor-pointer hover:bg-foreground/5" : "cursor-default",
        className,
      )}
    >
      <div className={cn("w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0", iconBg)}>
        {icon}
      </div>
      <span className={cn("flex-1 text-sm font-medium", danger ? "text-red-400" : "text-foreground")}>
        {label}
      </span>
      {value && <span className="text-xs text-muted-foreground mr-1">{value}</span>}
      {chevron && onClick && (
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-1 pb-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
        {title}
      </p>
      <div className="glass rounded-2xl overflow-hidden divide-y divide-border">
        {children}
      </div>
    </div>
  );
}

type Sheet = "none" | "topup" | "plan" | "history" | "numbers" | "terms" | "privacy" | "contact";

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
  const [sheet, setSheet] = useState<Sheet>("none");
  const [topupAmount, setTopupAmount] = useState("50");
  const [selectedPlan, setSelectedPlan] = useState<"basic" | "pro">("basic");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const isActive      = user?.subscriptionStatus === "active";
  const currentPlan   = user?.subscriptionPlan ?? "basic";
  const coins         = user?.coins ?? 0;
  const myNumbers     = numbersData?.myNumbers ?? [];
  const maxNumbers    = numbersData?.maxNumbers ?? 1;
  const canAddMore    = myNumbers.length < maxNumbers;
  const primaryNumber = myNumbers[0]?.number ?? null;
  const recentPayments = paymentData?.payments?.slice(0, 20) ?? [];

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
        <div className="w-20 h-20 rounded-full bg-primary/15 border-2 border-primary/30 flex items-center justify-center">
          <UserCircle2 className="h-10 w-10 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-xl font-bold leading-tight" style={{ color: "hsl(var(--foreground))" }}>
            {user?.name || user?.username || "—"}
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {user?.email ?? user?.username ?? ""}
          </p>
          {primaryNumber && (
            <p className="text-sm font-mono text-muted-foreground mt-0.5">{primaryNumber}</p>
          )}
          <div className={cn(
            "inline-flex items-center gap-1 mt-2 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border",
            isActive
              ? "bg-green-500/12 text-green-500 border-green-500/22"
              : "bg-foreground/6 text-muted-foreground border-border",
          )}>
            {isActive ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
            {isActive ? `${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} · Active` : "No Active Plan"}
          </div>
        </div>
      </div>

      {/* ── Quick Stats ─────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: "Coins",
            value: coins.toString(),
            sub: "balance",
            color: "text-amber-400",
            bg: "bg-amber-500/10 border-amber-500/20",
          },
          {
            label: "Numbers",
            value: `${myNumbers.length}/${maxNumbers}`,
            sub: "assigned",
            color: "text-blue-400",
            bg: "bg-blue-500/10 border-blue-500/20",
          },
          {
            label: "Plan",
            value: isActive ? currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1) : "None",
            sub: isActive ? "active" : "inactive",
            color: isActive ? "text-green-400" : "text-muted-foreground",
            bg: isActive ? "bg-green-500/10 border-green-500/20" : "glass border-border",
          },
        ].map(({ label, value, sub, color, bg }) => (
          <div key={label} className={cn("flex flex-col items-center gap-0.5 py-3.5 rounded-2xl border glass", bg)}>
            <span className={cn("text-lg font-bold leading-tight", color)}>{value}</span>
            <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
            <span className="text-[9px] text-muted-foreground/60">{sub}</span>
          </div>
        ))}
      </div>

      {/* ── Quick Actions ──────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <PhoneCall className="h-5 w-5 text-green-400" />, label: "Call", bg: "bg-green-500/10 border-green-500/20", action: () => setLocation("/dashboard") },
          { icon: <Users className="h-5 w-5 text-blue-400" />, label: "Contacts", bg: "bg-blue-500/10 border-blue-500/20", action: () => setLocation("/contacts") },
          { icon: <Coins className="h-5 w-5 text-amber-400" />, label: "Top Up", bg: "bg-amber-500/10 border-amber-500/20", action: () => setSheet("topup") },
        ].map(({ icon, label, bg, action }) => (
          <button
            key={label}
            onClick={action}
            className={cn("flex flex-col items-center gap-1.5 py-3.5 rounded-2xl border glass transition-all active:scale-95", bg)}
          >
            {icon}
            <span className="text-[11px] font-semibold text-foreground/70">{label}</span>
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
          onClick={() => setSheet("terms")}
        />
        <SettingsRow
          icon={<ShieldCheck className="h-4 w-4 text-white" />}
          iconBg="bg-slate-600/70"
          label="Privacy Policy"
          onClick={() => setSheet("privacy")}
        />
        <SettingsRow
          icon={<HelpCircle className="h-4 w-4 text-white" />}
          iconBg="bg-blue-600/70"
          label="Help / Support"
          value={CONTACT_EMAIL}
          onClick={() => window.open(`mailto:${CONTACT_EMAIL}?subject=PRaww+ Support`, "_blank")}
        />
        <SettingsRow
          icon={<Mail className="h-4 w-4 text-white" />}
          iconBg="bg-teal-600/70"
          label="Contact Us"
          value={CONTACT_EMAIL}
          onClick={() => setSheet("contact")}
        />
      </Section>

      {/* ── Bottom actions ────────────────────────────── */}
      <div className="glass rounded-2xl overflow-hidden divide-y divide-border">
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
          onClick={() => window.open(`mailto:${CONTACT_EMAIL}?subject=Delete My Account&body=Please delete my account. Username/email: ${user?.email ?? user?.username ?? ""}`, "_blank")}
        />
      </div>

      <p className="text-center text-[10px] text-muted-foreground/50 pb-2">
        PRaww+ · {CONTACT_EMAIL}
      </p>

      {/* ── Sheet: Top Up ─────────────────────────────── */}
      {sheet === "topup" && (
        <Modal title="Top Up Coins" onClose={() => setSheet("none")}>
          <p className="text-xs text-muted-foreground text-center mb-4">1 coin ≈ R0.90 · ~1 min of call time</p>
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
                      : "glass border-border text-muted-foreground hover:text-foreground"
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
        </Modal>
      )}

      {/* ── Sheet: Plan picker ────────────────────────── */}
      {sheet === "plan" && (
        <Modal title="Subscription Plan" onClose={() => setSheet("none")}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {isActive
                  ? `${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} Plan — Active`
                  : "No Active Plan"}
              </p>
              {user?.nextPaymentDate && (
                <p className="text-xs text-muted-foreground mt-0.5">
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
                      ? "bg-violet-500/18 border-violet-500/35 text-violet-400"
                      : "bg-primary/18 border-primary/35 text-primary"
                    : "glass border-border text-muted-foreground"
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
        </Modal>
      )}

      {/* ── Sheet: Transaction History ─────────────────── */}
      {sheet === "history" && (
        <Modal title="Transaction History" onClose={() => setSheet("none")}>
          {recentPayments.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2">
              <Receipt className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground text-center">No transactions yet</p>
            </div>
          ) : (
            <div className="space-y-0 divide-y divide-border -mx-4">
              {recentPayments.map((p: PaymentRecord) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground capitalize">
                      {p.paymentType === "number_change" ? "Number Change" : p.paymentType}
                      {p.subscriptionPlan ? ` · ${p.subscriptionPlan}` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {format(new Date(p.createdAt), "MMM d, yyyy · h:mm a")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">R{p.amount.toFixed(2)}</p>
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
        </Modal>
      )}

      {/* ── Sheet: Phone Numbers ──────────────────────── */}
      {sheet === "numbers" && (
        <Modal title="Phone Numbers" onClose={() => setSheet("none")}>
          <p className="text-xs text-muted-foreground mb-3">{myNumbers.length}/{maxNumbers} numbers on {currentPlan} plan</p>
          {myNumbers.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2">
              <Phone className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground text-center">No numbers yet</p>
            </div>
          ) : (
            <div className="space-y-2 mb-3">
              {myNumbers.map((n: OwnedNumber) => (
                <div key={n.id} className="flex items-center gap-3 px-3 py-3 rounded-2xl glass border border-border">
                  <div className="w-8 h-8 rounded-full bg-green-500/12 border border-green-500/20 flex items-center justify-center shrink-0">
                    <Phone className="h-3.5 w-3.5 text-green-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-semibold text-foreground">{n.number}</p>
                    <p className="text-[10px] text-green-400 font-semibold">● Active</p>
                  </div>
                  <button
                    onClick={() => { setSheet("none"); setLocation(`/buy-number?mode=change&oldId=${n.id}&oldNumber=${encodeURIComponent(n.number)}`); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold glass border border-border text-muted-foreground hover:text-amber-400 hover:border-amber-500/25 transition-all active:scale-90"
                  >
                    <Shuffle className="h-3 w-3" /> Change
                  </button>
                  <button
                    onClick={() => handleRemoveNumber(n.id, n.number)}
                    disabled={removingId === n.id || removing}
                    className="w-7 h-7 rounded-xl glass border border-border flex items-center justify-center text-muted-foreground hover:text-red-400 hover:border-red-500/20 transition-all active:scale-90 disabled:opacity-40"
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
                : "glass border-border text-muted-foreground/50 cursor-not-allowed"
            )}
          >
            <Plus className="h-4 w-4" />
            {!isActive ? "Subscribe to buy numbers" : !canAddMore ? `Limit reached (${maxNumbers} max)` : "Add Number"}
          </button>
        </Modal>
      )}

      {/* ── Sheet: Terms of Service ────────────────────── */}
      {sheet === "terms" && (
        <Modal title="Terms of Service" onClose={() => setSheet("none")}>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p className="text-foreground font-semibold">Last updated: March 2025</p>

            <div>
              <p className="font-semibold text-foreground mb-1">1. Acceptance of Terms</p>
              <p>By accessing or using PRaww+, you agree to be bound by these Terms of Service. If you do not agree, you may not use the service.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">2. Service Description</p>
              <p>PRaww+ provides VoIP calling services, virtual phone number management, and related communication tools for users in South Africa.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">3. Subscriptions & Billing</p>
              <p>Subscriptions are billed monthly via PayFast. Your subscription renews automatically unless cancelled. Coin balances are non-refundable once purchased and consumed.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">4. Acceptable Use</p>
              <p>You agree not to use the service for spam, harassment, illegal activities, or any purpose that violates South African law. We reserve the right to suspend accounts found in violation.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">5. Limitation of Liability</p>
              <p>PRaww+ is provided "as is." We do not guarantee uninterrupted service and are not liable for any damages arising from use of the service.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">6. Changes to Terms</p>
              <p>We may update these terms at any time. Continued use of the service constitutes acceptance of updated terms.</p>
            </div>

            <div className="pt-2 border-t border-border">
              <p>Questions? Contact us at{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">{CONTACT_EMAIL}</a>
              </p>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Sheet: Privacy Policy ──────────────────────── */}
      {sheet === "privacy" && (
        <Modal title="Privacy Policy" onClose={() => setSheet("none")}>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p className="text-foreground font-semibold">Last updated: March 2025</p>

            <div>
              <p className="font-semibold text-foreground mb-1">1. Information We Collect</p>
              <p>We collect your name, email address, phone numbers you claim, call metadata (duration, timestamps), and payment records. We do not store call audio.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">2. How We Use Your Information</p>
              <p>Your data is used to provide the service, process payments, send account-related emails, and improve our platform. We do not sell your personal information.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">3. Data Storage & Security</p>
              <p>Your data is stored securely in encrypted databases. We use industry-standard security practices to protect your information. Payment processing is handled by PayFast.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">4. Third-Party Services</p>
              <p>We use Telnyx for VoIP services and PayFast for payments. These providers have their own privacy policies governing the data they process.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">5. Your Rights</p>
              <p>You may request access to, correction of, or deletion of your personal data at any time by contacting us. Account deletion requests are processed within 30 days.</p>
            </div>

            <div>
              <p className="font-semibold text-foreground mb-1">6. Contact</p>
              <p>For privacy-related queries, contact our data officer at{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">{CONTACT_EMAIL}</a>
              </p>
            </div>

            <div className="pt-2 border-t border-border">
              <p>We comply with the Protection of Personal Information Act (POPIA) of South Africa.</p>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Sheet: Contact Us ──────────────────────────── */}
      {sheet === "contact" && (
        <Modal title="Contact Us" onClose={() => setSheet("none")}>
          <div className="space-y-4">
            <div className="glass rounded-2xl border border-border p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-teal-500/15 border border-teal-500/25 flex items-center justify-center shrink-0 mt-0.5">
                <Mail className="h-4 w-4 text-teal-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Email Support</p>
                <p className="text-xs text-muted-foreground mt-0.5">We typically respond within 24 hours on business days.</p>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="inline-block mt-2 text-sm font-mono text-primary underline underline-offset-2"
                >
                  {CONTACT_EMAIL}
                </a>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => window.open(`mailto:${CONTACT_EMAIL}?subject=General Enquiry`, "_blank")}
                className="w-full py-3 rounded-2xl glass border border-border text-foreground text-sm font-semibold hover:border-primary/30 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Mail className="h-4 w-4" /> General Enquiry
              </button>
              <button
                onClick={() => window.open(`mailto:${CONTACT_EMAIL}?subject=Technical Support Request`, "_blank")}
                className="w-full py-3 rounded-2xl glass border border-border text-foreground text-sm font-semibold hover:border-blue-500/30 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <HelpCircle className="h-4 w-4" /> Technical Support
              </button>
              <button
                onClick={() => window.open(`mailto:${CONTACT_EMAIL}?subject=Billing Enquiry`, "_blank")}
                className="w-full py-3 rounded-2xl glass border border-border text-foreground text-sm font-semibold hover:border-amber-500/30 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <CreditCard className="h-4 w-4" /> Billing Enquiry
              </button>
            </div>

            <p className="text-[11px] text-muted-foreground text-center">
              PRaww+ · {CONTACT_EMAIL}
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end overlay-backdrop"
    >
      <div
        className="modal-surface border rounded-t-3xl px-4 pt-4 pb-8 animate-in slide-in-from-bottom-8 duration-300"
        style={{ maxHeight: "85dvh", overflowY: "auto" }}
      >
        <div className="flex items-center justify-between mb-5">
          <p className="text-base font-bold text-foreground">{title}</p>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full glass border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
