import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@workspace/auth-web";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Link2, DollarSign, Users, TrendingUp, Copy, CheckCircle, BarChart3,
  CreditCard, RefreshCw, BadgeDollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";

async function resellerFetch(path: string) {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "earnings", label: "Earnings", icon: BadgeDollarSign },
  { id: "referrals", label: "Referrals", icon: Users },
  { id: "payouts", label: "Payouts", icon: CreditCard },
] as const;

type TabId = typeof TABS[number]["id"];

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
    <div className="glass rounded-2xl border border-violet-500/20 bg-violet-500/5 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center">
          <Link2 className="w-4 h-4 text-violet-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Your Referral Code</p>
          <p className="text-xs text-white/40">Share this to earn 30% commission</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-xl font-bold font-mono text-violet-300 tracking-widest">{code}</p>
        </div>
        <button
          onClick={() => copy(code, "Code")}
          className="w-12 h-12 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center text-violet-400 hover:bg-violet-500/25 transition-all active:scale-90"
        >
          {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>

      {referralLink && (
        <div className="space-y-1.5">
          <p className="text-xs text-white/40">Referral Link</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-white/4 border border-white/8 rounded-xl px-3 py-2 overflow-hidden">
              <p className="text-xs text-white/50 truncate font-mono">{referralLink}</p>
            </div>
            <button
              onClick={() => copy(referralLink, "Link")}
              className="shrink-0 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 text-xs font-medium transition-all"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewTab({ stats }: { stats: any }) {
  if (!stats) return null;

  const cards = [
    { label: "Total Earned", value: `R${(stats.totalEarnings ?? 0).toFixed(2)}`, icon: DollarSign, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
    { label: "Pending", value: `R${(stats.pendingEarnings ?? 0).toFixed(2)}`, icon: TrendingUp, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
    { label: "Paid Out", value: `R${(stats.paidEarnings ?? 0).toFixed(2)}`, icon: CheckCircle, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
    { label: "Referrals", value: stats.totalReferrals ?? 0, icon: Users, color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
  ];

  return (
    <div className="space-y-4">
      <ReferralCard code={stats.referralCode} />

      <div className="grid grid-cols-2 gap-3">
        {cards.map((c, i) => (
          <div key={i} className="glass rounded-2xl p-4 border border-white/10">
            <div className={cn("w-9 h-9 rounded-full flex items-center justify-center mb-3 border", c.bg)}>
              <c.icon className={cn("w-4 h-4", c.color)} />
            </div>
            <p className="text-xl font-bold text-white font-mono">{c.value}</p>
            <p className="text-xs text-white/40 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {(stats.recentEarnings ?? []).length > 0 && (
        <div className="glass rounded-2xl border border-white/10">
          <div className="px-4 py-3 border-b border-white/8">
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Recent Commissions</p>
          </div>
          <div className="divide-y divide-white/6">
            {stats.recentEarnings.map((e: any) => (
              <div key={e.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white font-mono">R{e.amount.toFixed(2)}</span>
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", e.status === "paid" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" : "border-amber-500/25 bg-amber-500/10 text-amber-400")}>
                      {e.status}
                    </span>
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

function EarningsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    resellerFetch("/reseller/earnings?limit=100").then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 rounded-2xl glass animate-pulse" />)}</div>;
  const earnings: any[] = data?.earnings ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/40">{data?.total ?? 0} commission records</p>
      {earnings.length === 0 ? (
        <div className="glass rounded-2xl border border-white/10 p-8 text-center">
          <BadgeDollarSign className="w-8 h-8 text-white/20 mx-auto mb-3" />
          <p className="text-white/30 text-sm">No commissions yet</p>
          <p className="text-white/20 text-xs mt-1">Share your referral link to start earning</p>
        </div>
      ) : (
        <div className="glass rounded-2xl border border-white/10 divide-y divide-white/6">
          {earnings.map((e) => (
            <div key={e.id} className="p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white font-mono">R{e.amount.toFixed(2)}</span>
                  <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", e.status === "paid" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" : "border-amber-500/25 bg-amber-500/10 text-amber-400")}>
                    {e.status}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-white/40 capitalize">{e.type?.replace(/_/g, " ")}</span>
                </div>
                <p className="text-xs text-white/40 mt-0.5">
                  From: {e.user?.name || e.user?.username || "Unknown"} · Purchase: R{e.purchaseAmount?.toFixed(2)}
                </p>
                <p className="text-xs text-white/25">{e.createdAt ? format(new Date(e.createdAt), "dd MMM yyyy, HH:mm") : "—"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReferralsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    resellerFetch("/reseller/referrals?limit=100").then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 rounded-2xl glass animate-pulse" />)}</div>;
  const referrals: any[] = data?.referrals ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/40">{data?.total ?? 0} referred users</p>
      {referrals.length === 0 ? (
        <div className="glass rounded-2xl border border-white/10 p-8 text-center">
          <Users className="w-8 h-8 text-white/20 mx-auto mb-3" />
          <p className="text-white/30 text-sm">No referrals yet</p>
          <p className="text-white/20 text-xs mt-1">Your sign-up link brings users here</p>
        </div>
      ) : (
        <div className="glass rounded-2xl border border-white/10 divide-y divide-white/6">
          {referrals.map((r) => (
            <div key={r.id} className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/8 border border-white/10 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-white/60">{(r.name || r.username || "?").slice(0, 2).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{r.name || r.username}</p>
                <p className="text-xs text-white/40 truncate">{r.email}</p>
                <p className="text-xs text-white/25">{r.createdAt ? format(new Date(r.createdAt), "dd MMM yyyy") : "—"}</p>
              </div>
              <div className="text-right shrink-0">
                {(r.earnings?.count ?? 0) > 0 && (
                  <p className="text-xs font-bold text-emerald-400 font-mono">R{(r.earnings?.total ?? 0).toFixed(2)}</p>
                )}
                <p className="text-[10px] text-white/30">{r.earnings?.count ?? 0} orders</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PayoutsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    resellerFetch("/reseller/payouts").then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 rounded-2xl glass animate-pulse" />)}</div>;
  const payouts: any[] = data?.payouts ?? [];

  return (
    <div className="space-y-3">
      {payouts.length === 0 ? (
        <div className="glass rounded-2xl border border-white/10 p-8 text-center">
          <CreditCard className="w-8 h-8 text-white/20 mx-auto mb-3" />
          <p className="text-white/30 text-sm">No payouts yet</p>
          <p className="text-white/20 text-xs mt-1">Payouts are processed by the admin</p>
        </div>
      ) : (
        <div className="glass rounded-2xl border border-white/10 divide-y divide-white/6">
          {payouts.map((p) => (
            <div key={p.id} className="p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white font-mono">R{p.amount.toFixed(2)}</span>
                  <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", p.status === "paid" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" : "border-amber-500/25 bg-amber-500/10 text-amber-400")}>
                    {p.status}
                  </span>
                </div>
                {p.notes && <p className="text-xs text-white/40 mt-0.5 truncate">{p.notes}</p>}
                <p className="text-xs text-white/25">{p.createdAt ? format(new Date(p.createdAt), "dd MMM yyyy") : "—"}{p.paidAt ? ` · Paid ${format(new Date(p.paidAt), "dd MMM yyyy")}` : ""}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ResellerDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabId>("overview");
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const loadStats = useCallback(() => {
    setLoadingStats(true);
    resellerFetch("/reseller/stats").then(setStats).catch(() => {}).finally(() => setLoadingStats(false));
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <div className="pt-1 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-violet-500/12 border border-violet-500/20 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Reseller Dashboard</h1>
            <p className="text-xs text-white/40">Welcome back, {user?.name || user?.username}</p>
          </div>
        </div>
        <button onClick={loadStats} className="w-8 h-8 rounded-full glass border border-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors">
          <RefreshCw className={cn("w-3.5 h-3.5", loadingStats && "animate-spin")} />
        </button>
      </div>

      {/* Tab Nav */}
      <div className="flex gap-1 overflow-x-auto no-scrollbar pb-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all shrink-0",
              tab === t.id
                ? "bg-violet-500/15 text-violet-400 border border-violet-500/25"
                : "text-white/40 hover:text-white/70 hover:bg-white/5 border border-transparent"
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {loadingStats && tab === "overview" && (
        <div className="space-y-3">
          <div className="h-32 rounded-2xl glass animate-pulse" />
          <div className="grid grid-cols-2 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-2xl glass animate-pulse" />)}</div>
        </div>
      )}

      {!loadingStats && tab === "overview" && <OverviewTab stats={stats} />}
      {tab === "earnings" && <EarningsTab />}
      {tab === "referrals" && <ReferralsTab />}
      {tab === "payouts" && <PayoutsTab />}
    </div>
  );
}
