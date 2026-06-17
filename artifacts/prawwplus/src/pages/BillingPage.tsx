import { useState, useEffect } from "react";
import { CreditCard, RefreshCw, FileText, Receipt, Wallet } from "lucide-react";
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

type Tab = "overview" | "invoices" | "payments";

function fmtMoney(amount: number, currency = "ZAR") {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format(amount ?? 0);
}

export default function BillingPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [billing, setBilling]   = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [bData, iData, pData] = await Promise.allSettled([
        apiFetch("/billing"),
        apiFetch("/invoices"),
        apiFetch("/payments"),
      ]);
      if (bData.status === "fulfilled") setBilling(bData.value.data ?? bData.value);
      if (iData.status === "fulfilled") setInvoices(iData.value.data ?? iData.value.invoices ?? iData.value ?? []);
      if (pData.status === "fulfilled") setPayments(pData.value.data ?? pData.value.payments ?? pData.value ?? []);
      const allFailed = [bData, iData, pData].every((r) => r.status === "rejected");
      if (allFailed) setError((bData as any).reason?.message ?? "Failed to load billing data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "overview", label: "Overview",  icon: <Wallet size={13} /> },
    { key: "invoices", label: "Invoices",  icon: <FileText size={13} /> },
    { key: "payments", label: "Payments",  icon: <Receipt size={13} /> },
  ];

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
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
        <div className="grid gap-4 md:grid-cols-2">
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} className="p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/40">Account Balance</p>
            <p className="text-3xl font-bold text-white">{billing?.coins ?? billing?.balance ?? 0} <span className="text-base font-normal text-white/40">coins</span></p>
            {billing?.currency && <p className="text-xs text-white/30">Currency: {billing.currency}</p>}
          </div>

          {billing?.plan && (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} className="p-5 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/40">Rate Plan</p>
              <p className="text-lg font-semibold text-white">{billing.plan.name ?? billing.plan}</p>
              {billing.plan.rate != null && <p className="text-xs text-white/40">{billing.plan.rate} coins/min</p>}
            </div>
          )}

          {billing?.usage && (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} className="p-5 col-span-full space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/40 mb-3">This Month</p>
              {[
                { label: "Total calls",    value: billing.usage.totalCalls ?? "—" },
                { label: "Total minutes",  value: billing.usage.totalMinutes != null ? `${billing.usage.totalMinutes} min` : "—" },
                { label: "Coins spent",    value: billing.usage.coinsSpent != null ? `${billing.usage.coinsSpent} coins` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm py-1 border-b border-white/5">
                  <span className="text-white/40">{label}</span>
                  <span className="text-white/80 font-medium">{String(value)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} className="p-5 col-span-full space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/40">Top Up — Manual EFT</p>
            <p className="text-sm text-white/60 leading-relaxed">
              Transfer funds directly to our account. Your coins will be allocated within 1 business day after payment is confirmed.
            </p>
            <div className="space-y-1.5">
              {[
                { label: "Bank",           value: "First National Bank (FNB)" },
                { label: "Account name",   value: "PRaww+ (Pty) Ltd" },
                { label: "Account number", value: "63012345678" },
                { label: "Branch code",    value: "250655 (Universal)" },
                { label: "Account type",   value: "Business Cheque" },
                { label: "Reference",      value: "Your email address" },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm py-1 border-b border-white/5 last:border-0">
                  <span className="text-white/40">{label}</span>
                  <span className="text-white/80 font-medium select-all">{value}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-white/30 pt-1">
              After payment, email <span className="text-indigo-400">billing@praww.co.za</span> with your proof of payment and coin amount required.
            </p>
          </div>
        </div>
      ) : tab === "invoices" ? (
        invoices.length === 0 ? (
          <div className="text-center py-16 text-white/40 text-sm">No invoices found.</div>
        ) : (
          <div className="space-y-2">
            {invoices.map((inv) => (
              <div key={inv._id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }}
                className="flex items-center gap-3 p-3">
                <FileText size={16} className="text-indigo-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white/90">
                    Invoice {inv.invoiceNumber ?? inv._id?.slice(-6).toUpperCase()}
                  </p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {inv.issuedAt ? format(new Date(inv.issuedAt), "MMM d, yyyy") : "—"}
                    {inv.dueDate ? ` · Due ${format(new Date(inv.dueDate), "MMM d")}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-white">{fmtMoney(inv.amount ?? inv.total, inv.currency)}</p>
                  <span className={`text-xs ${inv.status === "paid" ? "text-green-400" : inv.status === "overdue" ? "text-red-400" : "text-amber-400"}`}>
                    {inv.status ?? "pending"}
                  </span>
                </div>
                {inv.pdfUrl && (
                  <a href={inv.pdfUrl} download className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors" title="Download PDF">
                    <FileText size={13} className="text-white/50" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        payments.length === 0 ? (
          <div className="text-center py-16 text-white/40 text-sm">No payment history found.</div>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p._id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }}
                className="flex items-center gap-3 p-3">
                <Receipt size={16} className="text-green-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white/90">
                    {p.method ?? p.type ?? "Payment"}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {p.paidAt ?? p.createdAt ? format(new Date(p.paidAt ?? p.createdAt), "MMM d, yyyy · h:mm a") : "—"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-green-400">+{fmtMoney(p.amount, p.currency)}</p>
                  <span className="text-xs text-white/30">{p.coinsAdded != null ? `${p.coinsAdded} coins` : ""}</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
