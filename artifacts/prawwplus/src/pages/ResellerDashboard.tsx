import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@workspace/auth-web";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Link2, DollarSign, Users, TrendingUp, Copy, CheckCircle, BarChart3,
  CreditCard, RefreshCw, BadgeDollarSign, ArrowUpCircle, Loader2,
  Megaphone, X, AlertTriangle, Info,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const PANEL = "rounded-lg border border-white/[0.12] bg-white/[0.025]";
const ROWS  = "divide-y divide-white/[0.08]";

const TABS = [
  { id: "overview",  label: "Overview",  icon: BarChart3      },
  { id: "earnings",  label: "Earnings",  icon: BadgeDollarSign },
  { id: "referrals", label: "Referrals", icon: Users           },
  { id: "payouts",   label: "Payouts",   icon: CreditCard      },
] as const;

type TabId = typeof TABS[number]["id"];

async function resellerFetch(path: string) {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function Skel({ rows = 5, h = 48 }: { rows?: number; h?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-md bg-white/[0.04] animate-pulse" style={{ height: h }} />
      ))}
    </div>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 12px" }}>
      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: "#fff" }}>R{(payload[0].value as number).toFixed(2)}</p>
    </div>
  );
}

// ─── Referral Code card ────────────────────────────────────────────────────────
function ReferralCard({ code }: { code: string | null }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const referralLink = code ? `${window.location.origin}/signup?ref=${code}` : null;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: `${label} copied!` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  if (!code) return null;

  return (
    <div className={`${PANEL} p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Referral Code</p>
          <p className="text-xs text-white/35 mt-0.5">Share to earn 30% commission per purchase</p>
        </div>
        <Link2 className="w-4 h-4 text-white/25" />
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-md border border-white/[0.1] bg-white/[0.03] px-3 py-2.5">
          <p className="text-lg font-bold font-mono text-white tracking-widest">{code}</p>
        </div>
        <button
          onClick={() => copy(code, "Code")}
          style={{ width: 40, height: 40, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: copied ? "rgba(52,211,153,0.08)" : "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s", color: copied ? "#34d399" : "rgba(255,255,255,0.4)", flexShrink: 0 }}
        >
          {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      {referralLink && (
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-md border border-white/[0.07] bg-white/[0.02] px-3 py-2 overflow-hidden">
            <p className="text-[11px] text-white/35 truncate font-mono">{referralLink}</p>
          </div>
          <button
            onClick={() => copy(referralLink, "Link")}
            style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", cursor: "pointer", transition: "all 0.15s", flexShrink: 0 }}
          >
            Copy
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Overview Tab ──────────────────────────────────────────────────────────────
function OverviewTab({ stats }: { stats: any }) {
  const chartData = useMemo(() => {
    const raw: any[] = stats?.recentEarnings ?? [];
    if (raw.length === 0) return [];
    const byDate: Record<string, number> = {};
    raw.forEach((e: any) => {
      const d = format(new Date(e.createdAt), "dd MMM");
      byDate[d] = (byDate[d] ?? 0) + e.amount;
    });
    return Object.entries(byDate).map(([date, amount]) => ({ date, amount }));
  }, [stats]);

  if (!stats) return null;

  const kpis = [
    { label: "Total Earned", value: `R${(stats.totalEarnings   ?? 0).toFixed(2)}` },
    { label: "Pending",      value: `R${(stats.pendingEarnings ?? 0).toFixed(2)}`, accent: "#f59e0b" },
    { label: "Paid Out",     value: `R${(stats.paidEarnings    ?? 0).toFixed(2)}`, accent: "#34d399" },
    { label: "Referrals",    value:  stats.totalReferrals ?? 0                                        },
  ];

  return (
    <div className="space-y-3">
      <ReferralCard code={stats.referralCode} />

      {/* KPI strip */}
      <div className={`${PANEL} grid`} style={{ gridTemplateColumns: `repeat(${kpis.length}, 1fr)` }}>
        {kpis.map((k, i) => (
          <div key={k.label} className={cn("p-3 text-center", i > 0 && "border-l border-white/[0.08]")}>
            <p className="text-base font-bold font-mono leading-none" style={{ color: k.accent ?? "rgba(255,255,255,0.9)" }}>{k.value}</p>
            <p className="text-[10px] text-white/35 mt-1 uppercase tracking-wider leading-none">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Earnings area chart */}
      {chartData.length > 0 && (
        <div className={`${PANEL} p-4 space-y-3`}>
          <p className="text-[11px] font-semibold text-white/40 uppercase tracking-widest">Earnings Trend</p>
          <ResponsiveContainer width="100%" height={130}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="earnGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#818cf8" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#818cf8" stopOpacity={0}    />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.2)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `R${v}`} />
              <Tooltip content={<ChartTip />} cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }} />
              <Area type="monotone" dataKey="amount" stroke="#818cf8" strokeWidth={1.5} fill="url(#earnGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent commissions */}
      {(stats.recentEarnings ?? []).length > 0 && (
        <div className={PANEL}>
          <div className="px-3.5 py-2.5 border-b border-white/[0.08]">
            <p className="text-[10px] font-semibold text-white/40 uppercase tracking-widest">Recent Commissions</p>
          </div>
          <div className={ROWS}>
            {stats.recentEarnings.map((e: any) => (
              <div key={e.id} className="px-3.5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white font-mono">R{e.amount.toFixed(2)}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: e.status === "paid" ? "#34d399" : "#f59e0b" }}>{e.status}</span>
                  </div>
                  <p className="text-xs text-white/30 capitalize">{e.type?.replace(/_/g, " ")} · {e.createdAt ? format(new Date(e.createdAt), "dd MMM yyyy") : "—"}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Earnings Tab ──────────────────────────────────────────────────────────────
function EarningsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    resellerFetch("/reseller/earnings?limit=100").then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <Skel />;
  const earnings: any[] = data?.earnings ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/35">{data?.total ?? 0} commission records</p>
      {earnings.length === 0 ? (
        <div className={`${PANEL} p-8 text-center`}>
          <BadgeDollarSign className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No commissions yet</p>
          <p className="text-white/15 text-xs mt-1">Share your referral link to start earning</p>
        </div>
      ) : (
        <div className={`${PANEL} ${ROWS}`}>
          {earnings.map((e) => (
            <div key={e.id} className="px-3.5 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-white font-mono">R{e.amount.toFixed(2)}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: e.status === "paid" ? "#34d399" : "#f59e0b" }}>{e.status}</span>
                  <span className="text-[10px] text-white/30 capitalize">{e.type?.replace(/_/g, " ")}</span>
                </div>
                <p className="text-xs text-white/35 mt-0.5">
                  From: {e.user?.name || e.user?.username || "Unknown"} · Purchase: R{e.purchaseAmount?.toFixed(2)}
                </p>
                <p className="text-[11px] text-white/20">{e.createdAt ? format(new Date(e.createdAt), "dd MMM yyyy, HH:mm") : "—"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Referrals Tab ─────────────────────────────────────────────────────────────
function ReferralsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    resellerFetch("/reseller/referrals?limit=100").then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <Skel />;
  const referrals: any[] = data?.referrals ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/35">{data?.total ?? 0} referred users</p>
      {referrals.length === 0 ? (
        <div className={`${PANEL} p-8 text-center`}>
          <Users className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No referrals yet</p>
          <p className="text-white/15 text-xs mt-1">Your sign-up link brings users here</p>
        </div>
      ) : (
        <div className={`${PANEL} ${ROWS}`}>
          {referrals.map((r) => (
            <div key={r.id} className="px-3.5 py-3 flex items-center gap-3">
              <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)" }}>{(r.name || r.username || "?").slice(0, 2).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{r.name || r.username}</p>
                <p className="text-xs text-white/35 truncate">{r.email}</p>
                <p className="text-[11px] text-white/20">{r.createdAt ? format(new Date(r.createdAt), "dd MMM yyyy") : "—"}</p>
              </div>
              <div className="text-right shrink-0">
                {(r.earnings?.count ?? 0) > 0 && (
                  <p className="text-xs font-bold font-mono" style={{ color: "#34d399" }}>R{(r.earnings?.total ?? 0).toFixed(2)}</p>
                )}
                <p className="text-[10px] text-white/25">{r.earnings?.count ?? 0} orders</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Payouts Tab ───────────────────────────────────────────────────────────────
function PayoutsTab({ pendingEarnings }: { pendingEarnings: number }) {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [notes, setNotes] = useState("");
  const [showForm, setShowForm] = useState(false);

  const loadPayouts = () => {
    setLoading(true);
    resellerFetch("/reseller/payouts").then(setData).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { loadPayouts(); }, []);

  const hasOutstandingRequest = (data?.payouts ?? []).some(
    (p: any) => p.status === "requested" || p.status === "pending"
  );
  const canRequest = pendingEarnings > 0 && !hasOutstandingRequest;

  const handleRequest = async () => {
    setRequesting(true);
    try {
      const res = await fetch("/api/reseller/payouts/request", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Request failed");
      toast({ title: "Payout requested!", description: `R${body.payout.amount.toFixed(2)} — an admin will process it shortly.` });
      setNotes("");
      setShowForm(false);
      loadPayouts();
    } catch (err: any) {
      toast({ title: "Request failed", description: err.message, variant: "destructive" });
    } finally {
      setRequesting(false);
    }
  };

  const statusClr = (s: string) => s === "paid" ? "#34d399" : s === "requested" ? "#60a5fa" : "#f59e0b";

  if (loading) return <Skel rows={4} h={52} />;
  const payouts: any[] = data?.payouts ?? [];

  return (
    <div className="space-y-3">
      {/* Payout CTA */}
      <div className={PANEL}>
        <div className="p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Request a Payout</p>
            <p className="text-xs text-white/40 mt-0.5">
              {canRequest
                ? `R${pendingEarnings.toFixed(2)} available to withdraw`
                : hasOutstandingRequest
                ? "A payout request is already pending"
                : "No pending earnings to withdraw"}
            </p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            disabled={!canRequest}
            style={{
              padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 5, cursor: canRequest ? "pointer" : "not-allowed",
              border: "1px solid",
              borderColor: canRequest ? "rgba(129,140,248,0.35)" : "rgba(255,255,255,0.08)",
              background: canRequest ? "rgba(129,140,248,0.1)" : "rgba(255,255,255,0.03)",
              color: canRequest ? "#818cf8" : "rgba(255,255,255,0.25)",
              transition: "all 0.15s", flexShrink: 0,
            }}
          >
            <ArrowUpCircle style={{ width: 13, height: 13 }} />
            Request
          </button>
        </div>

        {showForm && canRequest && (
          <div className="px-4 pb-4 space-y-2 border-t border-white/[0.07] pt-3">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional note (bank details, reference, etc.)"
              rows={2}
              className="w-full bg-white/[0.03] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/20 resize-none focus:outline-none focus:border-white/20"
            />
            <div className="flex gap-2">
              <button
                onClick={handleRequest}
                disabled={requesting}
                style={{ flex: 1, padding: "7px 0", borderRadius: 7, background: "rgba(129,140,248,0.15)", border: "1px solid rgba(129,140,248,0.3)", color: "#818cf8", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: requesting ? "not-allowed" : "pointer", opacity: requesting ? 0.6 : 1 }}
              >
                {requesting && <Loader2 className="w-3 h-3 animate-spin" />}
                {requesting ? "Submitting…" : `Request R${pendingEarnings.toFixed(2)}`}
              </button>
              <button
                onClick={() => setShowForm(false)}
                style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.4)", fontSize: 12, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {payouts.length === 0 ? (
        <div className={`${PANEL} p-8 text-center`}>
          <CreditCard className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No payouts yet</p>
          <p className="text-white/15 text-xs mt-1">Request your first payout above</p>
        </div>
      ) : (
        <div className={`${PANEL} ${ROWS}`}>
          {payouts.map((p) => (
            <div key={p.id} className="px-3.5 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white font-mono">R{p.amount.toFixed(2)}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: statusClr(p.status), textTransform: "capitalize" }}>{p.status}</span>
                </div>
                {p.notes && <p className="text-xs text-white/35 mt-0.5 truncate">{p.notes}</p>}
                <p className="text-[11px] text-white/20">
                  {p.requestedAt ? `Requested ${format(new Date(p.requestedAt), "dd MMM yyyy")}` : p.createdAt ? format(new Date(p.createdAt), "dd MMM yyyy") : "—"}
                  {p.paidAt ? ` · Paid ${format(new Date(p.paidAt), "dd MMM yyyy")}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Reseller Dashboard ───────────────────────────────────────────────────
export default function ResellerDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabId>("overview");
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const loadStats = useCallback(() => {
    setLoadingStats(true);
    setStatsError(null);
    resellerFetch("/reseller/stats")
      .then((data) => { setStats(data); setStatsError(null); })
      .catch((err: any) => setStatsError(err?.message ?? "Failed to load dashboard data"))
      .finally(() => setLoadingStats(false));
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => {
    resellerFetch("/announcements")
      .then((d) => setAnnouncements((d.announcements ?? []).filter((a: any) => !a.viewed)))
      .catch(() => {});
  }, []);

  const dismissAnnouncement = async (id: string) => {
    setDismissedIds((s) => new Set([...s, id]));
    try {
      await fetch(`/api/announcements/${id}/view`, { method: "POST", credentials: "include" });
    } catch { /* non-critical */ }
  };

  const visibleAnnouncements = announcements.filter((a) => !dismissedIds.has(a.id));

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Header */}
      <div className="pt-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-white/40 shrink-0" />
          <div>
            <h1 className="text-lg font-bold text-white leading-none">Reseller Dashboard</h1>
            <p className="text-xs text-white/35 mt-0.5">Welcome back, {user?.name || user?.username}</p>
          </div>
        </div>
        <button
          onClick={loadStats}
          style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.35)" }}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loadingStats && "animate-spin")} />
        </button>
      </div>

      {/* Error banner */}
      {statsError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.06] px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-300">Failed to load dashboard</p>
            <p className="text-xs text-white/40 mt-0.5">{statsError}</p>
          </div>
          <button onClick={loadStats} style={{ fontSize: 11, fontWeight: 600, color: "#f87171", cursor: "pointer", background: "transparent", border: "none", flexShrink: 0 }}>Retry</button>
        </div>
      )}

      {/* Announcement banners */}
      {visibleAnnouncements.map((a) => {
        const isWarning = a.type === "warning";
        const isPromo   = a.type === "promo";
        const clr       = isWarning ? "#f59e0b" : isPromo ? "#a78bfa" : "#60a5fa";
        const Icon      = isWarning ? AlertTriangle : isPromo ? Megaphone : Info;
        return (
          <div key={a.id} style={{ borderRadius: 8, border: `1px solid ${clr}22`, background: `${clr}09`, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
            <Icon style={{ width: 13, height: 13, color: clr, flexShrink: 0, marginTop: 1 }} />
            <div className="flex-1 min-w-0">
              <p style={{ fontSize: 13, fontWeight: 600, color: clr }}>{a.title}</p>
              <p className="text-xs text-white/50 mt-0.5">{a.message}</p>
            </div>
            <button onClick={() => dismissAnnouncement(a.id)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.25)", flexShrink: 0, padding: 2 }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}

      {/* Underline tab nav */}
      <div className="flex overflow-x-auto no-scrollbar" style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 500,
              color: tab === t.id ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.32)",
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              borderBottom: tab === t.id ? "2px solid rgba(255,255,255,0.8)" : "2px solid transparent",
              marginBottom: -1,
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              whiteSpace: "nowrap",
              flexShrink: 0,
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            <t.icon style={{ width: 12, height: 12 }} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview loading skeleton */}
      {loadingStats && tab === "overview" && (
        <div className="space-y-3">
          <div className={`${PANEL} h-24 animate-pulse`} />
          <div className={`${PANEL} h-16 animate-pulse`} />
          <div className={`${PANEL} h-36 animate-pulse`} />
        </div>
      )}

      {!loadingStats && tab === "overview"  && <OverviewTab stats={stats} />}
      {tab === "earnings"                   && <EarningsTab />}
      {tab === "referrals"                  && <ReferralsTab />}
      {tab === "payouts"                    && <PayoutsTab pendingEarnings={stats?.pendingEarnings ?? 0} />}
    </div>
  );
}
