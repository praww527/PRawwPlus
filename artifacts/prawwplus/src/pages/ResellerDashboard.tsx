import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@workspace/auth-web";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Link2, Users, TrendingUp, Copy, CheckCircle, BarChart3,
  CreditCard, RefreshCw, BadgeDollarSign, ArrowUpCircle, Loader2,
  Megaphone, X, AlertTriangle, Info,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

const TABS = [
  { id: "overview",  label: "Overview",  icon: BarChart3       },
  { id: "earnings",  label: "Earnings",  icon: BadgeDollarSign },
  { id: "referrals", label: "Referrals", icon: Users            },
  { id: "payouts",   label: "Payouts",   icon: CreditCard       },
] as const;

type TabId = typeof TABS[number]["id"];

async function resellerFetch(path: string) {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function Skel({ rows = 5, h = 52 }: { rows?: number; h?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-white/[0.04] animate-pulse" style={{ height: h }} />
      ))}
    </div>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0d0d0d", borderRadius: 8, padding: "8px 12px", boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
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
    <div style={{ background: "rgba(129,140,248,0.08)", borderRadius: 18, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: 0 }}>Your Referral Code</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2, margin: "2px 0 0" }}>Earn 30% commission on every purchase</p>
        </div>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(129,140,248,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Link2 style={{ width: 15, height: 15, color: "#818cf8" }} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1, background: "rgba(255,255,255,0.06)", borderRadius: 12, padding: "10px 14px" }}>
          <p style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: "#fff", letterSpacing: "0.12em", margin: 0 }}>{code}</p>
        </div>
        <button
          onClick={() => copy(code, "Code")}
          style={{
            width: 44, height: 44, borderRadius: 12,
            background: copied ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.08)",
            border: "none", display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", transition: "all 0.15s",
            color: copied ? "#34d399" : "rgba(255,255,255,0.5)", flexShrink: 0,
          }}
        >
          {copied ? <CheckCircle style={{ width: 18, height: 18 }} /> : <Copy style={{ width: 18, height: 18 }} />}
        </button>
      </div>

      {referralLink && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "8px 12px", overflow: "hidden" }}>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{referralLink}</p>
          </div>
          <button
            onClick={() => copy(referralLink, "Link")}
            style={{ padding: "7px 14px", borderRadius: 10, background: "rgba(129,140,248,0.12)", border: "none", fontSize: 12, fontWeight: 600, color: "#818cf8", cursor: "pointer", flexShrink: 0, transition: "all 0.15s" }}
          >
            Copy Link
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
    { label: "Total Earned", value: `R${(stats.totalEarnings   ?? 0).toFixed(2)}`,  color: "rgba(255,255,255,0.9)" },
    { label: "Pending",      value: `R${(stats.pendingEarnings ?? 0).toFixed(2)}`,  color: "#f59e0b" },
    { label: "Paid Out",     value: `R${(stats.paidEarnings    ?? 0).toFixed(2)}`,  color: "#34d399" },
    { label: "Referrals",    value:  String(stats.totalReferrals ?? 0),              color: "#818cf8" },
  ];

  return (
    <div className="space-y-3">
      <ReferralCard code={stats.referralCode} />

      {/* KPI strip */}
      <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 18, display: "grid", gridTemplateColumns: `repeat(${kpis.length}, 1fr)` }}>
        {kpis.map((k, i) => (
          <div key={k.label} style={{ padding: "14px 8px", textAlign: "center", borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
            <p style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", lineHeight: 1, margin: 0, color: k.color }}>{k.value}</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em", margin: "4px 0 0" }}>{k.label}</p>
          </div>
        ))}
      </div>

      {/* Earnings area chart */}
      {chartData.length > 0 && (
        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 18, padding: "16px 16px 8px" }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12, margin: "0 0 12px" }}>Earnings Trend</p>
          <ResponsiveContainer width="100%" height={130}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="earnGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#818cf8" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#818cf8" stopOpacity={0}   />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.2)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `R${v}`} />
              <Tooltip content={<ChartTip />} cursor={{ stroke: "rgba(255,255,255,0.06)", strokeWidth: 1 }} />
              <Area type="monotone" dataKey="amount" stroke="#818cf8" strokeWidth={2} fill="url(#earnGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent commissions */}
      {(stats.recentEarnings ?? []).length > 0 && (
        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 18, overflow: "hidden" }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em", padding: "14px 16px 10px", margin: 0, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>Recent Commissions</p>
          <div>
            {stats.recentEarnings.map((e: any, i: number) => (
              <div key={e.id} style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: "#fff" }}>R{e.amount.toFixed(2)}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: e.status === "paid" ? "#34d399" : "#f59e0b" }}>{e.status}</span>
                  </div>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textTransform: "capitalize", margin: "2px 0 0" }}>{e.type?.replace(/_/g, " ")} · {e.createdAt ? format(new Date(e.createdAt), "dd MMM yyyy") : "—"}</p>
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
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", margin: 0 }}>{data?.total ?? 0} commission records</p>
      {earnings.length === 0 ? (
        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 18, padding: "40px 20px", textAlign: "center" }}>
          <BadgeDollarSign style={{ width: 28, height: 28, color: "rgba(255,255,255,0.12)", margin: "0 auto 10px" }} />
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.25)", margin: 0 }}>No commissions yet</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.15)", marginTop: 4 }}>Share your referral link to start earning</p>
        </div>
      ) : (
        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 18, overflow: "hidden" }}>
          {earnings.map((e, i) => (
            <div key={e.id} style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15, fontWeight: 700, fontFamily: "monospace", color: "#fff" }}>R{e.amount.toFixed(2)}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: e.status === "paid" ? "#34d399" : "#f59e0b" }}>{e.status}</span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "capitalize" }}>{e.type?.replace(/_/g, " ")}</span>
                </div>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "3px 0 0" }}>
                  From: {e.user?.name || e.user?.username || "Unknown"} · Purchase: R{e.purchaseAmount?.toFixed(2)}
                </p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", margin: "1px 0 0" }}>{e.createdAt ? format(new Date(e.createdAt), "dd MMM yyyy, HH:mm") : "—"}</p>
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
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", margin: 0 }}>{data?.total ?? 0} referred users</p>
      {referrals.length === 0 ? (
        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 18, padding: "40px 20px", textAlign: "center" }}>
          <Users style={{ width: 28, height: 28, color: "rgba(255,255,255,0.12)", margin: "0 auto 10px" }} />
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.25)", margin: 0 }}>No referrals yet</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.15)", marginTop: 4 }}>Your sign-up link brings users here</p>
        </div>
      ) : (
        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 18, overflow: "hidden" }}>
          {referrals.map((r, i) => (
            <div key={r.id} style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>{(r.name || r.username || "?").slice(0, 2).toUpperCase()}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "#fff", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name || r.username}</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", margin: "1px 0 0" }}>{r.createdAt ? format(new Date(r.createdAt), "dd MMM yyyy") : "—"}</p>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                {(r.earnings?.count ?? 0) > 0 && (
                  <p style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: "#34d399", margin: 0 }}>R{(r.earnings?.total ?? 0).toFixed(2)}</p>
                )}
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", margin: "2px 0 0" }}>{r.earnings?.count ?? 0} order{(r.earnings?.count ?? 0) !== 1 ? "s" : ""}</p>
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

  if (loading) return <Skel rows={4} h={56} />;
  const payouts: any[] = data?.payouts ?? [];

  return (
    <div className="space-y-3">
      {/* Payout CTA */}
      <div style={{ background: canRequest ? "rgba(129,140,248,0.08)" : "rgba(255,255,255,0.04)", borderRadius: 18, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: 0 }}>Request a Payout</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 3, margin: "3px 0 0" }}>
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
              padding: "8px 16px", borderRadius: 22, fontSize: 13, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 6,
              cursor: canRequest ? "pointer" : "not-allowed",
              border: "none",
              background: canRequest ? "rgba(129,140,248,0.2)" : "rgba(255,255,255,0.06)",
              color: canRequest ? "#818cf8" : "rgba(255,255,255,0.25)",
              transition: "all 0.15s", flexShrink: 0,
            }}
          >
            <ArrowUpCircle style={{ width: 14, height: 14 }} />
            Request
          </button>
        </div>

        {showForm && canRequest && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional note (bank details, reference, etc.)"
              rows={2}
              style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#fff", resize: "none", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                onClick={handleRequest}
                disabled={requesting}
                style={{ flex: 1, padding: "10px 0", borderRadius: 12, background: "rgba(129,140,248,0.2)", border: "none", color: "#818cf8", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: requesting ? "not-allowed" : "pointer", opacity: requesting ? 0.6 : 1, transition: "opacity 0.15s" }}
              >
                {requesting && <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />}
                {requesting ? "Submitting…" : `Request R${pendingEarnings.toFixed(2)}`}
              </button>
              <button
                onClick={() => setShowForm(false)}
                style={{ padding: "10px 16px", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 13, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {payouts.length === 0 ? (
        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 18, padding: "40px 20px", textAlign: "center" }}>
          <CreditCard style={{ width: 28, height: 28, color: "rgba(255,255,255,0.12)", margin: "0 auto 10px" }} />
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.25)", margin: 0 }}>No payouts yet</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.15)", marginTop: 4 }}>Request your first payout above</p>
        </div>
      ) : (
        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 18, overflow: "hidden" }}>
          {payouts.map((p, i) => (
            <div key={p.id} style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, fontFamily: "monospace", color: "#fff" }}>R{p.amount.toFixed(2)}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: statusClr(p.status), textTransform: "capitalize" }}>{p.status}</span>
                </div>
                {p.notes && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "3px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.notes}</p>}
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", margin: "2px 0 0" }}>
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
      <div style={{ paddingTop: 4, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#fff", lineHeight: 1, letterSpacing: "-0.02em", margin: 0 }}>Dashboard</h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 3, margin: "3px 0 0" }}>
            Welcome back, <span style={{ color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>{user?.name || user?.username}</span>
          </p>
        </div>
        <button
          onClick={loadStats}
          style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.4)", transition: "all 0.15s" }}
        >
          <RefreshCw className={cn("w-4 h-4", loadingStats && "animate-spin")} />
        </button>
      </div>

      {/* Error banner */}
      {statsError && (
        <div style={{ background: "rgba(248,113,113,0.08)", borderRadius: 16, padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <AlertTriangle style={{ width: 14, height: 14, color: "#f87171", flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#f87171", margin: 0 }}>Failed to load dashboard</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "2px 0 0" }}>{statsError}</p>
          </div>
          <button onClick={loadStats} style={{ fontSize: 12, fontWeight: 600, color: "#f87171", cursor: "pointer", background: "transparent", border: "none", flexShrink: 0 }}>Retry</button>
        </div>
      )}

      {/* Announcement banners */}
      {visibleAnnouncements.map((a) => {
        const isWarning = a.type === "warning";
        const isPromo   = a.type === "promo";
        const clr       = isWarning ? "#f59e0b" : isPromo ? "#a78bfa" : "#60a5fa";
        const Icon      = isWarning ? AlertTriangle : isPromo ? Megaphone : Info;
        return (
          <div key={a.id} style={{ background: `${clr}10`, borderRadius: 16, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
            <Icon style={{ width: 14, height: 14, color: clr, flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: clr, margin: 0 }}>{a.title}</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "3px 0 0", lineHeight: 1.5 }}>{a.message}</p>
            </div>
            <button onClick={() => dismissAnnouncement(a.id)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", flexShrink: 0, padding: 2 }}>
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        );
      })}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2, scrollbarWidth: "none" }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                padding: "7px 14px", borderRadius: 22,
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                border: "none", transition: "all 0.15s",
                background: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)",
                color: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)",
              }}
            >
              <Icon style={{ width: 13, height: 13 }} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Loading overlay */}
      {loadingStats && !stats && (
        <div className="space-y-2">
          {[80, 120, 160].map((h, i) => (
            <div key={i} className="rounded-2xl bg-white/[0.04] animate-pulse" style={{ height: h }} />
          ))}
        </div>
      )}

      {/* Tab content */}
      {!loadingStats && !statsError && (
        <>
          {tab === "overview"  && <OverviewTab stats={stats} />}
          {tab === "earnings"  && <EarningsTab />}
          {tab === "referrals" && <ReferralsTab />}
          {tab === "payouts"   && <PayoutsTab pendingEarnings={stats?.pendingEarnings ?? 0} />}
        </>
      )}
    </div>
  );
}
