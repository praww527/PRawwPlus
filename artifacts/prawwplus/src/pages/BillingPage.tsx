import { useState, useEffect } from "react";
import { CreditCard, RefreshCw, Receipt, Wallet, Zap, Infinity, Building2, TrendingDown, ExternalLink, MessageCircle } from "lucide-react";
import { format } from "date-fns";

function getCsrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function apiFetch(path: string, opts?: RequestInit) {
  const method = (opts?.method ?? "GET").toUpperCase();
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(["POST","PUT","PATCH","DELETE"].includes(method) ? { "X-CSRF-Token": getCsrf() } : {}),
    },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

type Tab = "overview" | "payments";

function fmtMoney(amount: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount ?? 0);
}

function planIcon(planId?: string) {
  if (planId === "unlimited") return <Infinity size={18} className="text-indigo-400" />;
  if (planId === "custom")    return <Building2 size={18} className="text-amber-400" />;
  return <Zap size={18} className="text-green-400" />;
}

function PlanBadge({ planId }: { planId?: string }) {
  const classes: Record<string, string> = {
    payg:      "bg-green-500/10 text-green-400 border-green-500/20",
    unlimited: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
    custom:    "bg-amber-500/10 text-amber-400 border-amber-500/20",
  };
  const labels: Record<string, string> = {
    payg:      "Pay As You Go",
    unlimited: "Unlimited",
    custom:    "Custom Plan",
  };
  const id = planId ?? "payg";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${classes[id] ?? classes.payg}`}>
      {labels[id] ?? id}
    </span>
  );
}

function MinutesBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-indigo-500";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-white/40">
        <span>{used} min used</span>
        <span>{Math.max(0, total - used)} min remaining</span>
      </div>
      <div className="h-2 rounded-full bg-white/10">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-white/30">{total} min bundle · resets monthly</p>
    </div>
  );
}

export default function BillingPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [billing, setBilling]   = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState("50");
  const [topupLoading, setTopupLoading] = useState(false);
  const [subLoading, setSubLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [bData, pData] = await Promise.allSettled([
        apiFetch("/billing/summary"),
        apiFetch("/payments/history"),
      ]);
      if (bData.status === "fulfilled") setBilling(bData.value);
      if (pData.status === "fulfilled") setPayments(pData.value.payments ?? pData.value ?? []);
      if (bData.status === "rejected" && pData.status === "rejected") {
        setError((bData as any).reason?.message ?? "Failed to load billing data");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleTopup() {
    const amount = parseFloat(topupAmount);
    if (isNaN(amount) || amount < 50) {
      alert("Minimum recharge is R50");
      return;
    }
    setTopupLoading(true);
    try {
      const data = await apiFetch("/credits/topup", {
        method: "POST",
        body: JSON.stringify({ amount }),
      });
      if (data.paymentUrl && data.formFields) {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = data.paymentUrl;
        Object.entries(data.formFields).forEach(([k, v]) => {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = k;
          input.value = String(v);
          form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
      }
    } catch (e: any) {
      alert(e.message ?? "Top-up failed");
    } finally {
      setTopupLoading(false);
    }
  }

  async function handleSubscribe(plan: string) {
    setSubLoading(true);
    try {
      const data = await apiFetch("/payments/subscribe", {
        method: "POST",
        body: JSON.stringify({ plan }),
      });
      if (data.paymentUrl && data.formFields) {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = data.paymentUrl;
        Object.entries(data.formFields).forEach(([k, v]) => {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = k;
          input.value = String(v);
          form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
      }
    } catch (e: any) {
      alert(e.message ?? "Subscription failed");
    } finally {
      setSubLoading(false);
    }
  }

  const planId = billing?.planId ?? "payg";

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "overview", label: "Overview", icon: <Wallet size={13} /> },
    { key: "payments", label: "History",  icon: <Receipt size={13} /> },
  ];

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="text-indigo-400" size={22} />
          <h1 className="text-xl font-bold text-white">Billing</h1>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors">
          <RefreshCw size={13} />Refresh
        </button>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-white/5 w-fit">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${tab === t.key ? "bg-indigo-600 text-white" : "text-white/50 hover:text-white/80"}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-white/40 text-sm">Loading billing data…</div>
      ) : tab === "overview" ? (
        <div className="space-y-4">

          {/* Current Plan */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-white/40 mb-1">Current Plan</p>
                <div className="flex items-center gap-2">
                  {planIcon(planId)}
                  <span className="text-xl font-bold text-white">{billing?.planName ?? "Pay As You Go"}</span>
                  <PlanBadge planId={planId} />
                </div>
              </div>
              <div className="text-right">
                {planId === "custom" ? (
                  <p className="text-sm text-amber-400 font-medium">Contact Sales</p>
                ) : (
                  <>
                    <p className="text-2xl font-bold text-white">{fmtMoney(billing?.monthlyFee ?? 0)}</p>
                    <p className="text-xs text-white/40">per month</p>
                  </>
                )}
              </div>
            </div>

            {planId !== "custom" && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Included Minutes", value: billing?.includedMinutes > 0 ? `${billing.includedMinutes} min` : "—" },
                  { label: "Call Rate",         value: `R${(billing?.ratePerMinute ?? 0.69).toFixed(2)}/min` },
                  { label: "Status",            value: billing?.subscriptionStatus === "active" ? "Active" : "Inactive" },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl bg-white/5 p-3 text-center">
                    <p className="text-xs text-white/40 mb-1">{label}</p>
                    <p className="text-sm font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Unlimited: minutes bar */}
            {planId === "unlimited" && (billing?.includedMinutes ?? 0) > 0 && (
              <MinutesBar used={billing?.monthlyMinutesUsed ?? 0} total={billing?.includedMinutes ?? 500} />
            )}

            {/* Custom plan contact info */}
            {planId === "custom" && (
              <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4 space-y-3">
                <p className="text-sm text-white/70">Your plan is managed by PRaww+ admin. Contact sales for pricing details or changes.</p>
                <div className="flex gap-2 flex-wrap">
                  <a href="mailto:sales@praww.co.za"
                    className="inline-flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg text-white/80 transition-colors">
                    <ExternalLink size={11} />sales@praww.co.za
                  </a>
                  <a href="https://wa.me/27000000000" target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 px-3 py-1.5 rounded-lg text-green-400 transition-colors">
                    <MessageCircle size={11} />WhatsApp
                  </a>
                </div>
              </div>
            )}

            {/* Upgrade / pay subscription */}
            {planId !== "custom" && billing?.subscriptionStatus !== "active" && (
              <div className="pt-1">
                <button disabled={subLoading} onClick={() => handleSubscribe(planId)}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors">
                  {subLoading ? "Redirecting…" : `Pay ${fmtMoney(billing?.monthlyFee ?? 49)}/month via PayFast`}
                </button>
                <p className="text-xs text-white/30 text-center mt-1.5">Secure payment via PayFast</p>
              </div>
            )}
          </div>

          {/* Wallet Balance */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-white/40 mb-1">Wallet Balance</p>
                <p className="text-3xl font-bold text-white">{fmtMoney(billing?.walletBalance ?? 0)}</p>
                <p className="text-xs text-white/30 mt-0.5">{billing?.coins ?? 0} coins · R0.90/coin</p>
              </div>
              {(billing?.walletBalance ?? 0) < 20 && (
                <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
                  <TrendingDown size={11} />Low balance
                </div>
              )}
            </div>

            {/* Recharge */}
            <div className="space-y-2">
              <p className="text-xs text-white/40 font-medium">Recharge Wallet</p>
              <div className="grid grid-cols-4 gap-2">
                {[50, 100, 200, 500].map((amt) => (
                  <button key={amt}
                    onClick={() => setTopupAmount(String(amt))}
                    className={`text-sm font-medium py-2 rounded-xl border transition-colors ${topupAmount === String(amt) ? "bg-indigo-600 border-indigo-500 text-white" : "bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10"}`}>
                    R{amt}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="50"
                  step="10"
                  value={topupAmount}
                  onChange={(e) => setTopupAmount(e.target.value)}
                  placeholder="Custom amount (min R50)"
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button disabled={topupLoading} onClick={handleTopup}
                  className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors whitespace-nowrap">
                  {topupLoading ? "…" : "Recharge"}
                </button>
              </div>
              <p className="text-xs text-white/30">Minimum recharge R50 · Secure via PayFast</p>
            </div>
          </div>

          {/* PAYG info box */}
          {planId === "payg" && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/40 mb-2">How Pay As You Go works</p>
              <div className="space-y-2 text-sm text-white/60">
                <div className="flex gap-2"><span className="text-green-400 font-bold">1.</span>Pay R49/month subscription</div>
                <div className="flex gap-2"><span className="text-green-400 font-bold">2.</span>Recharge your wallet (min R50)</div>
                <div className="flex gap-2"><span className="text-green-400 font-bold">3.</span>Calls billed at R0.69/minute from your wallet</div>
                <div className="flex gap-2"><span className="text-green-400 font-bold">4.</span>Top up anytime — no expiry</div>
              </div>
            </div>
          )}

          {/* Unlimited plan upgrade CTA */}
          {planId === "payg" && (
            <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Infinity size={15} className="text-indigo-400" />
                  <span className="text-sm font-semibold text-white">Upgrade to Unlimited</span>
                </div>
                <p className="text-xs text-white/50">R299/month · 500 minutes included · R0.69/min after</p>
              </div>
              <button disabled={subLoading} onClick={() => handleSubscribe("unlimited")}
                className="shrink-0 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                Upgrade
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Payments History */
        payments.length === 0 ? (
          <div className="text-center py-16 text-white/40 text-sm">No payment history found.</div>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p._id} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${p.paymentType === "subscription" ? "bg-indigo-500/15" : "bg-green-500/15"}`}>
                  {p.paymentType === "subscription"
                    ? <CreditCard size={14} className="text-indigo-400" />
                    : <Wallet size={14} className="text-green-400" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white/90">
                    {p.paymentType === "subscription" ? `${p.subscriptionPlan ?? "Plan"} subscription` : `Wallet recharge`}
                  </p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {p.completedAt ?? p.createdAt ? format(new Date(p.completedAt ?? p.createdAt), "MMM d, yyyy · h:mm a") : "—"}
                    <span className={`ml-2 ${p.status === "completed" ? "text-green-400" : p.status === "pending" ? "text-amber-400" : "text-red-400"}`}>
                      · {p.status}
                    </span>
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-white">{fmtMoney(p.amount ?? 0)}</p>
                  {p.coinsAdded > 0 && <p className="text-xs text-green-400">+{p.coinsAdded} coins</p>}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
