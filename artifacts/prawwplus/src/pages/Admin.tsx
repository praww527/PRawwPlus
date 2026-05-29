import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/hooks/use-toast";
import { cn, formatCurrency } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart as RLineChart, Line,
} from "recharts";
import {
  Users, DollarSign, PhoneCall, ShieldAlert, Lock, Unlock, UserCheck,
  UserX, BarChart3, Link2, BadgeDollarSign, Receipt, CreditCard, RefreshCw,
  ChevronDown, ChevronRight, Trash2, CheckCircle2, Shield, Settings, Megaphone,
  AlertTriangle, Flag, Clock, Edit2, ToggleLeft, ToggleRight, Smartphone,
  BadgeCheck, X, Eye, FileText, Check, Activity, ArrowRight, Phone, PhoneOff,
  Loader2, Bell, BellRing, Send, Users2, Wrench, Info, Server, Database,
  Wifi, WifiOff, Terminal, KeyRound, Globe2, ShieldCheck, ShieldOff, Building2,
  Cpu, HardDrive, MemoryStick, Radio, GitBranch, Zap, TrendingUp,
  LineChart, BarChart2, ShieldCheckIcon, PhoneForwarded, List, Network,
  ShieldQuestion, Tag,
} from "lucide-react";

const TABS = [
  { id: "overview",      label: "Overview",      icon: BarChart3   },
  { id: "operations",    label: "Operations",    icon: Cpu         },
  { id: "observability", label: "Observability", icon: Activity    },
  { id: "users",         label: "Users",         icon: Users       },
  { id: "live",          label: "Live Calls",    icon: PhoneCall   },
  { id: "errors",        label: "Errors",        icon: AlertTriangle },
  { id: "system",        label: "System",        icon: Server      },
  { id: "platform-health", label: "Platform Health", icon: Activity   },
  { id: "push",          label: "Push",          icon: Bell        },
  { id: "referrals",     label: "Referrals",     icon: Link2       },
  { id: "earnings",      label: "Earnings",      icon: BadgeDollarSign },
  { id: "expenses",      label: "Expenses",      icon: Receipt     },
  { id: "payouts",       label: "Payouts",       icon: CreditCard  },
  { id: "abuse",         label: "Calls & Abuse", icon: ShieldAlert },
  { id: "announcements", label: "Announcements", icon: Megaphone   },
  { id: "audit",         label: "Audit Log",     icon: FileText    },
  { id: "alert-rules",  label: "Alerts",        icon: BellRing    },
  { id: "ip-blocks",    label: "IP Blocks",     icon: ShieldOff   },
  { id: "tenants",      label: "Tenants",       icon: Building2   },
  { id: "ivr",          label: "IVR & Queues",  icon: Network      },
  { id: "security",     label: "Security",      icon: ShieldCheck  },
  { id: "analytics",    label: "Analytics",     icon: LineChart    },
  { id: "commissions",  label: "Commissions",   icon: TrendingUp   },
  { id: "rate-plans",   label: "Rate Plans",    icon: Tag          },
] as const;

type TabId = typeof TABS[number]["id"];

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

const CSRF_MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function adminFetch(path: string, opts?: RequestInit) {
  const method = (opts?.method ?? "GET").toUpperCase();
  const csrfHeaders: Record<string, string> =
    CSRF_MUTATING.has(method) ? { "X-CSRF-Token": getCsrfToken() } : {};

  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders,
      ...(opts?.headers ?? {}),
    },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function RolePill({ role }: { role: string }) {
  const colors: Record<string, string> = { admin: "#f87171", reseller: "#a78bfa" };
  const c = colors[role] ?? "rgba(255,255,255,0.3)";
  return <span style={{ fontSize: 10, fontWeight: 700, color: c, textTransform: "uppercase", letterSpacing: "0.05em" }}>{role}</span>;
}

function StatusDot({ approved, locked }: { approved: boolean; locked: boolean }) {
  const c = locked ? "#f87171" : !approved ? "#f59e0b" : "#34d399";
  const l = locked ? "locked" : !approved ? "pending" : "active";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, color: c }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: c, flexShrink: 0 }} />
      {l}
    </span>
  );
}

function PhonePill({ verified }: { verified?: boolean }) {
  const c = verified ? "#34d399" : "#f59e0b";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, color: c }}>
      <Smartphone style={{ width: 9, height: 9 }} />
      {verified ? "verified" : "unverified"}
    </span>
  );
}

function VerifiedBadge() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, color: "#34d399" }}>
      <BadgeCheck style={{ width: 11, height: 11 }} />
      verified
    </span>
  );
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
      <p style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: "#fff" }}>R{typeof payload[0]?.value === "number" ? payload[0].value.toFixed(2) : "0.00"}</p>
    </div>
  );
}

function Chip({ color, disabled, onClick, children }: { color: "green" | "amber" | "red" | "blue" | "muted"; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) {
  const styles: Record<string, React.CSSProperties> = {
    green: { color: "#34d399", background: "rgba(52,211,153,0.1)" },
    amber: { color: "#f59e0b", background: "rgba(245,158,11,0.1)" },
    red:   { color: "#f87171", background: "rgba(248,113,113,0.1)" },
    blue:  { color: "#60a5fa", background: "rgba(96,165,250,0.1)"  },
    muted: { color: "rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.06)" },
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 26, padding: "0 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
        display: "inline-flex", alignItems: "center", gap: 4,
        border: "none", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1, transition: "opacity 0.15s",
        ...styles[color],
      }}
    >
      {children}
    </button>
  );
}

// ─── Overview Tab ──────────────────────────────────────────────────────────────
function OverviewTab({ onSwitchTab }: { onSwitchTab: (tab: TabId) => void }) {
  const { toast } = useToast();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    adminFetch("/admin/stats")
      .then(setStats)
      .catch((e: any) => toast({ title: "Failed to load stats", description: e.message, variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white/[0.04] h-14 animate-pulse" />
      <div className="rounded-2xl bg-white/[0.04] h-24 animate-pulse" />
      <div className="rounded-2xl bg-white/[0.04] h-20 animate-pulse" />
      <div className="rounded-2xl bg-white/[0.04] h-52 animate-pulse" />
    </div>
  );
  if (!stats) return null;

  const topStats = [
    { label: "Users",     value: stats.totalUsers,            color: "#818cf8" },
    { label: "Calls",     value: stats.totalCalls,            color: "#60a5fa" },
    { label: "Today",     value: stats.callsToday ?? 0,       color: "#34d399" },
    { label: "Resellers", value: stats.totalResellers,        color: "#f59e0b" },
    { label: "Active Sub",value: stats.activeSubscriptions,   color: "#a78bfa" },
    { label: "Locked",    value: stats.lockedUsers ?? 0,      color: "#f87171" },
  ];

  const chartData = [
    { name: "Revenue",     v: stats.totalRevenue    ?? 0, color: "#818cf8" },
    { name: "Commissions", v: stats.totalCommissions ?? 0, color: "#f59e0b" },
    { name: "Expenses",    v: stats.totalExpenses   ?? 0, color: "#f87171" },
    { name: "Profit",      v: stats.profit          ?? 0, color: "#34d399" },
  ];

  const quickActions: { label: string; tab: TabId; color: string; badge?: number }[] = [
    { label: "Live Calls",    tab: "live",   color: "#30d158" },
    { label: "Pending Users", tab: "users",  color: "#ffd60a", badge: stats.pendingApprovals },
    { label: "System Health", tab: "system", color: "#60a5fa" },
    { label: "Abuse & Calls", tab: "abuse",  color: "#f87171" },
  ];

  return (
    <div className="space-y-3">
      {/* Pending approvals alert */}
      {(stats.pendingApprovals ?? 0) > 0 && (
        <button
          onClick={() => onSwitchTab("users")}
          style={{
            width: "100%", padding: "12px 16px", borderRadius: 16, textAlign: "left", cursor: "pointer",
            background: "rgba(255,214,10,0.07)", border: "1px solid rgba(255,214,10,0.22)",
            display: "flex", alignItems: "center", gap: 12,
          }}
        >
          <AlertTriangle style={{ width: 16, height: 16, color: "#ffd60a", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#ffd60a", margin: 0 }}>
              {stats.pendingApprovals} user{stats.pendingApprovals !== 1 ? "s" : ""} awaiting document review
            </p>
            <p style={{ fontSize: 11, color: "rgba(255,214,10,0.55)", margin: "2px 0 0" }}>Tap to open Users → Verify Requests</p>
          </div>
          <ChevronRight style={{ width: 13, height: 13, color: "#ffd60a", flexShrink: 0 }} />
        </button>
      )}

      {/* KPI grid */}
      <div className="rounded-2xl bg-white/[0.04]" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
        {topStats.map((s, i) => (
          <div key={s.label} style={{
            padding: "14px 8px", textAlign: "center",
            borderLeft: i % 3 !== 0 ? "1px solid rgba(255,255,255,0.07)" : "none",
            borderTop: i >= 3     ? "1px solid rgba(255,255,255,0.07)" : "none",
          }}>
            <p style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: "monospace", lineHeight: 1, margin: 0 }}>{s.value ?? 0}</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.07em", margin: "4px 0 0" }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Quick-nav buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
        {quickActions.map((a) => (
          <button
            key={a.tab}
            onClick={() => onSwitchTab(a.tab)}
            style={{
              padding: "11px 14px", borderRadius: 14, textAlign: "left", cursor: "pointer", border: "none",
              background: `${a.color}0f`, outline: `1px solid ${a.color}28`,
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: a.color }}>{a.label}</span>
            {(a.badge ?? 0) > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, background: `${a.color}25`, color: a.color, padding: "2px 7px", borderRadius: 8 }}>{a.badge}</span>
            )}
            <ChevronRight style={{ width: 12, height: 12, color: `${a.color}88`, flexShrink: 0 }} />
          </button>
        ))}
      </div>

      {/* Financial overview */}
      <div className="rounded-2xl bg-white/[0.04] p-4 space-y-4">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <p className="text-[11px] font-semibold text-white/40 uppercase tracking-widest" style={{ margin: 0 }}>Financial Overview</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: "#34d399" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#34d399", display: "inline-block", animation: "pulse 2s ease-in-out infinite" }} />
              LIVE
            </span>
            <button
              onClick={load}
              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(255,255,255,0.25)", background: "none", border: "none", cursor: "pointer" }}
            >
              <RefreshCw style={{ width: 10, height: 10 }} /> Refresh
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }} barSize={32}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "rgba(255,255,255,0.35)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `R${v}`} />
            <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <Bar dataKey="v" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, i) => <Cell key={i} fill={entry.color} fillOpacity={0.82} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="space-y-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          {[
            { label: "Total Revenue",       value: `R${(stats.totalRevenue ?? 0).toFixed(2)}` },
            { label: "Commissions Paid",    value: `– R${(stats.totalCommissions ?? 0).toFixed(2)}`, color: "#f59e0b" },
            { label: "Total Expenses",      value: `– R${(stats.totalExpenses ?? 0).toFixed(2)}`,   color: "#f87171" },
            { label: "Net Profit",          value: `R${(stats.profit ?? 0).toFixed(2)}`, color: (stats.profit ?? 0) >= 0 ? "#34d399" : "#f87171", bold: true },
          ].map((row) => (
            <div key={row.label} className="flex justify-between items-center">
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: (row as any).bold ? 600 : 400 }}>{row.label}</span>
              <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: (row as any).color ?? "rgba(255,255,255,0.85)" }}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent calls */}
      {(stats.recentCalls ?? []).length > 0 && (
        <div className="rounded-2xl bg-white/[0.04] overflow-hidden">
          <div style={{ padding: "13px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>Recent Calls</p>
            <button onClick={() => onSwitchTab("abuse")} style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", background: "none", border: "none", cursor: "pointer" }}>View all →</button>
          </div>
          {stats.recentCalls.slice(0, 5).map((c: any, i: number) => (
            <div key={c.id ?? i} style={{ padding: "9px 16px", display: "flex", alignItems: "center", gap: 10, borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: c.status === "completed" ? "#30d158" : c.status === "failed" ? "#ff453a" : "#f59e0b" }} />
              <span style={{ flex: 1, fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.recipientNumber ?? c.callerNumber ?? "—"}
              </span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textTransform: "capitalize", flexShrink: 0 }}>{c.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Users Tab ─────────────────────────────────────────────────────────────────
function UsersTab() {
  const { toast } = useToast();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionUser, setActionUser] = useState<any>(null);
  const [actionType, setActionType] = useState<"credit" | "role" | "doc" | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [acting, setActing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pending_verify" | "locked" | "resellers" | "active_sub">("all");

  const load = useCallback(() => {
    setLoading(true);
    adminFetch("/admin/users?limit=100")
      .then((d) => setUsers(d.users ?? []))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (userId: string, action: string, body?: any) => {
    setActing(true);
    try {
      await adminFetch(`/admin/users/${userId}/${action}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      toast({ title: "Done" });
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setActing(false); }
  };

  let filtered = search
    ? users.filter((u) =>
        (u.name || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.username || "").toLowerCase().includes(search.toLowerCase()))
    : users;

  if (filter === "pending_verify") filtered = filtered.filter((u) => u.verificationStatus === "pending");
  if (filter === "locked")         filtered = filtered.filter((u) => u.locked === true);
  if (filter === "resellers")      filtered = filtered.filter((u) => u.role === "reseller");
  if (filter === "active_sub")     filtered = filtered.filter((u) => u.subscriptionStatus === "active");

  const pendingVerifyCount = users.filter((u) => u.verificationStatus === "pending").length;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Search users…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white/[0.04] border-0 text-white placeholder:text-white/20 text-sm h-10 rounded-xl"
        />
        <button
          onClick={load}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white/35 hover:text-white/70 bg-white/[0.04] hover:bg-white/[0.07] transition-all shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2, scrollbarWidth: "none" }}>
        {([
          { key: "all"           as const, label: "All" },
          { key: "pending_verify"as const, label: pendingVerifyCount > 0 ? `Verify Req (${pendingVerifyCount})` : "Verify Req" },
          { key: "active_sub"    as const, label: "Active Sub" },
          { key: "resellers"     as const, label: "Resellers" },
          { key: "locked"        as const, label: "Locked" },
        ]).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: filter === f.key ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
              color: filter === f.key ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
              border: "none", transition: "all 0.15s", whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? <Skel /> : (
        <div className="space-y-2">
          {filtered.length === 0 && (
            <div className="rounded-2xl bg-white/[0.04] p-8 text-center">
              <p className="text-white/25 text-sm">No users found</p>
            </div>
          )}
          {filtered.map((u) => (
            <div key={u.id} className="rounded-2xl bg-white/[0.04] p-4 space-y-3">
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div style={{
                  width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                  background: u.profileImage ? "transparent" : "rgba(255,255,255,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden",
                }}>
                  {u.profileImage
                    ? <img src={u.profileImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>{(u.name || u.username || "?").slice(0, 2).toUpperCase()}</span>
                  }
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{u.name || u.username}</span>
                    <RolePill role={u.role ?? "user"} />
                    <StatusDot approved={u.approved ?? true} locked={u.locked ?? false} />
                    {u.verified && <VerifiedBadge />}
                    {u.phone && <PhonePill verified={u.phoneVerified} />}
                    {u.verificationStatus === "pending" && !u.verified && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#ffd60a", background: "rgba(255,214,10,0.12)", padding: "2px 7px", borderRadius: 6 }}>
                        doc pending
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/40 mt-0.5 truncate">{u.email}</p>
                  {u.phone && <p className="text-[11px] text-white/25 font-mono">{u.phone}</p>}
                  {u.extension && <p className="text-[11px] text-white/20 font-mono">ext {u.extension}</p>}
                </div>
                <p className="text-xs font-bold text-white font-mono shrink-0">{formatCurrency(u.coins || 0)}</p>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {!(u.approved ?? true) && (
                  <Chip color="green" disabled={acting} onClick={() => act(u.id, "approve")}><UserCheck className="w-3 h-3" />Approve</Chip>
                )}
                {(u.approved ?? true) && !(u.locked ?? false) && (
                  <Chip color="amber" disabled={acting} onClick={() => act(u.id, "reject")}><UserX className="w-3 h-3" />Revoke</Chip>
                )}
                {!(u.locked ?? false) ? (
                  <Chip color="red" disabled={acting} onClick={() => act(u.id, "lock")}><Lock className="w-3 h-3" />Lock</Chip>
                ) : (
                  <Chip color="green" disabled={acting} onClick={() => act(u.id, "unlock")}><Unlock className="w-3 h-3" />Unlock</Chip>
                )}
                {u.phone && !u.phoneVerified && (
                  <Chip color="green" disabled={acting} onClick={() => act(u.id, "verify-phone")}><Smartphone className="w-3 h-3" />Verify Phone</Chip>
                )}
                {/* Verification badge actions */}
                {u.verificationStatus === "pending" && !u.verified && (
                  <Chip color="blue" disabled={acting} onClick={() => { setActionUser(u); setActionType("doc"); }}>
                    <Eye className="w-3 h-3" />View Doc
                  </Chip>
                )}
                {!u.verified && (
                  <Chip color="green" disabled={acting} onClick={() => act(u.id, "grant-badge")}><BadgeCheck className="w-3 h-3" />Grant Badge</Chip>
                )}
                {u.verified && (
                  <Chip color="amber" disabled={acting} onClick={() => act(u.id, "reject-badge")}><X className="w-3 h-3" />Remove Badge</Chip>
                )}
                <Chip color="muted" disabled={acting} onClick={() => { setActionUser(u); setNewRole(u.role ?? "user"); setActionType("role"); }}><Settings className="w-3 h-3" />Role</Chip>
                <Chip color="muted" disabled={acting} onClick={() => { setActionUser(u); setCreditAmount(""); setActionType("credit"); }}><DollarSign className="w-3 h-3" />Credit</Chip>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── View Doc Modal ── */}
      <Modal isOpen={actionType === "doc" && !!actionUser} onClose={() => { setActionUser(null); setActionType(null); }} title="Verification Document" description={`Submitted by ${actionUser?.name || actionUser?.username}`}>
        <div className="mt-4 space-y-4">
          {actionUser?.verificationDocUrl ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 11, fontWeight: 600, color: "#ffd60a", background: "rgba(255,214,10,0.12)", padding: "3px 8px", borderRadius: 6 }}>
                  {actionUser.verificationDocType === "company" ? "Company Document" : "Personal ID"}
                </span>
                {actionUser.verificationDocSubmittedAt && (
                  <span className="text-xs text-white/35">{format(new Date(actionUser.verificationDocSubmittedAt), "dd MMM yyyy")}</span>
                )}
              </div>
              {actionUser.verificationDocUrl.startsWith("data:image") ? (
                <img
                  src={actionUser.verificationDocUrl}
                  alt="Verification document"
                  style={{ width: "100%", borderRadius: 12, maxHeight: 300, objectFit: "contain", background: "rgba(255,255,255,0.05)" }}
                />
              ) : (
                <div style={{ padding: "20px", borderRadius: 12, background: "rgba(255,255,255,0.04)", textAlign: "center" }}>
                  <FileText className="w-8 h-8 text-white/30 mx-auto mb-2" />
                  <p className="text-sm text-white/50">PDF document submitted</p>
                  <button
                    onClick={() => window.open(actionUser.verificationDocUrl, "_blank")}
                    style={{ marginTop: 8, padding: "6px 14px", borderRadius: 8, background: "rgba(96,165,250,0.15)", border: "none", color: "#60a5fa", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    Open PDF
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-white/40 text-center py-4">No document on file</p>
          )}
          <div className="flex gap-3 pt-1">
            <Button
              className="flex-1"
              style={{ background: "rgba(248,113,113,0.15)", border: "none", color: "#f87171" }}
              disabled={acting}
              onClick={async () => { await act(actionUser.id, "reject-badge"); setActionUser(null); setActionType(null); }}
            >
              <X className="w-3.5 h-3.5 mr-1.5" />
              Reject
            </Button>
            <Button
              className="flex-1"
              style={{ background: "rgba(52,211,153,0.15)", border: "none", color: "#34d399" }}
              disabled={acting}
              onClick={async () => { await act(actionUser.id, "grant-badge"); setActionUser(null); setActionType(null); }}
            >
              <BadgeCheck className="w-3.5 h-3.5 mr-1.5" />
              {acting ? "Granting…" : "Grant Badge"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Role Modal ── */}
      <Modal isOpen={actionType === "role" && !!actionUser} onClose={() => { setActionUser(null); setActionType(null); }} title="Set User Role" description={`Change role for ${actionUser?.name || actionUser?.username}`}>
        <div className="mt-4 space-y-3">
          {["user", "reseller", "admin"].map((r) => (
            <button key={r} onClick={() => setNewRole(r)} className={cn("w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left", newRole === r ? "bg-white/[0.08]" : "bg-white/[0.03] hover:bg-white/[0.05]")}>
              <div className={cn("w-3 h-3 rounded-full border-2 transition-all", newRole === r ? "bg-white border-white" : "border-white/25")} />
              <div>
                <p className="text-sm font-medium text-white capitalize">{r}</p>
                <p className="text-xs text-white/35">{r === "admin" ? "Full platform access" : r === "reseller" ? "Earns commissions via referrals" : "Standard VoIP user"}</p>
              </div>
            </button>
          ))}
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => { setActionUser(null); setActionType(null); }}>Cancel</Button>
            <Button className="flex-1" disabled={acting} onClick={async () => { await act(actionUser.id, "set-role", { role: newRole }); setActionUser(null); setActionType(null); }}>
              {acting ? "Saving…" : "Save Role"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Credit Modal ── */}
      <Modal isOpen={actionType === "credit" && !!actionUser} onClose={() => { setActionUser(null); setActionType(null); }} title="Adjust Credit" description={`Modify balance for ${actionUser?.name || actionUser?.username}`}>
        <div className="mt-4 space-y-4">
          <div className="rounded-xl bg-white/[0.04] p-3 flex justify-between">
            <span className="text-sm text-white/50">Current Balance</span>
            <span className="font-mono font-bold text-white">{formatCurrency(actionUser?.coins || 0)}</span>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-white/60">Amount (use – to deduct)</label>
            <Input type="number" step="1" placeholder="e.g. 100 or -50" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} className="bg-white/[0.04] border-0 text-white rounded-xl" />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => { setActionUser(null); setActionType(null); }}>Cancel</Button>
            <Button className="flex-1" disabled={acting || !creditAmount} onClick={async () => { await act(actionUser.id, "adjust-credit", { amount: parseFloat(creditAmount) }); setActionUser(null); setActionType(null); }}>
              {acting ? "Applying…" : "Apply"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Referrals Tab ─────────────────────────────────────────────────────────────
function ReferralsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch("/admin/referrals?limit=100").then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <Skel />;
  const referrals: any[] = data?.referrals ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/35 px-1">{data?.total ?? 0} referred users</p>
      {referrals.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.04] p-10 text-center">
          <Link2 className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No referrals yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {referrals.map((r) => (
            <div key={r.id} className="rounded-2xl bg-white/[0.04] px-4 py-3 flex items-center gap-3">
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>{(r.name || r.username || "?").slice(0, 2).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{r.name || r.username}</p>
                <p className="text-xs text-white/35 truncate">{r.email}</p>
                {r.reseller && (
                  <p className="text-[11px] text-white/25 mt-0.5">
                    via {r.reseller.name || r.reseller.username}
                    {r.reseller.referralCode && <span className="font-mono ml-1">({r.reseller.referralCode})</span>}
                  </p>
                )}
              </div>
              <p className="text-xs text-white/25 shrink-0">{r.createdAt ? format(new Date(r.createdAt), "dd MMM yy") : "—"}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Earnings Tab ──────────────────────────────────────────────────────────────
function EarningsTab() {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    adminFetch("/admin/earnings?limit=100").then(setData).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const markPaid = async (earningId: string) => {
    try {
      await adminFetch(`/admin/earnings/${earningId}/mark-paid`, { method: "POST" });
      toast({ title: "Marked as paid" });
      load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  if (loading) return <Skel />;

  const earnings: any[] = data?.earnings ?? [];
  const total = earnings.reduce((s, e) => s + e.amount, 0);
  const pending = earnings.filter((e) => e.status === "pending").reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white/[0.04] grid grid-cols-2 divide-x divide-white/[0.06]">
        <div className="p-4">
          <p className="text-[10px] text-white/35 uppercase tracking-wider">Total</p>
          <p className="text-base font-bold text-white font-mono mt-0.5">R{total.toFixed(2)}</p>
        </div>
        <div className="p-4" style={{ borderLeft: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-[10px] text-white/35 uppercase tracking-wider">Pending</p>
          <p className="text-base font-bold font-mono mt-0.5" style={{ color: "#f59e0b" }}>R{pending.toFixed(2)}</p>
        </div>
      </div>
      {earnings.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.04] p-10 text-center">
          <BadgeDollarSign className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No commissions recorded yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {earnings.map((e) => (
            <div key={e.id} className="rounded-2xl bg-white/[0.04] px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-white font-mono">R{e.amount.toFixed(2)}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: e.status === "paid" ? "#34d399" : "#f59e0b" }}>{e.status}</span>
                  <span className="text-[10px] text-white/30 capitalize">{e.type?.replace(/_/g, " ")}</span>
                </div>
                <p className="text-xs text-white/35 mt-0.5">{e.reseller?.name || e.reseller?.username || "—"} → {e.user?.name || e.user?.username || "—"}</p>
                <p className="text-[11px] text-white/20">{e.createdAt ? format(new Date(e.createdAt), "dd MMM yyyy") : "—"} · purchase R{e.purchaseAmount?.toFixed(2)}</p>
              </div>
              {e.status === "pending" && (
                <Chip color="green" onClick={() => markPaid(e.id)}><CheckCircle2 className="w-3 h-3" />Mark Paid</Chip>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Expenses Tab ──────────────────────────────────────────────────────────────
function ExpensesTab() {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ type: "server", amount: "", description: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    adminFetch("/admin/expenses?limit=100").then(setData).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const addExpense = async () => {
    if (!form.amount || !form.description) { toast({ title: "Fill all fields", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await adminFetch("/admin/expenses", { method: "POST", body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }) });
      toast({ title: "Expense added" });
      setForm({ type: "server", amount: "", description: "" });
      setShowAdd(false);
      load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const deleteExpense = async (id: string) => {
    try {
      await adminFetch(`/admin/expenses/${id}`, { method: "DELETE" });
      toast({ title: "Expense deleted" });
      load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  if (loading) return <Skel />;
  const expenses: any[] = data?.expenses ?? [];
  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-white/40">Total: <span className="text-white font-mono font-bold">R{total.toFixed(2)}</span></p>
        <button
          onClick={() => setShowAdd((v) => !v)}
          style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", transition: "all 0.15s" }}
        >
          {showAdd ? "Cancel" : "+ Add Expense"}
        </button>
      </div>

      {showAdd && (
        <div className="rounded-2xl bg-white/[0.04] p-4 space-y-3">
          <p className="text-sm font-semibold text-white/70">New Expense</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/40">Type</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full h-9 rounded-xl bg-white/[0.06] border-0 text-white text-sm px-3 outline-none">
                {["sms", "server", "api", "infrastructure", "other"].map((t) => <option key={t} value={t} className="bg-neutral-900 text-white">{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/40">Amount (R)</label>
              <Input type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="bg-white/[0.06] border-0 text-white h-9 rounded-xl" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-white/40">Description</label>
            <Input placeholder="e.g. Monthly server cost" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="bg-white/[0.06] border-0 text-white rounded-xl" />
          </div>
          <Button className="w-full rounded-xl" disabled={saving} onClick={addExpense}>{saving ? "Saving…" : "Add Expense"}</Button>
        </div>
      )}

      {expenses.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.04] p-10 text-center">
          <Receipt className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No expenses recorded</p>
        </div>
      ) : (
        <div className="space-y-2">
          {expenses.map((e) => (
            <div key={e.id} className="rounded-2xl bg-white/[0.04] px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white font-mono">R{e.amount.toFixed(2)}</span>
                  <span className="text-[10px] text-white/35 capitalize">{e.type}</span>
                </div>
                <p className="text-xs text-white/45 mt-0.5 truncate">{e.description}</p>
                <p className="text-[11px] text-white/20">{e.createdAt ? format(new Date(e.createdAt), "dd MMM yyyy") : "—"}</p>
              </div>
              <button onClick={() => deleteExpense(e.id)} style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(248,113,113,0.7)", flexShrink: 0 }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Payouts Tab ───────────────────────────────────────────────────────────────
function PayoutsTab() {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ resellerId: "", amount: "", notes: "" });
  const [resellers, setResellers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      adminFetch("/admin/payouts?limit=100"),
      adminFetch("/admin/users?role=reseller&limit=50"),
    ]).then(([p, u]) => { setData(p); setResellers(u.users ?? []); }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const createPayout = async () => {
    if (!form.resellerId || !form.amount) { toast({ title: "Fill all fields", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await adminFetch("/admin/payouts", { method: "POST", body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }) });
      toast({ title: "Payout created" });
      setForm({ resellerId: "", amount: "", notes: "" });
      setShowAdd(false);
      load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const markPaid = async (payoutId: string) => {
    try {
      await adminFetch(`/admin/payouts/${payoutId}/mark-paid`, { method: "POST" });
      toast({ title: "Payout marked as paid" });
      load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  if (loading) return <Skel rows={4} h={64} />;
  const payouts: any[] = data?.payouts ?? [];
  const pendingTotal = payouts.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-white/40">Pending: <span style={{ color: "#f59e0b" }} className="font-mono font-bold">R{pendingTotal.toFixed(2)}</span></p>
        <button
          onClick={() => setShowAdd((v) => !v)}
          style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", transition: "all 0.15s" }}
        >
          {showAdd ? "Cancel" : "+ New Payout"}
        </button>
      </div>

      {showAdd && (
        <div className="rounded-2xl bg-white/[0.04] p-4 space-y-3">
          <p className="text-sm font-semibold text-white/70">Create Payout</p>
          <div className="space-y-1">
            <label className="text-xs text-white/40">Reseller</label>
            <select value={form.resellerId} onChange={(e) => setForm((f) => ({ ...f, resellerId: e.target.value }))} className="w-full h-9 rounded-xl bg-white/[0.06] border-0 text-white text-sm px-3 outline-none">
              <option value="" className="bg-neutral-900">Select reseller…</option>
              {resellers.map((r) => <option key={r.id} value={r.id} className="bg-neutral-900 text-white">{r.name || r.username} ({r.email})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/40">Amount (R)</label>
              <Input type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="bg-white/[0.06] border-0 text-white h-9 rounded-xl" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/40">Notes (optional)</label>
              <Input placeholder="e.g. March payout" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="bg-white/[0.06] border-0 text-white h-9 rounded-xl" />
            </div>
          </div>
          <Button className="w-full rounded-xl" disabled={saving} onClick={createPayout}>{saving ? "Creating…" : "Create Payout"}</Button>
        </div>
      )}

      {payouts.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.04] p-10 text-center">
          <CreditCard className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No payouts yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {payouts.map((p) => (
            <div key={p.id} className="rounded-2xl bg-white/[0.04] px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white font-mono">R{p.amount.toFixed(2)}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: p.status === "paid" ? "#34d399" : "#f59e0b" }}>{p.status}</span>
                </div>
                <p className="text-xs text-white/35 mt-0.5">{p.reseller?.name || p.reseller?.username || "—"}</p>
                {p.notes && <p className="text-[11px] text-white/25 truncate">{p.notes}</p>}
                <p className="text-[11px] text-white/20">{p.createdAt ? format(new Date(p.createdAt), "dd MMM yyyy") : "—"}{p.paidAt ? ` · Paid ${format(new Date(p.paidAt), "dd MMM yyyy")}` : ""}</p>
              </div>
              {p.status === "pending" && (
                <Chip color="green" onClick={() => markPaid(p.id)}><CheckCircle2 className="w-3 h-3" />Mark Paid</Chip>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Calls & Abuse Tab ─────────────────────────────────────────────────────────
function CallsAbuseTab() {
  const { toast } = useToast();
  const [view, setView] = useState<"calls" | "stats" | "flags">("calls");
  const [callData, setCallData] = useState<any>(null);
  const [statsData, setStatsData] = useState<any>(null);
  const [flagsData, setFlagsData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showFlag, setShowFlag] = useState(false);
  const [flagForm, setFlagForm] = useState({ userId: "", reason: "", severity: "medium", notes: "" });
  const [saving, setSaving] = useState(false);

  const loadCalls = useCallback(async () => { setLoading(true); try { setCallData(await adminFetch("/admin/calls?limit=50")); } finally { setLoading(false); } }, []);
  const loadStats = useCallback(async () => { setLoading(true); try { setStatsData(await adminFetch("/admin/call-stats?limit=50")); } finally { setLoading(false); } }, []);
  const loadFlags = useCallback(async () => { setLoading(true); try { setFlagsData(await adminFetch("/admin/abuse-flags?limit=50")); } finally { setLoading(false); } }, []);

  useEffect(() => {
    if (view === "calls") loadCalls();
    else if (view === "stats") loadStats();
    else loadFlags();
  }, [view, loadCalls, loadStats, loadFlags]);

  const submitFlag = async () => {
    if (!flagForm.userId || !flagForm.reason) { toast({ title: "Fill all fields", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await adminFetch("/admin/abuse-flags", { method: "POST", body: JSON.stringify(flagForm) });
      toast({ title: "Flag created" });
      setFlagForm({ userId: "", reason: "", severity: "medium", notes: "" });
      setShowFlag(false);
      loadFlags();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const resolveFlag = async (id: string) => {
    try { await adminFetch(`/admin/abuse-flags/${id}/resolve`, { method: "POST" }); toast({ title: "Flag resolved" }); loadFlags(); }
    catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const deleteFlag = async (id: string) => {
    try { await adminFetch(`/admin/abuse-flags/${id}`, { method: "DELETE" }); toast({ title: "Flag removed" }); loadFlags(); }
    catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const sevClr = (s: string) => s === "high" ? "#f87171" : s === "medium" ? "#f59e0b" : "#34d399";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        {(["calls", "stats", "flags"] as const).map((v) => (
          <button key={v}
            onClick={() => setView(v)}
            style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", transition: "all 0.15s", background: view === v ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)", color: view === v ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)" }}
          >
            {v === "calls" ? "Call Logs" : v === "stats" ? "Per-User Stats" : "Abuse Flags"}
          </button>
        ))}
        {view === "flags" && (
          <button onClick={() => setShowFlag((v) => !v)}
            style={{ marginLeft: "auto", padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "rgba(248,113,113,0.1)", color: "#f87171" }}
          >
            <Flag className="w-3 h-3 inline mr-1" />{showFlag ? "Cancel" : "New Flag"}
          </button>
        )}
      </div>

      {view === "flags" && showFlag && (
        <div className="rounded-2xl bg-white/[0.04] p-4 space-y-3">
          <p className="text-sm font-semibold text-white/70">Flag User</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><label className="text-xs text-white/40">User ID</label><Input value={flagForm.userId} onChange={(e) => setFlagForm((f) => ({ ...f, userId: e.target.value }))} placeholder="User ID" className="bg-white/[0.06] border-0 text-white h-9 rounded-xl text-xs" /></div>
            <div className="space-y-1"><label className="text-xs text-white/40">Severity</label>
              <select value={flagForm.severity} onChange={(e) => setFlagForm((f) => ({ ...f, severity: e.target.value }))} className="w-full h-9 rounded-xl bg-white/[0.06] border-0 text-white text-xs px-2 outline-none">
                {["low", "medium", "high"].map((s) => <option key={s} value={s} className="bg-neutral-900 capitalize">{s}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1"><label className="text-xs text-white/40">Reason</label><Input value={flagForm.reason} onChange={(e) => setFlagForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Reason for flagging" className="bg-white/[0.06] border-0 text-white h-9 rounded-xl text-xs" /></div>
          <Button className="w-full rounded-xl" disabled={saving} onClick={submitFlag}>{saving ? "Saving…" : "Create Flag"}</Button>
        </div>
      )}

      {loading ? <Skel /> : view === "calls" ? (
        <div className="space-y-2">
          {(callData?.calls ?? []).length === 0 && <div className="rounded-2xl bg-white/[0.04] p-10 text-center"><PhoneCall className="w-6 h-6 text-white/15 mx-auto mb-2" /><p className="text-white/25 text-sm">No calls recorded</p></div>}
          {(callData?.calls ?? []).map((c: any) => (
            <div key={c.id} className="rounded-2xl bg-white/[0.04] px-4 py-3 flex items-center gap-3">
              <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: c.status === "completed" ? "#34d399" : c.status === "failed" ? "#f87171" : "#f59e0b" }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">{c.username ?? c.userId}</span>
                  <span className="text-xs text-white/35">→ {c.destination}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-white/30">{c.status}</span>
                  {c.duration > 0 && <span className="text-[10px] text-white/25">{Math.floor(c.duration / 60)}m {c.duration % 60}s</span>}
                  {c.createdAt && <span className="text-[10px] text-white/20">{format(new Date(c.createdAt), "dd MMM HH:mm")}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : view === "stats" ? (
        <div className="space-y-2">
          {(statsData?.stats ?? []).length === 0 && <div className="rounded-2xl bg-white/[0.04] p-10 text-center"><BarChart3 className="w-6 h-6 text-white/15 mx-auto mb-2" /><p className="text-white/25 text-sm">No call stats</p></div>}
          {(statsData?.stats ?? []).map((s: any) => (
            <div key={s.userId} className="rounded-2xl bg-white/[0.04] px-4 py-3 flex items-center gap-3">
              {s.suspicious && <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: "#f87171" }} />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{s.user?.username ?? s.userId}</span>
                  {s.suspicious && <span style={{ fontSize: 10, fontWeight: 600, color: "#f87171" }}>suspicious</span>}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-white/40">{s.totalCalls} calls</span>
                  <span className="text-xs text-white/30">{Math.floor(s.totalDuration / 60)}m</span>
                  <span style={{ fontSize: 11, color: s.failedRate > 50 ? "#f87171" : "rgba(255,255,255,0.3)" }}>{s.failedRate}% failed</span>
                </div>
              </div>
              <span className="text-xs text-white/20 shrink-0">{s.user?.email ?? ""}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {(flagsData?.flags ?? []).length === 0 && <div className="rounded-2xl bg-white/[0.04] p-10 text-center"><Flag className="w-6 h-6 text-white/15 mx-auto mb-2" /><p className="text-white/25 text-sm">No abuse flags</p></div>}
          {(flagsData?.flags ?? []).map((f: any) => (
            <div key={f.id} className="rounded-2xl bg-white/[0.04] px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{f.user?.username ?? f.userId}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: sevClr(f.severity) }}>{f.severity}</span>
                  {f.resolvedAt && <span style={{ fontSize: 10, fontWeight: 600, color: "#34d399" }}>resolved</span>}
                </div>
                <p className="text-xs text-white/40 mt-0.5 truncate">{f.reason}</p>
                {f.notes && <p className="text-xs text-white/25 truncate">{f.notes}</p>}
                <p className="text-[10px] text-white/20">{f.createdAt ? format(new Date(f.createdAt), "dd MMM yyyy") : ""}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {!f.resolvedAt && (
                  <button onClick={() => resolveFlag(f.id)} style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(52,211,153,0.1)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#34d399" }}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={() => deleteFlag(f.id)} style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#f87171" }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Rate Plans Tab ────────────────────────────────────────────────────────────
interface RateRow { prefix: string; coinsPerMinute: number; description?: string }
interface RatePlanForm {
  name: string;
  currency: string;
  defaultCoinsPerMinute: number;
  isActive: boolean;
  rates: RateRow[];
}

const EMPTY_RATE_PLAN: RatePlanForm = {
  name: "",
  currency: "ZAR",
  defaultCoinsPerMinute: 1,
  isActive: true,
  rates: [],
};

function RatePlansTab() {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<RatePlanForm>(EMPTY_RATE_PLAN);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminFetch("/admin/rate-plans?limit=100")); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setForm(EMPTY_RATE_PLAN); setShowForm(true); };
  const openEdit = (p: any) => {
    setEditing(p);
    setForm({
      name: p.name ?? "",
      currency: p.currency ?? "ZAR",
      defaultCoinsPerMinute: Number(p.defaultCoinsPerMinute ?? 1),
      isActive: p.isActive !== false,
      rates: Array.isArray(p.rates)
        ? p.rates.map((r: any) => ({ prefix: String(r.prefix ?? ""), coinsPerMinute: Number(r.coinsPerMinute ?? 1), description: r.description ?? "" }))
        : [],
    });
    setShowForm(true);
  };

  const addRate = () => setForm((f) => ({ ...f, rates: [...f.rates, { prefix: "", coinsPerMinute: f.defaultCoinsPerMinute, description: "" }] }));
  const updateRate = (i: number, patch: Partial<RateRow>) =>
    setForm((f) => ({ ...f, rates: f.rates.map((r, idx) => idx === i ? { ...r, ...patch } : r) }));
  const removeRate = (i: number) => setForm((f) => ({ ...f, rates: f.rates.filter((_, idx) => idx !== i) }));

  const save = async () => {
    if (!form.name.trim()) { toast({ title: "Plan name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        currency: form.currency.trim() || "ZAR",
        defaultCoinsPerMinute: Number(form.defaultCoinsPerMinute) || 0,
        isActive: form.isActive,
        rates: form.rates
          .filter((r) => r.prefix.trim())
          .map((r) => ({ prefix: r.prefix.trim(), coinsPerMinute: Number(r.coinsPerMinute) || 0, description: r.description?.trim() || undefined })),
      };
      if (editing) {
        await adminFetch(`/admin/rate-plans/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
        toast({ title: "Rate plan updated" });
      } else {
        await adminFetch("/admin/rate-plans", { method: "POST", body: JSON.stringify(body) });
        toast({ title: "Rate plan created" });
      }
      setShowForm(false);
      load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const toggle = async (p: any) => {
    try {
      await adminFetch(`/admin/rate-plans/${p.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !p.isActive }) });
      toast({ title: p.isActive ? "Deactivated" : "Activated" });
      load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  if (loading) return <Skel rows={3} h={80} />;
  const plans: any[] = data?.ratePlans ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-white/35">{plans.length} rate plan{plans.length !== 1 ? "s" : ""}</p>
        <button
          onClick={openNew}
          style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "rgba(129,140,248,0.15)", color: "#818cf8" }}
        >
          + New
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl bg-white/[0.04] p-4 space-y-3">
          <p className="text-sm font-semibold text-white/70">{editing ? "Edit Rate Plan" : "New Rate Plan"}</p>
          <Input placeholder="Plan name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="bg-white/[0.06] border-0 text-white rounded-xl" />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/40">Currency</label>
              <Input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} className="bg-white/[0.06] border-0 text-white rounded-xl" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/40">Default coins / min</label>
              <Input type="number" min={0} step="0.01" value={form.defaultCoinsPerMinute} onChange={(e) => setForm((f) => ({ ...f, defaultCoinsPerMinute: Number(e.target.value) }))} className="bg-white/[0.06] border-0 text-white rounded-xl" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-white/40">Prefix rates</label>
              <button onClick={addRate} style={{ fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", background: "transparent", color: "#818cf8" }}>+ Add rate</button>
            </div>
            {form.rates.length === 0 ? (
              <p className="text-[11px] text-white/25">No per-prefix overrides — the default rate applies to all destinations.</p>
            ) : (
              form.rates.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input placeholder="Prefix (e.g. 27)" value={r.prefix} onChange={(e) => updateRate(i, { prefix: e.target.value })} className="bg-white/[0.06] border-0 text-white rounded-xl flex-1" />
                  <Input type="number" min={0} step="0.01" placeholder="coins/min" value={r.coinsPerMinute} onChange={(e) => updateRate(i, { coinsPerMinute: Number(e.target.value) })} className="bg-white/[0.06] border-0 text-white rounded-xl w-28" />
                  <Input placeholder="Label" value={r.description ?? ""} onChange={(e) => updateRate(i, { description: e.target.value })} className="bg-white/[0.06] border-0 text-white rounded-xl flex-1" />
                  <button onClick={() => removeRate(i)} style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "rgba(248,113,113,0.1)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#f87171", flexShrink: 0 }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Active
          </label>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button className="flex-1 rounded-xl" disabled={saving} onClick={save}>{saving ? "Saving…" : editing ? "Update" : "Create"}</Button>
          </div>
        </div>
      )}

      {plans.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.04] p-10 text-center">
          <Tag className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No rate plans</p>
        </div>
      ) : (
        <div className="space-y-2">
          {plans.map((p) => (
            <div key={p.id} className="rounded-2xl bg-white/[0.04] p-4">
              <div className="flex items-start gap-3">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{p.name}</span>
                    <span style={{ fontSize: 10, color: p.isActive ? "#34d399" : "rgba(255,255,255,0.3)" }}>{p.isActive ? "● active" : "○ inactive"}</span>
                  </div>
                  <p className="text-xs text-white/40 mt-1">
                    {p.currency ?? "ZAR"} · default {p.defaultCoinsPerMinute ?? 1} coins/min · {Array.isArray(p.rates) ? p.rates.length : 0} prefix rate{(Array.isArray(p.rates) ? p.rates.length : 0) !== 1 ? "s" : ""}
                  </p>
                  <p className="text-[10px] text-white/20 mt-1">{p.updatedAt ? `Updated ${format(new Date(p.updatedAt), "dd MMM yyyy")}` : "—"}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => toggle(p)} style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.5)" }}>
                    {p.isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => openEdit(p)} style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.5)" }}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Announcements Tab ─────────────────────────────────────────────────────────
function AnnouncementsTab() {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ title: "", message: "", type: "info", target: "all", isActive: true, expiresAt: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminFetch("/admin/announcements?limit=50")); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setForm({ title: "", message: "", type: "info", target: "all", isActive: true, expiresAt: "" }); setShowForm(true); };
  const openEdit = (a: any) => {
    setEditing(a);
    setForm({ title: a.title, message: a.message, type: a.type, target: a.target, isActive: a.isActive, expiresAt: a.expiresAt ? a.expiresAt.slice(0, 10) : "" });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.title || !form.message) { toast({ title: "Fill title and message", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body = { ...form, expiresAt: form.expiresAt || null };
      if (editing) {
        await adminFetch(`/admin/announcements/${editing.id}`, { method: "PUT", body: JSON.stringify(body) });
        toast({ title: "Announcement updated" });
      } else {
        await adminFetch("/admin/announcements", { method: "POST", body: JSON.stringify(body) });
        toast({ title: "Announcement created" });
      }
      setShowForm(false);
      load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const toggle = async (a: any) => {
    try {
      await adminFetch(`/admin/announcements/${a.id}`, { method: "PUT", body: JSON.stringify({ isActive: !a.isActive }) });
      toast({ title: a.isActive ? "Deactivated" : "Activated" });
      load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const deleteAnn = async (id: string) => {
    try {
      await adminFetch(`/admin/announcements/${id}`, { method: "DELETE" });
      toast({ title: "Deleted" });
      load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  if (loading) return <Skel rows={3} h={80} />;
  const anns: any[] = data?.announcements ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-white/35">{anns.length} announcement{anns.length !== 1 ? "s" : ""}</p>
        <button
          onClick={openNew}
          style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "rgba(129,140,248,0.15)", color: "#818cf8" }}
        >
          + New
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl bg-white/[0.04] p-4 space-y-3">
          <p className="text-sm font-semibold text-white/70">{editing ? "Edit Announcement" : "New Announcement"}</p>
          <Input placeholder="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="bg-white/[0.06] border-0 text-white rounded-xl" />
          <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder="Message body…" rows={3} className="w-full bg-white/[0.06] rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/20 resize-none focus:outline-none" />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/40">Type</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full h-9 rounded-xl bg-white/[0.06] border-0 text-white text-sm px-3 outline-none">
                {["info", "warning", "promo", "maintenance"].map((t) => <option key={t} value={t} className="bg-neutral-900 capitalize">{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/40">Target</label>
              <select value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} className="w-full h-9 rounded-xl bg-white/[0.06] border-0 text-white text-sm px-3 outline-none">
                {["all", "reseller", "user"].map((t) => <option key={t} value={t} className="bg-neutral-900 capitalize">{t}</option>)}
              </select>
            </div>
          </div>
          <Input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} className="bg-white/[0.06] border-0 text-white rounded-xl" />
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button className="flex-1 rounded-xl" disabled={saving} onClick={save}>{saving ? "Saving…" : editing ? "Update" : "Create"}</Button>
          </div>
        </div>
      )}

      {anns.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.04] p-10 text-center">
          <Megaphone className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No announcements</p>
        </div>
      ) : (
        <div className="space-y-2">
          {anns.map((a) => {
            const clr = a.type === "warning" ? "#f59e0b" : a.type === "promo" ? "#a78bfa" : "#60a5fa";
            return (
              <div key={a.id} className="rounded-2xl bg-white/[0.04] p-4">
                <div className="flex items-start gap-3">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{a.title}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: clr, textTransform: "capitalize" }}>{a.type}</span>
                      <span style={{ fontSize: 10, color: a.isActive ? "#34d399" : "rgba(255,255,255,0.3)" }}>{a.isActive ? "● live" : "○ off"}</span>
                    </div>
                    <p className="text-xs text-white/40 mt-1 line-clamp-2">{a.message}</p>
                    <p className="text-[10px] text-white/20 mt-1">{a.target} · {a.createdAt ? format(new Date(a.createdAt), "dd MMM yyyy") : "—"}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => toggle(a)} style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.5)" }}>
                      {a.isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => openEdit(a)} style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.5)" }}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => deleteAnn(a.id)} style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "rgba(248,113,113,0.1)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#f87171" }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Push Notifications Tab ────────────────────────────────────────────────────

const PUSH_TYPES = [
  { value: "update",       label: "App Update",          icon: RefreshCw,  color: "#1a8cff", preset: { title: "Update Available", body: "A new version of PRaww+ is available. Please update your app." } },
  { value: "maintenance",  label: "Maintenance",          icon: Wrench,     color: "#f59e0b", preset: { title: "Scheduled Maintenance", body: "PRaww+ will be undergoing maintenance. Service may be briefly interrupted." } },
  { value: "info",         label: "Service Notice",       icon: Info,       color: "#30d158", preset: { title: "Service Notice", body: "" } },
  { value: "admin_message",label: "Custom Message",       icon: BellRing,   color: "#a78bfa", preset: { title: "", body: "" } },
] as const;

const PUSH_TARGETS = [
  { value: "all",        label: "All users",      icon: Users2   },
  { value: "users",      label: "Regular users",  icon: Users    },
  { value: "resellers",  label: "Resellers only", icon: DollarSign },
] as const;

interface PushResult { recipients: number; sent: number; fcmOk: number; expoOk: number; webPushOk: number; skipped: number; errors: number; }
interface NotifStatus { hasWebPush: boolean; hasFcm: boolean; hasExpo: boolean; dnd: boolean; notificationPrefs: Record<string, boolean>; vapidConfigured: boolean; }

function PushTab() {
  const { toast } = useToast();
  const [msgType,  setMsgType]  = useState<string>("update");
  const [target,   setTarget]   = useState<string>("all");
  const [title,    setTitle]    = useState("");
  const [body,     setBody]     = useState("");
  const [sending,  setSending]  = useState(false);
  const [result,   setResult]   = useState<PushResult | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  const [diagUserId,  setDiagUserId]  = useState("");
  const [diagStatus,  setDiagStatus]  = useState<NotifStatus | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError,   setDiagError]   = useState<string | null>(null);
  const [testSending, setTestSending] = useState(false);
  const [testResult,  setTestResult]  = useState<Record<string, any> | null>(null);
  const [clearing,    setClearing]    = useState(false);

  const applyPreset = (type: string) => {
    const preset = PUSH_TYPES.find((t) => t.value === type)?.preset;
    if (preset) {
      if (preset.title) setTitle(preset.title);
      if (preset.body)  setBody(preset.body);
    }
    setMsgType(type);
    setResult(null);
    setError(null);
  };

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) { setError("Title and message are required."); return; }
    setSending(true); setResult(null); setError(null);
    try {
      const data = await adminFetch("/admin/push", {
        method: "POST",
        body: JSON.stringify({ target, type: msgType, title: title.trim(), body: body.trim() }),
      });
      setResult(data);
      toast({ title: "Push sent", description: `Delivered to ${data.sent} / ${data.recipients} recipient(s).` });
    } catch (e: any) {
      setError(e.message ?? "Failed to send push");
    } finally {
      setSending(false);
    }
  };

  const loadDiag = async () => {
    if (!diagUserId.trim()) return;
    setDiagLoading(true); setDiagStatus(null); setDiagError(null); setTestResult(null);
    try {
      const data = await adminFetch(`/admin/users/${diagUserId.trim()}/notification-status`);
      setDiagStatus(data);
    } catch (e: any) {
      setDiagError(e.message ?? "User not found");
    } finally {
      setDiagLoading(false);
    }
  };

  const sendTestPush = async () => {
    setTestSending(true); setTestResult(null);
    try {
      const data = await adminFetch(`/admin/users/${diagUserId.trim()}/test-push`, { method: "POST" });
      setTestResult(data.results ?? {});
      if (data.ok) toast({ title: "Test push sent" });
      else toast({ title: "No push channels", description: data.message, variant: "destructive" });
      await loadDiag();
    } catch (e: any) {
      toast({ title: "Test push failed", description: e.message, variant: "destructive" });
    } finally {
      setTestSending(false);
    }
  };

  const clearWebPush = async () => {
    setClearing(true);
    try {
      await adminFetch(`/admin/users/${diagUserId.trim()}/web-push-subscription`, { method: "DELETE" });
      toast({ title: "Web push subscription cleared" });
      await loadDiag();
    } catch (e: any) {
      toast({ title: "Failed to clear", description: e.message, variant: "destructive" });
    } finally {
      setClearing(false);
    }
  };

  const activeType = PUSH_TYPES.find((t) => t.value === msgType)!;
  const TypeIcon   = activeType.icon;

  const pill = (ok: boolean, label: string) => (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: ok ? "rgba(48,209,88,0.12)" : "rgba(255,69,58,0.10)",
      color: ok ? "#30d158" : "#ff453a",
      border: `1px solid ${ok ? "rgba(48,209,88,0.25)" : "rgba(255,69,58,0.2)"}`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: ok ? "#30d158" : "#ff453a" }} />
      {label}
    </span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 560 }}>

      {/* ── Section: User Notification Diagnostics ── */}
      <div>
        <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>User notification diagnostics</p>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Input
              placeholder="User ID (MongoDB _id)"
              value={diagUserId}
              onChange={(e) => { setDiagUserId(e.target.value); setDiagStatus(null); setDiagError(null); setTestResult(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") loadDiag(); }}
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: "#fff", borderRadius: 10, fontSize: 13, flex: 1 }}
            />
            <button
              onClick={loadDiag}
              disabled={diagLoading || !diagUserId.trim()}
              style={{
                flexShrink: 0, padding: "0 14px", borderRadius: 10, fontSize: 12, fontWeight: 700,
                background: "rgba(26,140,255,0.15)", border: "1px solid rgba(26,140,255,0.3)",
                color: "#1a8cff", cursor: diagLoading || !diagUserId.trim() ? "not-allowed" : "pointer",
                opacity: diagLoading || !diagUserId.trim() ? 0.5 : 1,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {diagLoading ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : null}
              {diagLoading ? "Loading…" : "Check"}
            </button>
          </div>

          {diagError && (
            <p style={{ fontSize: 12, color: "#f87171", margin: 0 }}>{diagError}</p>
          )}

          {diagStatus && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {pill(diagStatus.hasWebPush, "Web Push")}
                {pill(diagStatus.hasFcm, "FCM")}
                {pill(diagStatus.hasExpo, "Expo")}
                {pill(diagStatus.vapidConfigured, "VAPID")}
                {diagStatus.dnd && <span style={{ padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "rgba(255,149,0,0.12)", color: "#ff9500", border: "1px solid rgba(255,149,0,0.25)" }}>DND on</span>}
              </div>

              {!diagStatus.vapidConfigured && (
                <p style={{ fontSize: 11, color: "#ff9500", margin: 0, background: "rgba(255,149,0,0.07)", borderRadius: 8, padding: "7px 10px" }}>
                  ⚠ VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set on the server — web push won't work until these are configured.
                </p>
              )}

              {diagStatus.hasWebPush && !diagStatus.vapidConfigured && (
                <p style={{ fontSize: 11, color: "#ff453a", margin: 0 }}>
                  User has a saved subscription but VAPID keys are missing — their web push will fail.
                </p>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={sendTestPush}
                  disabled={testSending || (!diagStatus.hasWebPush && !diagStatus.hasFcm && !diagStatus.hasExpo)}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 10, fontSize: 12, fontWeight: 700,
                    background: "rgba(94,92,230,0.15)", border: "1px solid rgba(94,92,230,0.3)", color: "#a78bfa",
                    cursor: testSending ? "wait" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    opacity: (!diagStatus.hasWebPush && !diagStatus.hasFcm && !diagStatus.hasExpo) ? 0.4 : 1,
                  }}
                >
                  {testSending ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" /> : <Send style={{ width: 11, height: 11 }} />}
                  {testSending ? "Sending…" : "Send test push"}
                </button>
                {diagStatus.hasWebPush && (
                  <button
                    onClick={clearWebPush}
                    disabled={clearing}
                    style={{
                      padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 700,
                      background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.25)", color: "#ff453a",
                      cursor: clearing ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", gap: 6,
                    }}
                  >
                    {clearing ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" /> : <Trash2 style={{ width: 11, height: 11 }} />}
                    Clear web sub
                  </button>
                )}
              </div>

              {testResult && (
                <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "8px 12px" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 6px" }}>Test result</p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {"webPush" in testResult && pill(testResult.webPush === true, `Web Push ${testResult.webPush ? "✓" : "✗"}`)}
                    {"fcm"     in testResult && pill(testResult.fcm === true,     `FCM ${testResult.fcm ? "✓" : "✗"}`)}
                    {"expo"    in testResult && pill(testResult.expo === true,    `Expo ${testResult.expo ? "✓" : "✗"}`)}
                  </div>
                  {testResult.webPushNote  && <p style={{ fontSize: 11, color: "#ff9500", margin: "6px 0 0" }}>{testResult.webPushNote}</p>}
                  {testResult.webPushError && <p style={{ fontSize: 11, color: "#f87171", margin: "6px 0 0" }}>Web Push error: {testResult.webPushError}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Section: Message type ── */}
      <div>
        <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Broadcast — message type</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {PUSH_TYPES.map(({ value, label, icon: Icon, color }) => {
            const active = msgType === value;
            return (
              <button
                key={value}
                onClick={() => applyPreset(value)}
                style={{
                  display: "flex", alignItems: "center", gap: 9,
                  padding: "10px 13px", borderRadius: 12,
                  background: active ? `${color}18` : "rgba(255,255,255,0.04)",
                  border: `1px solid ${active ? color + "55" : "rgba(255,255,255,0.08)"}`,
                  color: active ? color : "rgba(255,255,255,0.45)",
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                  textAlign: "left", transition: "all 0.15s",
                }}
              >
                <Icon style={{ width: 14, height: 14, flexShrink: 0 }} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Section: Target ── */}
      <div>
        <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Send to</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {PUSH_TARGETS.map(({ value, label, icon: Icon }) => {
            const active = target === value;
            return (
              <button
                key={value}
                onClick={() => { setTarget(value); setResult(null); }}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "7px 14px", borderRadius: 20,
                  background: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${active ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.07)"}`,
                  color: active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <Icon style={{ width: 12, height: 12 }} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Section: Compose ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>Compose</p>
        <Input
          placeholder="Notification title"
          value={title}
          onChange={(e) => { setTitle(e.target.value); setResult(null); }}
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: "#fff", borderRadius: 10, fontSize: 14 }}
        />
        <textarea
          placeholder="Notification message body"
          value={body}
          onChange={(e) => { setBody(e.target.value); setResult(null); }}
          rows={3}
          style={{
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 10, color: "#fff", fontSize: 13, padding: "10px 12px",
            resize: "vertical", outline: "none", fontFamily: "inherit", lineHeight: 1.5,
          }}
        />
      </div>

      {/* ── Preview card ── */}
      {(title || body) && (
        <div style={{
          background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12, padding: "12px 14px",
        }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 6px" }}>Preview</p>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{
              width: 36, height: 36, borderRadius: 9, flexShrink: 0,
              background: `${activeType.color}22`, border: `1px solid ${activeType.color}44`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <TypeIcon style={{ width: 16, height: 16, color: activeType.color }} />
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#fff", margin: 0 }}>{title || "Notification title"}</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "3px 0 0", lineHeight: 1.4 }}>{body || "Your message body."}</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", margin: "4px 0 0" }}>now · PRaww+</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-start",
          background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)",
          borderRadius: 10, padding: "10px 14px",
        }}>
          <AlertTriangle style={{ width: 14, height: 14, color: "#f87171", flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12, color: "#f87171" }}>{error}</span>
        </div>
      )}

      {/* ── Result ── */}
      {result && (
        <div style={{
          background: "rgba(48,209,88,0.08)", border: "1px solid rgba(48,209,88,0.25)",
          borderRadius: 12, padding: "14px 16px",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CheckCircle2 style={{ width: 15, height: 15, color: "#30d158" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#30d158" }}>Broadcast sent</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            {[
              { label: "Recipients", value: result.recipients },
              { label: "Delivered",  value: result.sent },
              { label: "FCM",        value: result.fcmOk  },
              { label: "Expo",       value: result.expoOk },
              { label: "Web Push",   value: result.webPushOk ?? 0 },
              { label: "Skipped",    value: result.skipped },
            ].map(({ label, value }) => (
              <div key={label} style={{
                background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px", textAlign: "center",
              }}>
                <p style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: "#fff", margin: 0 }}>{value}</p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", margin: "2px 0 0" }}>{label}</p>
              </div>
            ))}
          </div>
          {result.skipped > 0 && (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: 0 }}>
              {result.skipped} user(s) skipped — no registered push channel (FCM, Expo, or Web Push).
            </p>
          )}
        </div>
      )}

      {/* ── Send button ── */}
      <button
        onClick={handleSend}
        disabled={sending || !title.trim() || !body.trim()}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          padding: "13px 0", borderRadius: 14,
          background: sending || !title.trim() || !body.trim()
            ? "rgba(255,255,255,0.05)"
            : `${activeType.color}22`,
          border: `1px solid ${sending || !title.trim() || !body.trim() ? "rgba(255,255,255,0.08)" : activeType.color + "55"}`,
          color: sending || !title.trim() || !body.trim() ? "rgba(255,255,255,0.2)" : activeType.color,
          fontSize: 14, fontWeight: 700, cursor: sending ? "wait" : !title.trim() || !body.trim() ? "not-allowed" : "pointer",
          transition: "all 0.15s",
        }}
      >
        {sending
          ? <Loader2 style={{ width: 15, height: 15, animation: "spin 1s linear infinite" }} />
          : <Send style={{ width: 15, height: 15 }} />}
        {sending ? "Sending…" : `Send to ${PUSH_TARGETS.find((t) => t.value === target)?.label ?? "all"}`}
      </button>

      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center", margin: 0 }}>
        Broadcast delivers to FCM (Android), Expo (iOS), and Web Push (browser) channels.
        Users without any registered channel are automatically skipped.
      </p>
    </div>
  );
}

// ─── Live Calls Tab ────────────────────────────────────────────────────────────

interface EslTraceEntry {
  event:  string;
  ts:     string; // ISO
  cause?: string; // FS hangup/destroy cause when available
}

interface LiveCall {
  id:              string;
  fsCallId:        string | null;
  status:          string;
  callType:        string;
  direction:       string;
  callerNumber:    string | null;
  recipientNumber: string | null;
  createdAt:       string;
  startedAt:       string | null;
  updatedAt:       string;
  ageMs:           number;
  // ESL diagnostics
  lastEslEvent:       string | null;
  lastEslEventAt:     string | null;
  lastEslEventAgeMs:  number | null;
  eslTrace:           EslTraceEntry[];
  user: {
    id:        string;
    username:  string;
    extension: number | null;
    phone:     string | null;
  } | null;
}

const FSM_STEPS = ["initiated", "ringing", "answered"] as const;

const STATUS_COLOR: Record<string, string> = {
  initiated: "#f59e0b",
  ringing:   "#1a8cff",
  answered:  "#30d158",
};

const DIRECTION_COLOR: Record<string, string> = {
  inbound:  "#a78bfa",
  outbound: "#38bdf8",
};

function useLiveDuration(startedAt: string | null, status: string): string {
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (status !== "answered" || !startedAt) { setElapsed(0); return; }
    const base = Date.now() - new Date(startedAt).getTime();
    setElapsed(Math.floor(base / 1000));
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [startedAt, status]);

  if (status !== "answered" || !startedAt) return "";
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function FsmTimeline({ status }: { status: string }) {
  const currentIdx = FSM_STEPS.indexOf(status as any);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
      {FSM_STEPS.map((step, i) => {
        const past    = currentIdx > i;
        const active  = currentIdx === i;

        const color   = active ? STATUS_COLOR[step] ?? "#fff" : past ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.12)";
        return (
          <div key={step} style={{ display: "flex", alignItems: "center" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "3px 10px",
              borderRadius: 20,
              background: active ? `${color}22` : "transparent",
              border: `1px solid ${active ? color : "rgba(255,255,255,0.08)"}`,
              fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
              color,
              textTransform: "uppercase",
              transition: "all 0.3s",
            }}>
              {active && (
                <span style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: color,
                  boxShadow: `0 0 6px ${color}`,
                  flexShrink: 0,
                  animation: "pulse 1.5s infinite",
                }} />
              )}
              {past && (
                <CheckCircle2 style={{ width: 9, height: 9, flexShrink: 0 }} />
              )}
              {step}
            </div>
            {i < FSM_STEPS.length - 1 && (
              <div style={{
                width: 18, height: 1,
                background: past ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)",
                flexShrink: 0,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CallTraceCard({ call, onForceHangup }: { call: LiveCall; onForceHangup: (id: string) => Promise<void> }) {
  const duration = useLiveDuration(call.startedAt, call.status);
  const caller   = call.callerNumber ?? call.user?.extension?.toString() ?? "—";
  const callee   = call.recipientNumber ?? "—";
  const statusColor = STATUS_COLOR[call.status] ?? "#fff";
  const [hanging, setHanging] = useState(false);

  const handleHangup = async () => {
    if (hanging) return;
    setHanging(true);
    try { await onForceHangup(call.id); }
    finally { setHanging(false); }
  };

  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: `1px solid ${call.status === "answered" ? "rgba(48,209,88,0.2)" : call.status === "ringing" ? "rgba(26,140,255,0.2)" : "rgba(255,159,10,0.2)"}`,
      borderRadius: 14,
      padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>

      {/* Top row: type / direction / user / duration */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* call type badge */}
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: "0.07em",
          textTransform: "uppercase",
          padding: "2px 7px", borderRadius: 10,
          background: call.callType === "internal" ? "rgba(94,92,230,0.2)" : "rgba(255,159,10,0.18)",
          color:      call.callType === "internal" ? "#a78bfa"              : "#ff9f0a",
          border:     `1px solid ${call.callType === "internal" ? "rgba(94,92,230,0.3)" : "rgba(255,159,10,0.3)"}`,
        }}>
          {call.callType}
        </span>
        {/* direction badge */}
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: DIRECTION_COLOR[call.direction] ?? "rgba(255,255,255,0.4)",
        }}>
          {call.direction}
        </span>
        {/* dot separator */}
        <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 10 }}>·</span>
        {/* user */}
        {call.user && (
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>
            {call.user.username}
            {call.user.extension && (
              <span style={{ color: "rgba(255,255,255,0.3)", marginLeft: 4 }}>ext {call.user.extension}</span>
            )}
          </span>
        )}
        {/* spacer + live duration */}
        <span style={{ flex: 1 }} />
        {duration && (
          <span style={{
            fontSize: 13, fontWeight: 700, fontFamily: "monospace",
            color: "#30d158",
            background: "rgba(48,209,88,0.1)",
            border: "1px solid rgba(48,209,88,0.2)",
            borderRadius: 8, padding: "2px 8px",
          }}>
            {duration}
          </span>
        )}
      </div>

      {/* Route: caller → callee */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "4px 10px",
        }}>
          <Phone style={{ width: 10, height: 10, color: "rgba(255,255,255,0.35)" }} />
          <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "monospace", color: "rgba(255,255,255,0.75)" }}>
            {caller}
          </span>
        </div>
        <ArrowRight style={{ width: 13, height: 13, color: statusColor, flexShrink: 0 }} />
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "4px 10px",
        }}>
          <Phone style={{ width: 10, height: 10, color: "rgba(255,255,255,0.35)" }} />
          <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "monospace", color: "rgba(255,255,255,0.75)" }}>
            {callee}
          </span>
        </div>
      </div>

      {/* FSM timeline */}
      <FsmTimeline status={call.status} />

      {/* ── ESL diagnostics panel ── */}
      {(() => {
        const noEslActivity  = !call.lastEslEvent;
        const ageS           = Math.round((call.ageMs ?? 0) / 1000);
        const isStuck        = call.status === "initiated" && ageS > 20 && noEslActivity;
        const eslAgeS        = call.lastEslEventAgeMs != null ? Math.round(call.lastEslEventAgeMs / 1000) : null;

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>

            {/* Stuck-call warning banner */}
            {isStuck && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 7,
                background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)",
                borderRadius: 8, padding: "7px 10px",
              }}>
                <AlertTriangle style={{ width: 12, height: 12, color: "#f87171", flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 11, color: "#f87171", lineHeight: 1.4 }}>
                  Call has been in INITIATED state for <strong>{ageS} s</strong> with no FreeSWITCH
                  activity — likely a SIP registration failure or dialplan misconfiguration.
                  The auto-recovery timer will mark it failed at 20 s.
                </span>
              </div>
            )}

            {/* ESL event row */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)" }}>
                ESL
              </span>
              {noEslActivity ? (
                <span style={{ fontSize: 10, color: "rgba(255,159,10,0.7)", display: "flex", alignItems: "center", gap: 4 }}>
                  <WifiOff style={{ width: 9, height: 9 }} /> No FreeSWITCH events received
                </span>
              ) : (
                <span style={{ fontSize: 10, color: "rgba(96,165,250,0.85)", fontFamily: "monospace" }}>
                  {call.lastEslEvent}
                  {eslAgeS != null && (
                    <span style={{ marginLeft: 6, color: "rgba(255,255,255,0.3)", fontFamily: "inherit" }}>
                      {eslAgeS < 60 ? `${eslAgeS} s ago` : `${Math.round(eslAgeS / 60)} min ago`}
                    </span>
                  )}
                </span>
              )}

              {/* ESL trace chips */}
              {call.eslTrace.length > 0 && (
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginLeft: 4 }}>
                  {call.eslTrace.map((entry, i) => {
                    const isTerminal = entry.event === "CHANNEL_HANGUP_COMPLETE" || entry.event === "CHANNEL_DESTROY";
                    const hasCause   = !!entry.cause;
                    const isLast     = i === call.eslTrace.length - 1;
                    const bg    = isTerminal ? "rgba(248,113,113,0.12)" : isLast ? "rgba(96,165,250,0.15)" : "rgba(96,165,250,0.07)";
                    const bdr   = isTerminal ? "rgba(248,113,113,0.3)"  : isLast ? "rgba(96,165,250,0.3)"  : "rgba(96,165,250,0.15)";
                    const clr   = isTerminal ? "#f87171"                 : isLast ? "rgba(96,165,250,0.9)"  : "rgba(96,165,250,0.6)";
                    const label = entry.event.replace("CHANNEL_", "");
                    const tip   = `${new Date(entry.ts).toLocaleTimeString()}${hasCause ? `\n${entry.cause}` : ""}`;
                    return (
                      <span
                        key={i}
                        title={tip}
                        style={{
                          fontSize: 8, fontWeight: 700, letterSpacing: "0.04em",
                          padding: "1px 6px", borderRadius: 6,
                          background: bg, border: `1px solid ${bdr}`, color: clr,
                          fontFamily: "monospace",
                          display: "inline-flex", alignItems: "center", gap: 3,
                        }}
                      >
                        {label}
                        {hasCause && (
                          <span style={{ color: "#f87171", fontWeight: 800 }}>
                            :{entry.cause!.replace(/_/g, " ")}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Footer: fsCallId + age + force-hangup */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {call.fsCallId && (
          <span style={{
            fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.25)",
            letterSpacing: "0.02em", wordBreak: "break-all",
          }}>
            fs: {call.fsCallId}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
          started {formatDistanceToNow(new Date(call.createdAt), { addSuffix: true })}
        </span>
        {/* Force hangup button */}
        <button
          onClick={handleHangup}
          disabled={hanging}
          title="Force-terminate this call via ESL uuid_kill"
          style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
            padding: "3px 10px", borderRadius: 14,
            background: hanging ? "rgba(248,113,113,0.06)" : "rgba(248,113,113,0.12)",
            border: "1px solid rgba(248,113,113,0.3)",
            color: hanging ? "rgba(248,113,113,0.4)" : "#f87171",
            cursor: hanging ? "not-allowed" : "pointer",
            transition: "all 0.15s",
          }}
        >
          {hanging
            ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} />
            : <PhoneOff style={{ width: 10, height: 10 }} />}
          {hanging ? "Hanging up…" : "Force hangup"}
        </button>
      </div>
    </div>
  );
}

function LiveCallsTab() {
  const [calls,     setCalls]     = useState<LiveCall[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [asOf,      setAsOf]      = useState<Date | null>(null);
  const [paused,    setPaused]    = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  const fetchLive = useCallback(async () => {
    try {
      const data = await adminFetch("/admin/calls/live");
      setCalls(data.calls ?? []);
      setAsOf(new Date(data.asOf));
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  const forceHangup = useCallback(async (id: string) => {
    const data = await adminFetch(`/admin/calls/${id}/hangup`, { method: "POST" });
    if (data.eslWarning) {
      toast({ title: "Hung up (with warning)", description: data.eslWarning, variant: "destructive" });
    } else {
      toast({ title: "Call terminated", description: `uuid_kill sent${data.eslSent ? " to FreeSWITCH" : ""}. Record marked failed.` });
    }
    // Remove the hung-up call immediately from the list
    setCalls((prev) => prev.filter((c) => c.id !== id));
  }, [toast]);

  const [clearing, setClearing] = useState(false);
  const clearStale = useCallback(async () => {
    setClearing(true);
    try {
      const data = await adminFetch("/admin/calls/clear-stale", { method: "POST" });
      toast({ title: "Stale calls cleared", description: `${data.cleared} record(s) force-closed.` });
      await fetchLive();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setClearing(false);
    }
  }, [toast, fetchLive]);

  useEffect(() => {
    fetchLive();
  }, [fetchLive]);

  useEffect(() => {
    if (paused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(fetchLive, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [paused, fetchLive]);

  const answered  = calls.filter((c) => c.status === "answered").length;
  const ringing   = calls.filter((c) => c.status === "ringing").length;
  const initiated = calls.filter((c) => c.status === "initiated").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Toolbar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>

        {/* Summary chips */}
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { label: "answered",  count: answered,  color: "#30d158" },
            { label: "ringing",   count: ringing,   color: "#1a8cff" },
            { label: "initiated", count: initiated, color: "#f59e0b" },
          ].map(({ label, count, color }) => (
            <div key={label} style={{
              display: "flex", alignItems: "center", gap: 5,
              fontSize: 11, fontWeight: 600,
              padding: "3px 10px", borderRadius: 20,
              background: `${color}15`,
              border: `1px solid ${color}30`,
              color,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
              {count} {label}
            </div>
          ))}
        </div>

        <span style={{ flex: 1 }} />

        {/* Refresh-age + pause/resume */}
        {asOf && (
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontVariantNumeric: "tabular-nums" }}>
            {paused ? "paused" : `updated ${formatDistanceToNow(asOf, { addSuffix: true })}`}
          </span>
        )}
        <button
          onClick={() => setPaused((p) => !p)}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 11, fontWeight: 600,
            padding: "4px 11px", borderRadius: 16,
            background: paused ? "rgba(255,159,10,0.15)" : "rgba(255,255,255,0.06)",
            border: `1px solid ${paused ? "rgba(255,159,10,0.3)" : "rgba(255,255,255,0.1)"}`,
            color: paused ? "#ff9f0a" : "rgba(255,255,255,0.45)",
            cursor: "pointer",
          }}
        >
          {paused ? <Activity style={{ width: 11, height: 11 }} /> : <Clock style={{ width: 11, height: 11 }} />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={fetchLive}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 11, fontWeight: 600,
            padding: "4px 11px", borderRadius: 16,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(255,255,255,0.45)",
            cursor: "pointer",
          }}
        >
          <RefreshCw style={{ width: 11, height: 11 }} />
          Refresh
        </button>
        <button
          onClick={clearStale}
          disabled={clearing}
          title="Force-close all stuck initiated/ringing calls older than 15 minutes"
          style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 11, fontWeight: 600,
            padding: "4px 11px", borderRadius: 16,
            background: clearing ? "rgba(251,191,36,0.06)" : "rgba(251,191,36,0.12)",
            border: "1px solid rgba(251,191,36,0.3)",
            color: clearing ? "rgba(251,191,36,0.4)" : "#fbbf24",
            cursor: clearing ? "not-allowed" : "pointer",
          }}
        >
          {clearing
            ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} />
            : <PhoneOff style={{ width: 11, height: 11 }} />}
          Clear Stale
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)",
          borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#f87171",
          display: "flex", gap: 8, alignItems: "center",
        }}>
          <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0 }} />
          {error}
        </div>
      )}

      {/* ── Content ── */}
      {loading ? (
        <Skel rows={3} h={130} />
      ) : calls.length === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 10, padding: "56px 0",
          color: "rgba(255,255,255,0.2)",
        }}>
          <PhoneCall style={{ width: 36, height: 36 }} />
          <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>No active calls</p>
          <p style={{ fontSize: 12, margin: 0, color: "rgba(255,255,255,0.15)" }}>
            Refreshing every 3 s — new calls appear automatically
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {calls.map((call) => (
            <CallTraceCard key={call.id} call={call} onForceHangup={forceHangup} />
          ))}
        </div>
      )}

      {/* pulse keyframe (injected once) */}
      <style>{`
        @keyframes pulse {
          0%,100% { opacity:1; box-shadow:0 0 6px currentColor; }
          50%      { opacity:0.5; box-shadow:0 0 2px currentColor; }
        }
      `}</style>
    </div>
  );
}

// ─── System Health Tab ─────────────────────────────────────────────────────────

interface EnvVar { key: string; label: string; required: boolean; hint: string; set: boolean; }
interface EslStatus { enabled: boolean; connected: boolean; host: string; port: number; reconnectAttempt?: number; lastConnectedAt?: number | null; lastEventAt?: number | null; lastDisconnectReason?: string | null; lastDisconnectedAt?: number | null; }
interface SystemHealth {
  db: { connected: boolean; error: string | null };
  esl: EslStatus;
  envVars: EnvVar[];
  config: {
    domain: string | null; appUrl: string | null; directoryUrl: string | null;
    vertoWsUrl: string | null; sshUser: string; confDir: string;
    eslHost: string | null; eslPort: number;
  };
}

function SysRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "9px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <span style={{ width: 150, flexShrink: 0, fontSize: 12, color: "rgba(255,255,255,0.35)", paddingTop: 1 }}>{label}</span>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.85)", wordBreak: "break-all", fontFamily: mono ? "monospace" : undefined }}>{value}</span>
    </div>
  );
}

function SysSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, paddingLeft: 2 }}>
        <span style={{ color: "rgba(255,255,255,0.3)" }}>{icon}</span>
        <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>{title}</p>
      </div>
      <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 14, overflow: "hidden" }}>{children}</div>
    </div>
  );
}

function StatusPill({ ok, labelOn, labelOff }: { ok: boolean; labelOn: string; labelOff: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: ok ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.15)",
      border: `1px solid ${ok ? "rgba(48,209,88,0.35)" : "rgba(255,69,58,0.35)"}`,
      color: ok ? "#30d158" : "#ff453a",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: ok ? "#30d158" : "#ff453a", boxShadow: `0 0 5px ${ok ? "#30d158" : "#ff453a"}` }} />
      {ok ? labelOn : labelOff}
    </span>
  );
}

function SystemTab() {
  const { toast } = useToast();
  const [health,    setHealth]    = useState<SystemHealth | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [pushLog,   setPushLog]   = useState<string[] | null>(null);
  const [pushing,   setPushing]   = useState(false);
  const [sshResult, setSshResult] = useState<{ ok: boolean; output?: string; error?: string } | null>(null);
  const [sshTesting, setSshTesting] = useState(false);
  const [expanded,  setExpanded]  = useState<string | null>(null);

  // ICE / TURN server state
  const [iceData,    setIceData]    = useState<{ source: string; effective: any[]; dbServers: any[]; updatedAt: string | null } | null>(null);
  const [iceLoading, setIceLoading] = useState(false);
  const [iceSaving,  setIceSaving]  = useState(false);
  const [iceEditing, setIceEditing] = useState(false);
  const [iceList,    setIceList]    = useState<Array<{ urls: string; username: string; credential: string }>>([]);
  const [newIce,     setNewIce]     = useState({ urls: "", username: "", credential: "" });
  const [turnConfig, setTurnConfig] = useState<{ turnSecretSet: boolean; turnHostSet: boolean; turnHost: string | null; mode: string; iceUrls: string[]; note: string } | null>(null);
  const [turnHealth, setTurnHealth] = useState<{ ok: boolean; hasTurn: boolean; onlyStun: boolean; turnDown: boolean; turnReachable: boolean; summary: string; servers: any[] } | null>(null);
  const [turnHealthLoading, setTurnHealthLoading] = useState(false);

  // Directory / call-path test state
  const [dirResult,  setDirResult]  = useState<any>(null);
  const [dirTesting, setDirTesting] = useState(false);

  const [eslReconnecting, setEslReconnecting] = useState(false);
  const [eslReconnectMsg,  setEslReconnectMsg]  = useState<{ ok: boolean; message: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminFetch("/admin/system-health");
      setHealth(data);
    } catch (e: any) {
      toast({ title: "Health check failed", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    loadIce();
    loadTurnConfig();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pushConfig = async () => {
    setPushing(true);
    setPushLog(null);
    try {
      const data = await adminFetch("/admin/freeswitch/push-config", { method: "POST" });
      setPushLog(data.steps ?? []);
      if (data.success) {
        toast({ title: "Config pushed", description: "FreeSWITCH reloaded successfully." });
      } else {
        toast({ title: "Push failed", description: data.error ?? "Unknown error", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Push failed", description: e.message, variant: "destructive" });
    } finally { setPushing(false); }
  };

  const testSsh = async () => {
    setSshTesting(true);
    setSshResult(null);
    try {
      const data = await adminFetch("/admin/freeswitch/test-ssh", { method: "POST" });
      setSshResult(data);
    } catch (e: any) {
      setSshResult({ ok: false, error: e.message });
    } finally { setSshTesting(false); }
  };

  const reconnectEsl = async () => {
    setEslReconnecting(true);
    setEslReconnectMsg(null);
    try {
      const data = await adminFetch("/admin/esl/reconnect", { method: "POST" });
      setEslReconnectMsg({ ok: data.success, message: data.message ?? (data.success ? "Reconnect initiated" : data.error ?? "Failed") });
      if (data.success) {
        toast({ title: "ESL reconnect initiated", description: "FreeSWITCH ESL is reconnecting." });
        setTimeout(load, 3000);
      } else {
        toast({ title: "ESL reconnect failed", description: data.error ?? "Unknown error", variant: "destructive" });
      }
    } catch (e: any) {
      setEslReconnectMsg({ ok: false, message: e.message });
      toast({ title: "ESL reconnect failed", description: e.message, variant: "destructive" });
    } finally { setEslReconnecting(false); }
  };

  const loadIce = async () => {
    setIceLoading(true);
    try {
      const data = await adminFetch("/admin/ice-servers");
      setIceData(data);
      setIceList((data.dbServers ?? []).map((s: any) => ({ urls: s.urls ?? "", username: s.username ?? "", credential: s.credential ?? "" })));
    } catch (e: any) {
      toast({ title: "Failed to load ICE servers", description: e.message, variant: "destructive" });
    } finally { setIceLoading(false); }
  };

  const loadTurnConfig = async () => {
    try {
      const data = await adminFetch("/admin/turn-config");
      setTurnConfig(data);
    } catch { /* non-critical */ }
  };

  const probeTurnHealth = async () => {
    setTurnHealthLoading(true);
    setTurnHealth(null);
    try {
      const data = await adminFetch("/healthz/turn");
      setTurnHealth(data);
    } catch (e: any) {
      setTurnHealth({ ok: false, hasTurn: false, onlyStun: true, turnDown: false, turnReachable: false, summary: e.message ?? "Health check failed", servers: [] });
    } finally { setTurnHealthLoading(false); }
  };

  const saveIce = async () => {
    setIceSaving(true);
    try {
      const servers = iceList.filter((s) => s.urls.trim()).map((s) => ({
        urls: s.urls.trim(),
        ...(s.username.trim() ? { username: s.username.trim() } : {}),
        ...(s.credential.trim() ? { credential: s.credential.trim() } : {}),
      }));
      await adminFetch("/admin/ice-servers", { method: "PUT", body: JSON.stringify({ iceServers: servers }) });
      toast({ title: "ICE servers saved", description: `${servers.length} server(s) saved to database.` });
      setIceEditing(false);
      await loadIce();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally { setIceSaving(false); }
  };

  const testDirectory = async () => {
    setDirTesting(true);
    setDirResult(null);
    try {
      const data = await adminFetch("/admin/freeswitch/status");
      setDirResult(data);
    } catch (e: any) {
      setDirResult({ ok: false, reason: e.message });
    } finally { setDirTesting(false); }
  };

  const ts = (ms: number | null | undefined) =>
    ms ? new Date(ms).toLocaleTimeString() : "—";

  const requiredVars  = health?.envVars.filter((v) => v.required) ?? [];
  const optionalVars  = health?.envVars.filter((v) => !v.required) ?? [];
  const allRequiredOk = requiredVars.every((v) => v.set);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Header row ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>Production Health</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "2px 0 0" }}>FreeSWITCH · Database · Environment</p>
        </div>
        <button onClick={load} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: loading ? "not-allowed" : "pointer", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)", opacity: loading ? 0.5 : 1 }}>
          <RefreshCw style={{ width: 11, height: 11, animation: loading ? "spin 1s linear infinite" : "none" }} />
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {loading && !health && (
        <div className="space-y-2">
          {[80, 120, 160].map((h) => <div key={h} className="rounded-2xl bg-white/[0.04] animate-pulse" style={{ height: h }} />)}
        </div>
      )}

      {health && (<>

        {/* ── Quick status bar ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[
            { label: "Database", ok: health.db.connected,    icon: <Database style={{ width: 13, height: 13 }} /> },
            { label: "ESL",      ok: health.esl.connected,   icon: <Terminal  style={{ width: 13, height: 13 }} /> },
            { label: "Env Vars", ok: allRequiredOk,           icon: <KeyRound  style={{ width: 13, height: 13 }} /> },
          ].map(({ label, ok, icon }) => (
            <div key={label} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              padding: "14px 8px", borderRadius: 12,
              background: ok ? "rgba(48,209,88,0.08)" : "rgba(255,69,58,0.08)",
              border: `1px solid ${ok ? "rgba(48,209,88,0.2)" : "rgba(255,69,58,0.2)"}`,
            }}>
              <span style={{ color: ok ? "#30d158" : "#ff453a" }}>{icon}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: ok ? "#30d158" : "#ff453a" }}>{label}</span>
              <span style={{ fontSize: 10, color: ok ? "rgba(48,209,88,0.7)" : "rgba(255,69,58,0.7)" }}>{ok ? "OK" : "FAIL"}</span>
            </div>
          ))}
        </div>

        {/* ── Database ── */}
        <SysSection title="Database" icon={<Database style={{ width: 12, height: 12 }} />}>
          <SysRow label="Status" value={<StatusPill ok={health.db.connected} labelOn="Connected" labelOff="Disconnected" />} />
          {health.db.error && <SysRow label="Error" value={<span style={{ color: "#ff453a", fontSize: 11 }}>{health.db.error}</span>} />}
        </SysSection>

        {/* ── FreeSWITCH ESL ── */}
        <SysSection title="FreeSWITCH ESL" icon={<Terminal style={{ width: 12, height: 12 }} />}>
          <SysRow label="Status" value={<StatusPill ok={health.esl.connected} labelOn="Connected" labelOff="Disconnected" />} />
          <SysRow label="Enabled"       value={health.esl.enabled ? "Yes" : <span style={{ color: "#ff9f0a" }}>No — FREESWITCH_DOMAIN not set</span>} />
          <SysRow label="Host"          value={health.esl.host || <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>} mono />
          <SysRow label="Port"          value={health.esl.port} />
          <SysRow label="Last connected" value={ts(health.esl.lastConnectedAt)} />
          <SysRow label="Last event"     value={ts(health.esl.lastEventAt)} />
          {(health.esl.reconnectAttempt ?? 0) > 0 && (
            <SysRow label="Reconnect attempts" value={<span style={{ color: "#ff9f0a" }}>{health.esl.reconnectAttempt}</span>} />
          )}
          {health.esl.lastDisconnectReason && (
            <SysRow label="Disconnect reason" value={<span style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>{health.esl.lastDisconnectReason}</span>} />
          )}
        </SysSection>

        {/* ── Config URLs ── */}
        <SysSection title="Configuration" icon={<Globe2 style={{ width: 12, height: 12 }} />}>
          <SysRow label="Domain"        value={health.config.domain      ?? <span style={{ color: "#ff453a" }}>Not set</span>} mono />
          <SysRow label="App URL"       value={health.config.appUrl      ?? <span style={{ color: "#ff453a" }}>Not set</span>} mono />
          <SysRow label="Directory URL" value={health.config.directoryUrl ?? <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>} mono />
          <SysRow label="Verto WS"      value={health.config.vertoWsUrl  ?? <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>} mono />
          <SysRow label="SSH user"      value={health.config.sshUser} />
          <SysRow label="Conf dir"      value={health.config.confDir} mono />
        </SysSection>

        {/* ── Required env vars ── */}
        <SysSection title="Required Environment Variables" icon={<KeyRound style={{ width: 12, height: 12 }} />}>
          {requiredVars.map((v) => (
            <SysRow
              key={v.key}
              label={v.label}
              value={
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <StatusPill ok={v.set} labelOn="Set" labelOff="Missing" />
                  {!v.set && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{v.hint}</span>}
                </div>
              }
            />
          ))}
        </SysSection>

        {/* ── Optional env vars (collapsible) ── */}
        <div>
          <button
            onClick={() => setExpanded(expanded === "opt" ? null : "opt")}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.35)", fontSize: 11, fontWeight: 600, padding: "4px 2px", textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            <ChevronDown style={{ width: 11, height: 11, transform: expanded === "opt" ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            Optional variables ({optionalVars.filter((v) => v.set).length}/{optionalVars.length} set)
          </button>
          {expanded === "opt" && (
            <div style={{ marginTop: 6, background: "rgba(255,255,255,0.04)", borderRadius: 14, overflow: "hidden" }}>
              {optionalVars.map((v) => (
                <SysRow
                  key={v.key}
                  label={v.label}
                  value={
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <StatusPill ok={v.set} labelOn="Set" labelOff="Not set" />
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{v.hint}</span>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Actions ── */}
        <SysSection title="Actions" icon={<Settings style={{ width: 12, height: 12 }} />}>
          {/* Push config */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", margin: 0 }}>Push Config to FreeSWITCH</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: "2px 0 0" }}>Writes dialplan, xml_curl, verto.conf via SSH and reloads modules</p>
              </div>
              <button
                onClick={pushConfig}
                disabled={pushing}
                style={{
                  flexShrink: 0, padding: "8px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  border: "none", cursor: pushing ? "not-allowed" : "pointer",
                  background: pushing ? "rgba(255,255,255,0.06)" : "rgba(26,140,255,0.2)",
                  color: pushing ? "rgba(255,255,255,0.3)" : "#1a8cff",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {pushing ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <ArrowRight style={{ width: 12, height: 12 }} />}
                {pushing ? "Pushing…" : "Push"}
              </button>
            </div>
            {pushLog && (
              <div style={{ marginTop: 10 }}>
                <pre style={{
                  background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 8, padding: "10px 12px", fontSize: 10, color: "#a8ff78",
                  fontFamily: "monospace", overflowX: "auto", margin: 0, lineHeight: 1.6,
                  maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
                }}>
                  {pushLog.join("\n")}
                </pre>
              </div>
            )}
          </div>

          {/* Reconnect ESL */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", margin: 0 }}>Reconnect FreeSWITCH ESL</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: "2px 0 0" }}>Force-drops and re-establishes the ESL socket connection without restarting the server</p>
              </div>
              <button
                onClick={reconnectEsl}
                disabled={eslReconnecting}
                style={{
                  flexShrink: 0, padding: "8px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  border: "none", cursor: eslReconnecting ? "not-allowed" : "pointer",
                  background: eslReconnecting ? "rgba(255,255,255,0.06)" : "rgba(255,159,10,0.2)",
                  color: eslReconnecting ? "rgba(255,255,255,0.3)" : "#ff9f0a",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {eslReconnecting ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <RefreshCw style={{ width: 12, height: 12 }} />}
                {eslReconnecting ? "Reconnecting…" : "Reconnect"}
              </button>
            </div>
            {eslReconnectMsg && (
              <div style={{
                marginTop: 10, padding: "8px 12px", borderRadius: 8, fontSize: 11,
                background: eslReconnectMsg.ok ? "rgba(48,209,88,0.08)" : "rgba(255,69,58,0.08)",
                border: `1px solid ${eslReconnectMsg.ok ? "rgba(48,209,88,0.2)" : "rgba(255,69,58,0.2)"}`,
                color: eslReconnectMsg.ok ? "#30d158" : "#ff453a",
              }}>
                {eslReconnectMsg.ok ? `✓ ${eslReconnectMsg.message}` : `✗ ${eslReconnectMsg.message}`}
              </div>
            )}
          </div>

          {/* Test SSH */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", margin: 0 }}>Test SSH Connection</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: "2px 0 0" }}>Verifies SSH key, connectivity, and FreeSWITCH status</p>
              </div>
              <button
                onClick={testSsh}
                disabled={sshTesting}
                style={{
                  flexShrink: 0, padding: "8px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  border: "none", cursor: sshTesting ? "not-allowed" : "pointer",
                  background: sshTesting ? "rgba(255,255,255,0.06)" : "rgba(167,139,250,0.2)",
                  color: sshTesting ? "rgba(255,255,255,0.3)" : "#a78bfa",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {sshTesting ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Wifi style={{ width: 12, height: 12 }} />}
                {sshTesting ? "Testing…" : "Test"}
              </button>
            </div>
            {sshResult && (
              <div style={{
                marginTop: 10, padding: "10px 12px", borderRadius: 8,
                background: sshResult.ok ? "rgba(48,209,88,0.08)" : "rgba(255,69,58,0.08)",
                border: `1px solid ${sshResult.ok ? "rgba(48,209,88,0.2)" : "rgba(255,69,58,0.2)"}`,
                fontSize: 11, color: sshResult.ok ? "#30d158" : "#ff453a",
                fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all",
              }}>
                {sshResult.ok
                  ? `✓ SSH OK\n${sshResult.output ?? ""}`.trim()
                  : `✗ SSH Failed\n${sshResult.error ?? ""}`.trim()}
              </div>
            )}
          </div>

          {/* Test Call Path / Directory */}
          <div style={{ padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", margin: 0 }}>Test Call Path (Directory)</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: "2px 0 0" }}>Verifies extension lookup, FreeSWITCH domain, and directory XML chain</p>
              </div>
              <button
                onClick={testDirectory}
                disabled={dirTesting}
                style={{
                  flexShrink: 0, padding: "8px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  border: "none", cursor: dirTesting ? "not-allowed" : "pointer",
                  background: dirTesting ? "rgba(255,255,255,0.06)" : "rgba(48,209,88,0.18)",
                  color: dirTesting ? "rgba(255,255,255,0.3)" : "#30d158",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {dirTesting ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <PhoneCall style={{ width: 12, height: 12 }} />}
                {dirTesting ? "Testing…" : "Test"}
              </button>
            </div>
            {dirResult && (
              <div style={{
                marginTop: 10, padding: "10px 12px", borderRadius: 8,
                background: dirResult.ok ? "rgba(48,209,88,0.08)" : "rgba(255,69,58,0.08)",
                border: `1px solid ${dirResult.ok ? "rgba(48,209,88,0.2)" : "rgba(255,69,58,0.2)"}`,
                fontSize: 11, color: dirResult.ok ? "#30d158" : "#ff453a",
                fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all",
              }}>
                {dirResult.ok
                  ? `✓ Directory OK\nextension=${dirResult.extension}  domain=${dirResult.domain}`
                  : `✗ Directory Failed\n${dirResult.reason ?? "Unknown error"}`}
              </div>
            )}
          </div>
        </SysSection>

        {/* ── ICE / TURN Servers ── */}
        <SysSection title="ICE / TURN Servers" icon={<Wifi style={{ width: 12, height: 12 }} />}>
          {/* Header row with source badge + edit/save buttons */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", margin: 0 }}>
                Effective ICE servers used for WebRTC calls
              </p>
              {iceData && (
                <span style={{
                  padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700,
                  background: iceData.source === "database" ? "rgba(26,140,255,0.18)" : iceData.source === "env" ? "rgba(255,159,10,0.18)" : "rgba(255,255,255,0.07)",
                  color: iceData.source === "database" ? "#1a8cff" : iceData.source === "env" ? "#ff9f0a" : "rgba(255,255,255,0.4)",
                  border: `1px solid ${iceData.source === "database" ? "rgba(26,140,255,0.3)" : iceData.source === "env" ? "rgba(255,159,10,0.3)" : "rgba(255,255,255,0.1)"}`,
                }}>
                  {iceData.source === "database" ? "From DB" : iceData.source === "env" ? "From env var" : "Defaults (STUN only)"}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              {!iceEditing ? (
                <>
                  <button onClick={loadIce} disabled={iceLoading} style={{ padding: "6px 12px", borderRadius: 16, fontSize: 11, fontWeight: 600, border: "none", cursor: iceLoading ? "not-allowed" : "pointer", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", gap: 5 }}>
                    <RefreshCw style={{ width: 10, height: 10, animation: iceLoading ? "spin 1s linear infinite" : "none" }} />
                    Refresh
                  </button>
                  <button onClick={() => { setIceEditing(true); setNewIce({ urls: "", username: "", credential: "" }); }} style={{ padding: "6px 12px", borderRadius: 16, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", background: "rgba(26,140,255,0.18)", color: "#1a8cff", display: "flex", alignItems: "center", gap: 5 }}>
                    <Settings style={{ width: 10, height: 10 }} />
                    Configure
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setIceEditing(false)} disabled={iceSaving} style={{ padding: "6px 12px", borderRadius: 16, fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}>
                    Cancel
                  </button>
                  <button onClick={saveIce} disabled={iceSaving} style={{ padding: "6px 12px", borderRadius: 16, fontSize: 11, fontWeight: 700, border: "none", cursor: iceSaving ? "not-allowed" : "pointer", background: iceSaving ? "rgba(255,255,255,0.06)" : "rgba(48,209,88,0.2)", color: iceSaving ? "rgba(255,255,255,0.3)" : "#30d158", display: "flex", alignItems: "center", gap: 5 }}>
                    {iceSaving ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : null}
                    {iceSaving ? "Saving…" : "Save"}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* TURN health probe */}
          <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "#fff", margin: "0 0 2px" }}>Server-side TURN Reachability</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0 }}>TCP-probes each configured ICE server from the API server's network — confirms ports are open</p>
              {turnHealth && (
                <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: turnHealth.ok ? "rgba(48,209,88,0.08)" : turnHealth.onlyStun ? "rgba(255,159,10,0.08)" : "rgba(255,69,58,0.08)", border: `1px solid ${turnHealth.ok ? "rgba(48,209,88,0.2)" : turnHealth.onlyStun ? "rgba(255,159,10,0.2)" : "rgba(255,69,58,0.2)"}` }}>
                  <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: turnHealth.ok ? "#30d158" : turnHealth.onlyStun ? "#ff9f0a" : "#ff453a" }}>
                    {turnHealth.ok ? "✓ TURN reachable" : turnHealth.onlyStun ? "⚠ STUN-only (no TURN configured)" : "✗ TURN unreachable"}
                  </p>
                  <p style={{ margin: "0 0 6px", fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{turnHealth.summary}</p>
                  {turnHealth.servers.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {turnHealth.servers.map((s, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: s.reachable ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.15)", color: s.reachable ? "#30d158" : "#ff453a", flexShrink: 0 }}>
                            {s.reachable ? `${s.latencyMs}ms` : "FAIL"}
                          </span>
                          <span style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.url}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={probeTurnHealth}
              disabled={turnHealthLoading}
              style={{ flexShrink: 0, padding: "8px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "none", cursor: turnHealthLoading ? "not-allowed" : "pointer", background: turnHealthLoading ? "rgba(255,255,255,0.06)" : "rgba(255,159,10,0.18)", color: turnHealthLoading ? "rgba(255,255,255,0.3)" : "#ff9f0a", display: "flex", alignItems: "center", gap: 6 }}
            >
              {turnHealthLoading ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Wifi style={{ width: 12, height: 12 }} />}
              {turnHealthLoading ? "Probing…" : "Probe"}
            </button>
          </div>

          {/* TURN auto-config status panel */}
          {turnConfig && (
            <div style={{ margin: "0 0 0", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: turnConfig.mode === "auto" ? "rgba(48,209,88,0.04)" : "rgba(255,159,10,0.04)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 6, background: turnConfig.mode === "auto" ? "rgba(48,209,88,0.18)" : "rgba(255,159,10,0.18)", color: turnConfig.mode === "auto" ? "#30d158" : "#ff9f0a" }}>
                  {turnConfig.mode === "auto" ? "AUTO / HMAC" : "MANUAL"}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: turnConfig.mode === "auto" ? "#30d158" : "#ff9f0a" }}>
                  {turnConfig.mode === "auto"
                    ? `Managed TURN active — ${turnConfig.turnHost}`
                    : "TURN_SECRET / TURN_HOST not set — manual or STUN-only mode"}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>{turnConfig.note}</p>
              {turnConfig.mode === "auto" && turnConfig.iceUrls.length > 0 && (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                  {turnConfig.iceUrls.map((u) => {
                    const isTurn = u.startsWith("turn:") || u.startsWith("turns:");
                    return (
                      <span key={u} style={{ fontSize: 10, fontFamily: "monospace", color: isTurn ? "rgba(48,209,88,0.8)" : "rgba(255,255,255,0.3)" }}>
                        {isTurn ? "↗ " : "◉ "}{u}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Effective server list (read mode) */}
          {!iceEditing && (
            <>
              {/* Hard TURN-missing warning — shown when not in managed mode and no TURN in list */}
              {turnConfig?.mode !== "auto" && iceData && !iceData.effective.some((s: any) => {
                const urlList = Array.isArray(s.urls) ? s.urls : [s.urls ?? ""];
                return urlList.some((u: string) => u.startsWith("turn:") || u.startsWith("turns:"));
              }) && (
                <div style={{ padding: "12px 16px", background: "rgba(255,69,58,0.10)", borderBottom: "2px solid rgba(255,69,58,0.35)" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 700, color: "#ff453a" }}>
                    ✕ No TURN server — calls will fail on 4G/mobile and behind NAT
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: "rgba(255,100,90,0.85)", lineHeight: 1.5 }}>
                    Symmetric NAT (used by all mobile carriers and most corporate networks) drops direct ICE candidates.
                    Without TURN relay, WebRTC calls silently fail to connect.
                    Deploy Coturn and set <code style={{ fontSize: 10 }}>TURN_HOST</code> + <code style={{ fontSize: 10 }}>TURN_SECRET</code> for automatic HMAC credential mode,
                    or add TURN entries manually above.
                  </p>
                </div>
              )}
              {iceLoading && !iceData && (
                <div style={{ padding: "16px", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.25)" }}>Loading…</div>
              )}
              {iceData && iceData.effective.map((s: any, i: number) => {
                const urlStr = Array.isArray(s.urls) ? s.urls.join(", ") : (s.urls ?? "");
                const isTurn = urlStr.includes("turn:") || urlStr.includes("turns:");
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={{
                      padding: "1px 7px", borderRadius: 8, fontSize: 10, fontWeight: 700, flexShrink: 0,
                      background: isTurn ? "rgba(48,209,88,0.12)" : "rgba(255,255,255,0.06)",
                      color: isTurn ? "#30d158" : "rgba(255,255,255,0.4)",
                    }}>
                      {isTurn ? "TURN" : "STUN"}
                    </span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{urlStr}</span>
                    {s.username && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>🔑 {s.username}</span>}
                  </div>
                );
              })}
              {iceData && !iceData.effective.length && (
                <div style={{ padding: "16px", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.25)" }}>No ICE servers configured</div>
              )}
            </>
          )}

          {/* Edit mode */}
          {iceEditing && (
            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ margin: "0 0 4px", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                Saved servers override the ICE_SERVERS env var and take effect immediately — no restart needed.
              </p>

              {/* URL format examples */}
              <div style={{ background: "rgba(26,140,255,0.06)", border: "1px solid rgba(26,140,255,0.15)", borderRadius: 8, padding: "10px 12px" }}>
                <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 700, color: "rgba(26,140,255,0.8)", textTransform: "uppercase", letterSpacing: "0.06em" }}>URL format examples</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {[
                    { url: "stun:turn.praww.co.za:3478", desc: "STUN — public IP discovery, no auth needed" },
                    { url: "turn:turn.praww.co.za:3478?transport=udp", desc: "TURN UDP — primary relay transport (fastest)" },
                    { url: "turn:turn.praww.co.za:3478?transport=tcp", desc: "TURN TCP — fallback when UDP is blocked" },
                    { url: "turns:turn.praww.co.za:5349?transport=tcp", desc: "TURNS TLS — relay over TLS (corporate firewalls)" },
                  ].map(({ url, desc }) => (
                    <div key={url} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <button
                        onClick={() => {
                          const scheme = url.split(":")[0];
                          const needsAuth = scheme === "turn" || scheme === "turns";
                          setNewIce({ urls: url, username: needsAuth ? newIce.username : "", credential: needsAuth ? newIce.credential : "" });
                        }}
                        style={{ flexShrink: 0, padding: "2px 7px", borderRadius: 5, fontSize: 10, fontWeight: 600, border: "1px solid rgba(26,140,255,0.3)", cursor: "pointer", background: "rgba(26,140,255,0.12)", color: "#1a8cff" }}
                      >use</button>
                      <div>
                        <span style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.75)" }}>{url}</span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginLeft: 6 }}>{desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 10, color: "rgba(26,140,255,0.6)", lineHeight: 1.5 }}>
                  For Coturn HMAC auto-mode: set <code style={{ fontSize: 9 }}>TURN_HOST</code> + <code style={{ fontSize: 9 }}>TURN_SECRET</code> env vars instead — credentials are generated per-request automatically.
                </p>
              </div>

              {/* Existing servers */}
              {iceList.map((s, i) => {
                const scheme = s.urls.split(":")[0]?.toLowerCase() ?? "";
                const isTurnUrl = scheme === "turn" || scheme === "turns";
                const urlValid = /^(stun|turn|turns):/.test(s.urls.trim());
                return (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      value={s.urls}
                      onChange={(e) => setIceList(iceList.map((x, j) => j === i ? { ...x, urls: e.target.value } : x))}
                      placeholder="turn:host:3478?transport=udp"
                      style={{ flex: 2, minWidth: 160, padding: "6px 10px", borderRadius: 8, fontSize: 11, background: "rgba(255,255,255,0.06)", border: `1px solid ${urlValid || !s.urls ? "rgba(255,255,255,0.12)" : "rgba(255,69,58,0.4)"}`, color: "#fff", fontFamily: "monospace", outline: "none" }}
                    />
                    <input
                      value={s.username}
                      onChange={(e) => setIceList(iceList.map((x, j) => j === i ? { ...x, username: e.target.value } : x))}
                      placeholder={isTurnUrl ? "username (required)" : "—"}
                      disabled={!isTurnUrl}
                      style={{ flex: 1, minWidth: 80, padding: "6px 10px", borderRadius: 8, fontSize: 11, background: isTurnUrl ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.12)", color: isTurnUrl ? "#fff" : "rgba(255,255,255,0.2)", outline: "none" }}
                    />
                    <input
                      value={s.credential}
                      onChange={(e) => setIceList(iceList.map((x, j) => j === i ? { ...x, credential: e.target.value } : x))}
                      placeholder={isTurnUrl ? "password (required)" : "—"}
                      type="password"
                      disabled={!isTurnUrl}
                      style={{ flex: 1, minWidth: 80, padding: "6px 10px", borderRadius: 8, fontSize: 11, background: isTurnUrl ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.12)", color: isTurnUrl ? "#fff" : "rgba(255,255,255,0.2)", outline: "none" }}
                    />
                    <button onClick={() => setIceList(iceList.filter((_, j) => j !== i))} style={{ flexShrink: 0, padding: "6px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", background: "rgba(255,69,58,0.15)", color: "#ff453a" }}>✕</button>
                  </div>
                );
              })}

              {/* Add new row */}
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", paddingTop: 4, borderTop: "1px dashed rgba(255,255,255,0.08)" }}>
                <input
                  value={newIce.urls}
                  onChange={(e) => setNewIce({ ...newIce, urls: e.target.value })}
                  placeholder="turn:your-turn-server.com:3478?transport=udp"
                  style={{ flex: 2, minWidth: 160, padding: "6px 10px", borderRadius: 8, fontSize: 11, background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.15)", color: "#fff", fontFamily: "monospace", outline: "none" }}
                />
                <input
                  value={newIce.username}
                  onChange={(e) => setNewIce({ ...newIce, username: e.target.value })}
                  placeholder="username"
                  style={{ flex: 1, minWidth: 80, padding: "6px 10px", borderRadius: 8, fontSize: 11, background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.15)", color: "#fff", outline: "none" }}
                />
                <input
                  value={newIce.credential}
                  onChange={(e) => setNewIce({ ...newIce, credential: e.target.value })}
                  placeholder="password"
                  type="password"
                  style={{ flex: 1, minWidth: 80, padding: "6px 10px", borderRadius: 8, fontSize: 11, background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.15)", color: "#fff", outline: "none" }}
                />
                <button
                  onClick={() => {
                    if (!newIce.urls.trim()) return;
                    setIceList([...iceList, { ...newIce }]);
                    setNewIce({ urls: "", username: "", credential: "" });
                  }}
                  style={{ flexShrink: 0, padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", background: "rgba(26,140,255,0.18)", color: "#1a8cff" }}
                >
                  + Add
                </button>
              </div>

              <p style={{ margin: "2px 0 0", fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                STUN servers need no auth. TURN/TURNS entries require username &amp; password. Saving an empty list restores env-var or default STUN fallback.
              </p>
            </div>
          )}
        </SysSection>

        {/* ── Production checklist ── */}
        {(() => {
          const turnOk = Boolean(
            turnConfig?.mode === "auto" ||
            (iceData && (
              iceData.source === "database"
                ? iceData.dbServers.some((s: any) => s.urls?.startsWith("turn:") || s.urls?.startsWith("turns:"))
                : iceData.source === "env"
                  ? iceData.effective.some((s: any) => s.urls?.startsWith("turn:") || s.urls?.startsWith("turns:"))
                  : false
            ))
          );
          const checklist = [
            { label: "MongoDB URI set",                                     ok: health.envVars.find((v) => v.key === "MONGODB_URI")?.set ?? false,                     critical: true },
            { label: "Database connected",                                  ok: health.db.connected,                                                                    critical: true },
            { label: "FreeSWITCH domain set",                               ok: Boolean(health.config.domain),                                                          critical: true },
            { label: "SSH key set (config push)",                           ok: health.envVars.find((v) => v.key === "FREESWITCH_SSH_KEY")?.set ?? false,               critical: false },
            { label: "ESL password set",                                    ok: health.envVars.find((v) => v.key === "FREESWITCH_ESL_PASSWORD")?.set ?? false,          critical: true },
            { label: "ESL connected",                                       ok: health.esl.connected,                                                                   critical: true },
            { label: "App URL set (HTTPS)",                                 ok: health.envVars.find((v) => v.key === "APP_URL")?.set ?? false,                         critical: true },
            { label: "Session secret set",                                  ok: health.envVars.find((v) => v.key === "SESSION_SECRET")?.set ?? false,                  critical: true },
            { label: "Webhook secret set",                                  ok: health.envVars.find((v) => v.key === "FREESWITCH_WEBHOOK_SECRET")?.set ?? false,       critical: false },
            { label: "TURN relay configured — required for 4G/mobile/NAT", ok: turnOk,                                                                                 critical: true },
          ];
          const allGreen = checklist.every((c) => c.ok);
          const criticalFail = checklist.some((c) => c.critical && !c.ok);
          return (
            <SysSection title="Production Checklist" icon={<CheckCircle2 style={{ width: 12, height: 12 }} />}>
              {criticalFail && (
                <div style={{ padding: "10px 16px", background: "rgba(255,69,58,0.08)", borderBottom: "1px solid rgba(255,69,58,0.2)" }}>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#ff453a" }}>
                    ✕ Critical items are not configured. Do not roll out to production until all red items are resolved.
                  </p>
                </div>
              )}
              {allGreen && (
                <div style={{ padding: "10px 16px", background: "rgba(48,209,88,0.06)", borderBottom: "1px solid rgba(48,209,88,0.15)" }}>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#30d158" }}>
                    ✓ All checks pass — system is production ready.
                  </p>
                </div>
              )}
              {checklist.map(({ label, ok, critical }) => (
                <div key={label} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", background: (!ok && critical) ? "rgba(255,69,58,0.04)" : "transparent" }}>
                  {ok
                    ? <CheckCircle2 style={{ width: 14, height: 14, color: "#30d158", flexShrink: 0, marginTop: 1 }} />
                    : <AlertTriangle style={{ width: 14, height: 14, color: critical ? "#ff453a" : "#ff9f0a", flexShrink: 0, marginTop: 1 }} />}
                  <div>
                    <span style={{ fontSize: 12, color: ok ? "rgba(255,255,255,0.75)" : (critical ? "#ff453a" : "#ff9f0a"), fontWeight: ok ? 400 : 600 }}>{label}</span>
                    {!ok && critical && label.includes("TURN") && (
                      <p style={{ margin: "3px 0 0", fontSize: 10, color: "rgba(255,100,90,0.7)", lineHeight: 1.4 }}>
                        Set TURN_HOST + TURN_SECRET env vars and run deploy/coturn-setup.sh on your VPS.
                        Ports required: 3478 TCP/UDP, 5349 TCP, 49152–65535 UDP (relay range).
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </SysSection>
          );
        })()}

      </>)}
    </div>
  );
}

// ─── Errors Tab ────────────────────────────────────────────────────────────────

const ERROR_STATUS_META: Record<string, { label: string; color: string }> = {
  failed:       { label: "Failed",    color: "#ff453a" },
  "no-answer":  { label: "No Answer", color: "#ff9f0a" },
  busy:         { label: "Busy",      color: "#ff9f0a" },
  cancelled:    { label: "Cancelled", color: "rgba(255,255,255,0.35)" },
};

const HANGUP_LABELS: Record<string, string> = {
  USER_BUSY:                 "Line busy",
  NO_ANSWER:                 "No answer",
  CALL_REJECTED:             "Call rejected",
  UNREGISTERED:              "User not registered",
  USER_NOT_REGISTERED:       "User not registered",
  SUBSCRIBER_ABSENT:         "Subscriber absent",
  DESTINATION_OUT_OF_ORDER:  "Destination out of order",
  NO_ROUTE_DESTINATION:      "No route to destination",
  UNALLOCATED_NUMBER:        "Number not allocated",
  ALLOTTED_TIMEOUT:          "Insufficient balance",
  SERVICE_UNAVAILABLE:       "Service unavailable",
  NETWORK_OUT_OF_ORDER:      "Network out of order",
  INCOMPATIBLE_DESTINATION:  "Incompatible destination",
  NORMAL_CLEARING:           "Normal clearing",
  ORIGINATOR_CANCEL:         "Caller cancelled",
  RECOVERY_ON_TIMER_EXPIRE:  "Timer expired",
};

function humanHangup(hangupCause?: string, failReason?: string): string {
  if (failReason) return failReason;
  if (!hangupCause) return "Unknown";
  return HANGUP_LABELS[hangupCause] ?? hangupCause.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function fixBtnStyle(color: "blue" | "orange" | "red"): React.CSSProperties {
  const c = color === "blue" ? "#1a8cff" : color === "orange" ? "#ff9f0a" : "#ff453a";
  return {
    flexShrink: 0, padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700,
    border: `1px solid ${c}40`, background: `${c}18`, color: c,
    cursor: "pointer", whiteSpace: "nowrap" as const,
  };
}

// ─ System Alerts Panel ────────────────────────────────────────────────────────

interface HealthData {
  db:      { connected: boolean; error: string | null };
  esl:     { connected: boolean; lastEvent: string | null };
  envVars: { key: string; label: string; required: boolean; set: boolean; hint: string }[];
}

function SystemAlertsPanel({ onSwitchTab }: { onSwitchTab: (tab: any) => void }) {
  const { toast } = useToast();
  const [health, setHealth]       = useState<HealthData | null>(null);
  const [pushingConfig, setPushingConfig] = useState(false);

  useEffect(() => {
    adminFetch("/admin/system-health").then(setHealth).catch(() => {});
  }, []);

  if (!health) return null;

  const missingRequired = (health.envVars ?? []).filter((v) => v.required && !v.set);
  const alerts: { label: string; detail: string; fix?: React.ReactNode }[] = [];

  if (!health.db.connected) {
    alerts.push({
      label: "Database disconnected",
      detail: health.db.error ?? "Cannot reach MongoDB — all DB operations are failing",
      fix: <button onClick={() => onSwitchTab("system")} style={fixBtnStyle("blue")}>Go to System</button>,
    });
  }

  if (!health.esl?.connected) {
    alerts.push({
      label: "FreeSWITCH ESL offline",
      detail: "Event Socket is not connected — calls cannot be placed or received",
      fix: (
        <button
          disabled={pushingConfig}
          onClick={async () => {
            setPushingConfig(true);
            try {
              await adminFetch("/admin/freeswitch/push-config", { method: "POST" });
              toast({ title: "FreeSWITCH config pushed — ESL should reconnect in a few seconds" });
            } catch (e: any) {
              toast({ title: "Push failed", description: e.message, variant: "destructive" });
            } finally {
              setPushingConfig(false);
            }
          }}
          style={fixBtnStyle("orange")}
        >
          {pushingConfig ? "Pushing…" : "📡 Push Config"}
        </button>
      ),
    });
  }

  if (missingRequired.length > 0) {
    alerts.push({
      label: `${missingRequired.length} required env var${missingRequired.length !== 1 ? "s" : ""} missing`,
      detail: missingRequired.map((v) => v.label).join(", "),
      fix: <button onClick={() => onSwitchTab("system")} style={fixBtnStyle("blue")}>Go to System</button>,
    });
  }

  if (alerts.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: "#ff453a", textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>
        🚨 System Alerts
      </p>
      {alerts.map((a, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
          borderRadius: 12, background: "rgba(255,69,58,0.07)", border: "1px solid rgba(255,69,58,0.2)",
        }}>
          <AlertTriangle style={{ width: 14, height: 14, color: "#ff453a", flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#ff453a", margin: 0 }}>{a.label}</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", margin: "2px 0 0", lineHeight: 1.4 }}>{a.detail}</p>
          </div>
          {a.fix}
        </div>
      ))}
    </div>
  );
}

// ─ Server Errors Panel ────────────────────────────────────────────────────────

interface AppErrEntry {
  id: string; timestamp: string; message: string; stack?: string; path?: string; method?: string;
}

function ServerErrorsPanel() {
  const { toast } = useToast();
  const [errors,   setErrors]   = useState<AppErrEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    adminFetch("/admin/app-errors")
      .then((d: any) => setErrors(d.errors ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const clearAll = async () => {
    setClearing(true);
    try {
      await adminFetch("/admin/app-errors", { method: "DELETE" });
      setErrors([]);
      toast({ title: "Server error log cleared" });
    } catch (e: any) {
      toast({ title: "Clear failed", description: e.message, variant: "destructive" });
    } finally {
      setClearing(false);
    }
  };

  if (!loading && errors.length === 0) return null;

  return (
    <div style={{ borderRadius: 14, background: "rgba(255,69,58,0.05)", border: "1px solid rgba(255,69,58,0.15)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: errors.length > 0 ? "1px solid rgba(255,69,58,0.09)" : "none" }}>
        <Terminal style={{ width: 13, height: 13, color: "#ff453a" }} />
        <p style={{ fontSize: 13, fontWeight: 700, color: "#fff", margin: 0, flex: 1 }}>Server Errors</p>
        {errors.length > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, background: "#ff453a", color: "#fff", padding: "2px 7px", borderRadius: 6 }}>
            {errors.length}
          </span>
        )}
        <button onClick={load} disabled={loading} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 4 }}>
          <RefreshCw style={{ width: 11, height: 11, animation: loading ? "spin 1s linear infinite" : "none" }} />
        </button>
        {errors.length > 0 && (
          <button onClick={clearAll} disabled={clearing} style={{ fontSize: 11, fontWeight: 600, color: "#ff453a", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            {clearing ? "Clearing…" : "Clear all"}
          </button>
        )}
      </div>

      {loading && errors.length === 0 && (
        <div style={{ padding: "12px 14px" }}><Skel rows={2} h={32} /></div>
      )}

      {errors.map((e, i) => (
        <div key={e.id} style={{ borderTop: i > 0 ? "1px solid rgba(255,69,58,0.07)" : "none" }}>
          <button
            onClick={() => setExpanded(expanded === e.id ? null : e.id)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ff453a", flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.method && <span style={{ color: "#ff9f0a", marginRight: 6 }}>[{e.method} {e.path}]</span>}
              {e.message}
            </span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", flexShrink: 0 }}>
              {formatDistanceToNow(new Date(e.timestamp), { addSuffix: true })}
            </span>
            <ChevronDown style={{ width: 11, height: 11, color: "rgba(255,255,255,0.25)", transform: expanded === e.id ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
          </button>
          {expanded === e.id && e.stack && (
            <div style={{ padding: "0 14px 12px 28px" }}>
              <pre style={{
                fontSize: 10, color: "rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.3)",
                borderRadius: 8, padding: "8px 10px", margin: 0, overflowX: "auto",
                maxHeight: 200, lineHeight: 1.5, whiteSpace: "pre-wrap" as const,
              }}>
                {e.stack}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─ Call Errors Panel ──────────────────────────────────────────────────────────

function CallErrorsPanel() {
  const { toast } = useToast();
  const [calls, setCalls]               = useState<any[]>([]);
  const [total, setTotal]               = useState(0);
  const [page,  setPage]                = useState(1);
  const [loading, setLoading]           = useState(true);
  const [expanded, setExpanded]         = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dismissing,  setDismissing]    = useState<string | null>(null);
  const [pushingFor,  setPushingFor]    = useState<string | null>(null);
  const [creditCallId, setCreditCallId] = useState<string | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [savingCredit, setSavingCredit] = useState(false);
  const statusFilterRef = useRef(statusFilter);
  statusFilterRef.current = statusFilter;
  const LIMIT = 20;

  const load = useCallback((p = 1, sf?: string) => {
    const filter = sf ?? statusFilterRef.current;
    setLoading(true);
    const q = filter !== "all" ? `&status=${filter}` : "";
    adminFetch(`/admin/failed-calls?page=${p}&limit=${LIMIT}${q}`)
      .then((d: any) => { setCalls(d.calls ?? []); setTotal(d.total ?? 0); setPage(p); })
      .catch((e: any) => toast({ title: "Failed to load", description: e.message, variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(1); }, [load]);

  const changeFilter = (sf: string) => { setStatusFilter(sf); load(1, sf); };

  const dismiss = async (callId: string) => {
    setDismissing(callId);
    try {
      await adminFetch(`/admin/calls/${callId}/dismiss`, { method: "POST" });
      setCalls((prev) => prev.filter((c) => c._id !== callId));
      setTotal((t) => Math.max(0, t - 1));
      toast({ title: "Error dismissed" });
    } catch (e: any) {
      toast({ title: "Dismiss failed", description: e.message, variant: "destructive" });
    } finally { setDismissing(null); }
  };

  const pushConfig = async (callId: string) => {
    setPushingFor(callId);
    try {
      await adminFetch("/admin/freeswitch/push-config", { method: "POST" });
      toast({ title: "FreeSWITCH config pushed — user should re-register" });
    } catch (e: any) {
      toast({ title: "Push failed", description: e.message, variant: "destructive" });
    } finally { setPushingFor(null); }
  };

  const addCredit = async (userId: string) => {
    const parsed = parseFloat(creditAmount);
    if (!isFinite(parsed) || parsed === 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    setSavingCredit(true);
    try {
      await adminFetch(`/admin/users/${userId}/adjust-credit`, { method: "POST", body: JSON.stringify({ amount: parsed }) });
      toast({ title: `R${parsed.toFixed(2)} credit applied` });
      setCreditCallId(null); setCreditAmount("");
    } catch (e: any) {
      toast({ title: "Credit failed", description: e.message, variant: "destructive" });
    } finally { setSavingCredit(false); }
  };

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  const FILTER_PILLS = [
    { key: "all",       label: "All" },
    { key: "failed",    label: "Failed" },
    { key: "no-answer", label: "No Answer" },
    { key: "busy",      label: "Busy" },
    { key: "cancelled", label: "Cancelled" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>Call Errors</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "2px 0 0" }}>
            {total} call error{total !== 1 ? "s" : ""}
            {statusFilter !== "all" ? ` · ${statusFilter}` : ""}
          </p>
        </div>
        <button
          onClick={() => load(page)}
          disabled={loading}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: loading ? "not-allowed" : "pointer", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)", opacity: loading ? 0.5 : 1 }}
        >
          <RefreshCw style={{ width: 11, height: 11, animation: loading ? "spin 1s linear infinite" : "none" }} />
          Refresh
        </button>
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FILTER_PILLS.map((f) => {
          const active = statusFilter === f.key;
          const meta = ERROR_STATUS_META[f.key];
          const c = meta?.color ?? "#1a8cff";
          return (
            <button key={f.key} onClick={() => changeFilter(f.key)} style={{
              padding: "5px 12px", borderRadius: 16, fontSize: 12, fontWeight: 600,
              border: active ? `1px solid ${c}40` : "1px solid rgba(255,255,255,0.08)",
              background: active ? `${c}18` : "rgba(255,255,255,0.04)",
              color: active ? c : "rgba(255,255,255,0.45)", cursor: "pointer",
            }}>
              {f.label}
            </button>
          );
        })}
      </div>

      {loading && calls.length === 0 && <Skel rows={5} h={58} />}

      {!loading && calls.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <CheckCircle2 style={{ width: 32, height: 32, color: "#30d158", margin: "0 auto 10px" }} />
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", margin: 0 }}>No errors found</p>
        </div>
      )}

      {calls.length > 0 && (
        <div style={{ borderRadius: 16, overflow: "hidden", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          {calls.map((c: any, i: number) => {
            const meta      = ERROR_STATUS_META[c.status] ?? { label: c.status, color: "rgba(255,255,255,0.35)" };
            const reason    = humanHangup(c.hangupCause, c.failReason);
            const isOpen    = expanded === c._id;
            const when      = c.createdAt ? new Date(c.createdAt) : null;
            const user      = c.userInfo;
            const userLabel = user?.name ?? user?.email ?? user?.username ?? null;
            const isLowBal  = c.hangupCause === "ALLOTTED_TIMEOUT";
            const isUnreg   = c.hangupCause === "UNREGISTERED" || c.hangupCause === "USER_NOT_REGISTERED" || c.hangupCause === "SUBSCRIBER_ABSENT";
            const noAction  = c.status === "busy" || c.status === "no-answer" || c.status === "cancelled";

            return (
              <div key={c._id ?? i} style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                <button
                  onClick={() => setExpanded(isOpen ? null : c._id)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontFamily: "monospace", color: "rgba(255,255,255,0.85)", fontWeight: 500, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.recipientNumber ?? c.callerNumber ?? "—"}
                    </span>
                    {userLabel && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{userLabel}</span>}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: `${meta.color}18`, padding: "2px 8px", borderRadius: 6, flexShrink: 0 }}>{meta.label}</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", flexShrink: 0, minWidth: 52, textAlign: "right" }}>
                    {when ? formatDistanceToNow(when, { addSuffix: true }) : "—"}
                  </span>
                  <ChevronDown style={{ width: 12, height: 12, color: "rgba(255,255,255,0.25)", flexShrink: 0, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                </button>

                {isOpen && (
                  <div style={{ padding: "0 14px 14px 32px", display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* Reason highlight */}
                    <div style={{ padding: "9px 12px", borderRadius: 10, background: `${meta.color}10`, border: `1px solid ${meta.color}28` }}>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Reason</p>
                      <p style={{ fontSize: 13, color: meta.color, margin: 0, fontWeight: 600 }}>{reason}</p>
                    </div>

                    {/* Details */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {([
                        ["Call ID",      c._id],
                        ["Direction",    c.direction ?? "outbound"],
                        ["User",         userLabel ?? c.userId ?? "—"],
                        ["Hangup cause", c.hangupCause ?? "—"],
                        ["Duration",     c.duration != null ? `${c.duration}s` : "0s"],
                        ["Started",      c.startedAt ? format(new Date(c.startedAt), "dd MMM yyyy HH:mm") : "—"],
                        ["Ended",        c.endedAt   ? format(new Date(c.endedAt),   "dd MMM yyyy HH:mm") : "—"],
                      ] as [string, string][]).map(([label, value]) => (
                        <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 500, flexShrink: 0 }}>{label}</span>
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", fontFamily: "monospace", textAlign: "right", wordBreak: "break-all" }}>{value}</span>
                        </div>
                      ))}
                    </div>

                    {/* ─── Fix Actions ─── */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>Fix Actions</p>

                      {/* How-to hint */}
                      <div style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", margin: 0, lineHeight: 1.5 }}>
                          {isLowBal  ? "User ran out of balance mid-call. Use Add Credits below to top them up instantly."
                          : isUnreg  ? "The SIP extension is not registered with FreeSWITCH. Push the config and ask the user to re-open the app."
                          : noAction ? `${c.status === "busy" ? "Line was busy" : c.status === "no-answer" ? "Callee didn't answer" : "Caller hung up"}. No action needed.`
                          : c.failReason ? `Check server logs for: "${c.failReason}"`
                          : "Check the System tab for ESL / DB connectivity."}
                        </p>
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        {/* LOW BALANCE → inline credit */}
                        {isLowBal && c.userId && (
                          creditCallId === c._id ? (
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <Input
                                type="number"
                                placeholder="Amount (R)"
                                value={creditAmount}
                                onChange={(e) => setCreditAmount(e.target.value)}
                                style={{ width: 100, height: 30, fontSize: 12, padding: "0 8px" }}
                              />
                              <button onClick={() => addCredit(c.userId)} disabled={savingCredit} style={fixBtnStyle("blue")}>
                                {savingCredit ? "Saving…" : "Add"}
                              </button>
                              <button onClick={() => { setCreditCallId(null); setCreditAmount(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 2 }}>
                                <X style={{ width: 12, height: 12 }} />
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => { setCreditCallId(c._id); setCreditAmount(""); }} style={fixBtnStyle("blue")}>
                              💳 Add Credits
                            </button>
                          )
                        )}

                        {/* UNREGISTERED → push FS config */}
                        {isUnreg && (
                          <button onClick={() => pushConfig(c._id)} disabled={pushingFor === c._id} style={fixBtnStyle("orange")}>
                            {pushingFor === c._id
                              ? <><Loader2 style={{ width: 11, height: 11, display: "inline", marginRight: 4 }} className="animate-spin" />Pushing…</>
                              : "📡 Push FS Config"}
                          </button>
                        )}

                        {/* Always: Dismiss */}
                        <button
                          onClick={() => dismiss(c._id)}
                          disabled={dismissing === c._id}
                          style={{ padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)", cursor: "pointer" }}
                        >
                          {dismissing === c._id ? "Removing…" : "✕ Dismiss"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <button onClick={() => load(page - 1)} disabled={page <= 1 || loading}
            style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: page <= 1 ? "not-allowed" : "pointer", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)", opacity: page <= 1 ? 0.4 : 1 }}>
            ← Prev
          </button>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{page} / {pages}</span>
          <button onClick={() => load(page + 1)} disabled={page >= pages || loading}
            style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: page >= pages ? "not-allowed" : "pointer", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)", opacity: page >= pages ? 0.4 : 1 }}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Errors Tab orchestrator ──────────────────────────────────────────────────

function ErrorsTab({ onSwitchTab }: { onSwitchTab: (tab: any) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SystemAlertsPanel onSwitchTab={onSwitchTab} />
      <ServerErrorsPanel />
      <CallErrorsPanel />
    </div>
  );
}

// ─── Observability / Metrics Tab ───────────────────────────────────────────────

interface MetricsSnapshot {
  startedAt: string;
  uptimeSeconds: number;
  activeVertoClients: number;
  activeSipClients: number;
  activeCalls: number;
  callsInitiated: number;
  callsAnswered: number;
  callsFailed: number;
  wsDisconnectsVerto: number;
  wsDisconnectsSip: number;
  iceFailures: number;
  registrationFailures: number;
  reconnectAttempts: number;
  reconnectSuccesses: number;
  reconnectFailures: number;
  upstreamDisconnectsVerto: number;
  upstreamDisconnectsSip: number;
  callSetupLatency: { p50: number; p95: number; p99: number; count: number };
}

function MetricCard({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4,
    }}>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</span>
      <span style={{ fontSize: 26, fontWeight: 700, color: color ?? "rgba(255,255,255,0.9)", lineHeight: 1 }}>{value}</span>
      {sub && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{sub}</span>}
    </div>
  );
}

function fmtUptime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function ObservabilityTab() {
  const [data, setData] = React.useState<MetricsSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = React.useState<Date | null>(null);

  const load = React.useCallback(async () => {
    try {
      const snap = await adminFetch("/metrics/json");
      setData(snap);
      setLastRefresh(new Date());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "20px 0", color: "rgba(255,255,255,0.35)" }}>
      <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading metrics…
    </div>
  );

  if (error && !data) return (
    <div style={{ padding: "16px", background: "rgba(255,69,58,0.1)", border: "1px solid rgba(255,69,58,0.25)", borderRadius: 10, color: "#ff453a", fontSize: 13 }}>
      {error}
    </div>
  );

  if (!data) return null;

  const answerRate = data.callsInitiated > 0
    ? Math.round((data.callsAnswered / data.callsInitiated) * 100)
    : 0;
  const failRate = data.callsInitiated > 0
    ? Math.round((data.callsFailed / data.callsInitiated) * 100)
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.85)", margin: 0 }}>Real-Time Platform Metrics</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lastRefresh && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Updated {formatDistanceToNow(lastRefresh, { addSuffix: true })}</span>}
          <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: "4px 10px", color: "rgba(255,255,255,0.5)", fontSize: 11, cursor: "pointer" }}>
            <RefreshCw size={10} /> Refresh
          </button>
        </div>
      </div>

      {/* Active gauges */}
      <div>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Live State</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
          <MetricCard label="Active Calls"    value={data.activeCalls}        color={data.activeCalls > 0 ? "#30d158" : undefined} />
          <MetricCard label="Verto Clients"   value={data.activeVertoClients} color={data.activeVertoClients > 0 ? "#1a8cff" : undefined} />
          <MetricCard label="SIP Clients"     value={data.activeSipClients}   color={data.activeSipClients > 0 ? "#bf5af2" : undefined} />
          <MetricCard label="Uptime"          value={fmtUptime(data.uptimeSeconds)} />
        </div>
      </div>

      {/* Call counters */}
      <div>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Calls (since restart)</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
          <MetricCard label="Initiated"   value={data.callsInitiated} />
          <MetricCard label="Answered"    value={data.callsAnswered}  color={data.callsAnswered > 0 ? "#30d158" : undefined} sub={`${answerRate}% answer rate`} />
          <MetricCard label="Failed"      value={data.callsFailed}    color={data.callsFailed > 0 ? "#ff453a" : undefined}  sub={`${failRate}% fail rate`} />
        </div>
      </div>

      {/* Reliability counters */}
      <div>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Reliability (since restart)</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
          <MetricCard label="WS Disconnects (Verto)" value={data.wsDisconnectsVerto}      color={data.wsDisconnectsVerto > 10 ? "#ff9f0a" : undefined} />
          <MetricCard label="WS Disconnects (SIP)"   value={data.wsDisconnectsSip}        color={data.wsDisconnectsSip > 10 ? "#ff9f0a" : undefined} />
          <MetricCard label="ICE Failures"           value={data.iceFailures}             color={data.iceFailures > 0 ? "#ff453a" : undefined} />
          <MetricCard label="Reg. Failures"          value={data.registrationFailures}    color={data.registrationFailures > 0 ? "#ff9f0a" : undefined} />
          <MetricCard label="FS Disconnects (Verto)" value={data.upstreamDisconnectsVerto} color={data.upstreamDisconnectsVerto > 5 ? "#ff9f0a" : undefined} />
          <MetricCard label="FS Disconnects (SIP)"   value={data.upstreamDisconnectsSip}  color={data.upstreamDisconnectsSip > 5 ? "#ff9f0a" : undefined} />
          <MetricCard label="Reconnects"             value={data.reconnectAttempts}       />
          <MetricCard label="Reconnect OK"           value={data.reconnectSuccesses}      color={data.reconnectSuccesses > 0 ? "#30d158" : undefined} />
        </div>
      </div>

      {/* Latency */}
      {data.callSetupLatency.count > 0 && (
        <div>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Call Setup Latency ({data.callSetupLatency.count} samples)</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            <MetricCard label="p50" value={`${data.callSetupLatency.p50}ms`} />
            <MetricCard label="p95" value={`${data.callSetupLatency.p95}ms`} color={data.callSetupLatency.p95 > 3000 ? "#ff9f0a" : undefined} />
            <MetricCard label="p99" value={`${data.callSetupLatency.p99}ms`} color={data.callSetupLatency.p99 > 5000 ? "#ff453a" : undefined} />
          </div>
        </div>
      )}

      {/* Prometheus scrape info */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "12px 14px" }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", margin: "0 0 4px" }}>Prometheus Scrape Endpoint</p>
        <code style={{ fontSize: 11, color: "#a8ff78", fontFamily: "monospace" }}>/api/metrics</code>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "6px 0 0" }}>Add this URL to your Prometheus <code>scrape_configs</code> to collect all PRaww+ platform metrics.</p>
      </div>
    </div>
  );
}

// ─── Operations Center Tab (Phase 1) ──────────────────────────────────────────

const OP_SECTIONS = [
  { id: "health",   label: "Platform Health" },
  { id: "infra",    label: "Infrastructure" },
  { id: "regs",     label: "Registrations"  },
  { id: "deploy",   label: "Deploy Info"    },
  { id: "events",   label: "Live Events"    },
  { id: "push",     label: "Push Stats"     },
] as const;
type OpSection = typeof OP_SECTIONS[number]["id"];

interface SysMetrics {
  cpu: { cores: number; model: string; avgUsagePct: number; loadavg: Record<string, string> };
  memory: { totalMb: number; freeMb: number; usedMb: number; usedPct: number };
  disk: { totalKb: number; usedKb: number; availKb: number; usedPct: number } | null;
  process: { rssKb: number; heapUsedKb: number; heapTotalKb: number; pid: number; uptimeS: number };
  system: { uptimeS: number; platform: string; arch: string; hostname: string };
}
interface GitInfo {
  sha: string; shortSha: string; branch: string;
  message: string; date: string | null; author: string | null; available: boolean;
}
interface LiveRegs {
  verto: Array<{ extension: number; displayName: string | null; sessId: string; pingAgeMs: number; alive: boolean; connectedAt: number; reconnectCount: number }>;
  sip:   Array<{ extension: number; displayName: string | null; contact?: string; regAgeMs: number; expiresInMs: number; alive: boolean; expired: boolean }>;
  totalOnline: number;
  asOf: string;
}
interface TlsInfo { available: boolean; hostname?: string; daysRemaining?: number; issuer?: string; validTo?: string; healthy?: boolean; critical?: boolean; warning?: boolean; reason?: string }
interface PushStats { fcm: {sent:number;failed:number}; webpush: {sent:number;failed:number}; expo: {sent:number;failed:number}; wakeups: number; totals: {sent:number;failed:number;successRate:number|null} }
interface SseMetricsEvent { activeCalls: number; activeVertoClients: number; activeSipClients: number; uptimeSeconds: number; callsInitiated: number; callsAnswered: number; callsFailed: number }

interface HealthSample {
  ts:           number;
  eslConnected: boolean;
  bufferDepth:  number;
  staleTotal:   number;
  pendingCount: number;
}

interface PlatformHealth {
  esl: {
    enabled: boolean;
    connected: boolean;
    host: string;
    port: number;
    disconnectedMs: number | null;
    lastConnectedAt: number | null;
    lastDisconnectedAt: number | null;
    lastEventAt: number | null;
    lastDisconnectReason: string | null;
    reconnectAttempt: number;
  };
  eslBuffer: { depth: number };
  queues: Array<{
    queueId: string; queueName: string; depth: number;
    avgWaitSec: number; longestWaitSec: number;
    agentsAvail: number; agentsBusy: number; agentsPaused: number;
    callsHandled: number; callsAbandoned: number; callsOverflowed: number;
  }>;
  reconciliation: {
    cycles: number;
    lastRanAt: number | null;
    lastStale: { initiated: number; ringing: number; answered: number; bridged: number };
    lastPending: number;
  };
  asOf: string;
}

// ── Sparkline — pure SVG, no library ─────────────────────────────────────────
function Sparkline({
  values,
  width = 200,
  height = 36,
  color = "#1a8cff",
  fillOpacity = 0.12,
  strokeWidth = 1.5,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  strokeWidth?: number;
  label?: string;
}) {
  if (values.length < 2) {
    return (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{values.length < 2 ? "Collecting data…" : ""}</span>
      </div>
    );
  }
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = pad + ((max - v) / range) * (height - pad * 2);
    return [x, y] as [number, number];
  });
  const linePath = "M " + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L ");
  const areaPath = linePath +
    ` L ${pts[pts.length - 1][0].toFixed(1)},${(height - pad).toFixed(1)}` +
    ` L ${pts[0][0].toFixed(1)},${(height - pad).toFixed(1)} Z`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {label && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{label}</span>}
      <svg width={width} height={height} style={{ overflow: "visible" }}>
        <path d={areaPath} fill={color} fillOpacity={fillOpacity} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        {/* Last value dot */}
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill={color} />
      </svg>
    </div>
  );
}

// ESL connection timeline: coloured segments (green=connected, red=not)
function EslTimeline({ samples, width = 200, height = 16 }: { samples: Array<{ eslConnected: boolean }>; width?: number; height?: number }) {
  if (samples.length === 0) return <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>Collecting data…</span>;
  const segW = width / samples.length;
  return (
    <svg width={width} height={height} style={{ borderRadius: 4, overflow: "hidden" }}>
      {samples.map((s, i) => (
        <rect
          key={i}
          x={i * segW}
          y={0}
          width={Math.max(1, segW - 0.5)}
          height={height}
          fill={s.eslConnected ? "#30d158" : "#ff453a"}
          opacity={0.85}
        />
      ))}
    </svg>
  );
}

function OpsDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  const color = ok ? "#30d158" : warn ? "#ff9f0a" : "#ff453a";
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />;
}

function OpsCard({ label, value, sub, icon: Icon, color, pct }: { label: string; value: React.ReactNode; sub?: string; icon?: React.ElementType; color?: string; pct?: number }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {Icon && <Icon style={{ width: 12, height: 12, color: "rgba(255,255,255,0.3)" }} />}
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</span>
      </div>
      <span style={{ fontSize: 24, fontWeight: 700, color: color ?? "rgba(255,255,255,0.9)", lineHeight: 1 }}>{value}</span>
      {pct !== undefined && (
        <div style={{ height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: pct > 85 ? "#ff453a" : pct > 65 ? "#ff9f0a" : "#30d158", transition: "width 0.4s" }} />
        </div>
      )}
      {sub && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{sub}</span>}
    </div>
  );
}

function fmtBytes(kb: number): string {
  if (kb >= 1_048_576) return `${(kb / 1_048_576).toFixed(1)} TB`;
  if (kb >= 1_024)     return `${(kb / 1_024).toFixed(1)} GB`;
  return `${kb} MB`;
}

function fmtUptimeSec(s: number): string {
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function OperationsTab() {
  const [section, setSection] = React.useState<OpSection>("health");
  const [sysMetrics,      setSysMetrics]      = React.useState<SysMetrics | null>(null);
  const [gitInfo,         setGitInfo]         = React.useState<GitInfo | null>(null);
  const [regs,            setRegs]            = React.useState<LiveRegs | null>(null);
  const [tlsInfo,         setTlsInfo]         = React.useState<TlsInfo | null>(null);
  const [pushStats,       setPushStats]       = React.useState<PushStats | null>(null);
  const [platformHealth,  setPlatformHealth]  = React.useState<PlatformHealth | null>(null);
  const [healthHistory,   setHealthHistory]   = React.useState<HealthSample[]>([]);
  const [sseMetrics, setSseMetrics]   = React.useState<SseMetricsEvent | null>(null);
  const [events,     setEvents]       = React.useState<Array<{type:string;data:string;ts:number}>>([]);
  const [sseStatus,  setSseStatus]    = React.useState<"connecting"|"connected"|"disconnected">("connecting");
  const [loading,    setLoading]      = React.useState(true);
  const [_error,     setError]        = React.useState<string | null>(null);
  const [lastRefresh,setLastRefresh]  = React.useState<Date | null>(null);
  const [eslRecon,   setEslRecon]     = React.useState<"idle"|"busy"|"done"|"err">("idle");
  const eventLogRef = React.useRef<HTMLDivElement>(null);

  // Fetch all polling data
  const loadAll = React.useCallback(async () => {
    try {
      const [sm, gi, r, tls, ps, ph, hh] = await Promise.allSettled([
        adminFetch("/admin/system-metrics"),
        adminFetch("/admin/git-info"),
        adminFetch("/admin/live-registrations"),
        adminFetch("/admin/tls-info"),
        adminFetch("/admin/push-stats"),
        adminFetch("/admin/platform-health"),
        adminFetch("/admin/platform-health-history"),
      ]);
      if (sm.status  === "fulfilled") setSysMetrics(sm.value);
      if (gi.status  === "fulfilled") setGitInfo(gi.value);
      if (r.status   === "fulfilled") setRegs(r.value);
      if (tls.status === "fulfilled") setTlsInfo(tls.value);
      if (ps.status  === "fulfilled") setPushStats(ps.value);
      if (ph.status  === "fulfilled") setPlatformHealth(ph.value);
      if (hh.status  === "fulfilled" && Array.isArray(hh.value?.samples)) setHealthHistory(hh.value.samples);
      setLastRefresh(new Date());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 15_000);
    return () => clearInterval(t);
  }, [loadAll]);

  // SSE connection for live events
  React.useEffect(() => {
    let es: EventSource;
    const connect = () => {
      es = new EventSource("/api/admin/events/stream", { withCredentials: true });
      setSseStatus("connecting");
      es.addEventListener("connected", () => setSseStatus("connected"));
      es.addEventListener("metrics",   (e: MessageEvent) => { try { setSseMetrics(JSON.parse(e.data)); } catch {} });
      es.addEventListener("esl",       (e: MessageEvent) => {
        setEvents(prev => {
          const next = [...prev, { type: "esl", data: e.data, ts: Date.now() }];
          return next.slice(-100);
        });
      });
      es.onerror = () => { setSseStatus("disconnected"); };
    };
    connect();
    return () => { try { es?.close(); } catch {} };
  }, []);

  // Auto-scroll event log
  React.useEffect(() => {
    if (eventLogRef.current) eventLogRef.current.scrollTop = eventLogRef.current.scrollHeight;
  }, [events]);

  const eslReconnect = async () => {
    setEslRecon("busy");
    try {
      await adminFetch("/admin/esl/reconnect", { method: "POST" });
      setEslRecon("done");
      setTimeout(() => setEslRecon("idle"), 3000);
    } catch {
      setEslRecon("err");
      setTimeout(() => setEslRecon("idle"), 3000);
    }
  };

  const pushFsConfig = async () => {
    try { await adminFetch("/admin/freeswitch/push-config", { method: "POST" }); } catch {}
  };

  const SectionBtn = ({ id, label }: { id: OpSection; label: string }) => (
    <button
      onClick={() => setSection(id)}
      style={{
        padding: "5px 12px", borderRadius: 16, fontSize: 12, fontWeight: 600,
        border: "none", cursor: "pointer", transition: "all 0.12s",
        background: section === id ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
        color: section === id ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
      }}
    >{label}</button>
  );

  if (loading && !sysMetrics) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "20px 0", color: "rgba(255,255,255,0.35)" }}>
      <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading operations data…
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.85)", margin: 0 }}>Operations Center</h2>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: sseStatus === "connected" ? "#30d158" : "#ff9f0a", background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "2px 8px" }}>
            <OpsDot ok={sseStatus === "connected"} warn={sseStatus === "connecting"} />
            {sseStatus === "connected" ? "Live" : sseStatus === "connecting" ? "Connecting" : "Offline"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {lastRefresh && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>Refreshed {formatDistanceToNow(lastRefresh, { addSuffix: true })}</span>}
          <button onClick={loadAll} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "4px 10px", color: "rgba(255,255,255,0.45)", fontSize: 11, cursor: "pointer" }}>
            <RefreshCw size={10} /> Refresh
          </button>
        </div>
      </div>

      {/* Live metrics bar — always visible */}
      {(sseMetrics ?? sysMetrics) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px,1fr))", gap: 8 }}>
          <OpsCard label="Active Calls"    value={sseMetrics?.activeCalls   ?? 0} color={(sseMetrics?.activeCalls ?? 0) > 0 ? "#30d158" : undefined} icon={PhoneCall} />
          <OpsCard label="Verto Clients"   value={sseMetrics?.activeVertoClients ?? 0} color={(sseMetrics?.activeVertoClients ?? 0) > 0 ? "#1a8cff" : undefined} icon={Wifi} />
          <OpsCard label="SIP Clients"     value={sseMetrics?.activeSipClients ?? 0} color={(sseMetrics?.activeSipClients ?? 0) > 0 ? "#bf5af2" : undefined} icon={Radio} />
          <OpsCard label="Uptime"          value={fmtUptimeSec(sseMetrics?.uptimeSeconds ?? 0)} icon={Clock} />
          <OpsCard label="Calls Today"     value={sseMetrics?.callsInitiated ?? 0} icon={TrendingUp} sub={`${sseMetrics?.callsAnswered ?? 0} answered`} />
        </div>
      )}

      {/* Sub-section nav */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {OP_SECTIONS.map((s) => <SectionBtn key={s.id} id={s.id} label={s.label} />)}
      </div>

      {/* ── Platform Health ──────────────────────────────────────── */}
      {section === "health" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {!platformHealth && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.35)", fontSize: 13 }}>
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading platform health…
            </div>
          )}

          {platformHealth && (() => {
            const esl = platformHealth.esl;
            const buf = platformHealth.eslBuffer;
            const recon = platformHealth.reconciliation;
            const eslDisconnSec = esl.disconnectedMs != null ? Math.round(esl.disconnectedMs / 1000) : null;
            const lastEventAgo = esl.lastEventAt ? Math.round((Date.now() - esl.lastEventAt) / 1000) : null;
            const lastReconAgo = recon.lastRanAt ? Math.round((Date.now() - recon.lastRanAt) / 1000) : null;
            const totalStale = recon.lastStale.initiated + recon.lastStale.ringing + recon.lastStale.answered + recon.lastStale.bridged;

            return (
              <>
                {/* ESL Connection */}
                <div>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>FreeSWITCH ESL Connection</p>
                  <div style={{ background: esl.connected ? "rgba(48,209,88,0.06)" : esl.enabled ? "rgba(255,69,58,0.08)" : "rgba(255,255,255,0.04)", border: `1px solid ${esl.connected ? "rgba(48,209,88,0.2)" : esl.enabled ? "rgba(255,69,58,0.25)" : "rgba(255,255,255,0.07)"}`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: esl.connected ? "#30d158" : esl.enabled ? "#ff453a" : "#636366", flexShrink: 0 }} />
                      <span style={{ fontSize: 15, fontWeight: 700, color: esl.connected ? "#30d158" : esl.enabled ? "#ff453a" : "rgba(255,255,255,0.4)" }}>
                        {!esl.enabled ? "Disabled (FREESWITCH_DOMAIN not set)" : esl.connected ? "Connected" : "Disconnected"}
                      </span>
                      {esl.enabled && !esl.connected && eslDisconnSec != null && (
                        <span style={{ fontSize: 12, color: "#ff9f0a", background: "rgba(255,159,10,0.1)", borderRadius: 8, padding: "2px 8px" }}>
                          {eslDisconnSec < 60 ? `${eslDisconnSec}s` : `${Math.round(eslDisconnSec / 60)}m`} disconnected
                        </span>
                      )}
                      {esl.reconnectAttempt > 0 && (
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginLeft: "auto" }}>{esl.reconnectAttempt} reconnect attempt{esl.reconnectAttempt !== 1 ? "s" : ""}</span>
                      )}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Host</span>
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "monospace" }}>{esl.host || "—"}:{esl.port}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Last Event</span>
                        <span style={{ fontSize: 12, color: lastEventAgo != null && lastEventAgo > 60 ? "#ff9f0a" : "rgba(255,255,255,0.7)" }}>
                          {lastEventAgo != null ? (lastEventAgo < 60 ? `${lastEventAgo}s ago` : `${Math.round(lastEventAgo / 60)}m ago`) : "—"}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Last Connected</span>
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{esl.lastConnectedAt ? new Date(esl.lastConnectedAt).toLocaleTimeString() : "—"}</span>
                      </div>
                      {esl.lastDisconnectReason && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Disconnect Reason</span>
                          <span style={{ fontSize: 12, color: "#ff9f0a", fontFamily: "monospace" }}>{esl.lastDisconnectReason}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ESL Event Buffer */}
                <div>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>ESL Event Buffer</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                    <div style={{ background: buf.depth > 10 ? "rgba(255,159,10,0.07)" : "rgba(255,255,255,0.04)", border: `1px solid ${buf.depth > 10 ? "rgba(255,159,10,0.25)" : "rgba(255,255,255,0.07)"}`, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Database style={{ width: 12, height: 12, color: "rgba(255,255,255,0.3)" }} />
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>In-Flight Events</span>
                      </div>
                      <span style={{ fontSize: 28, fontWeight: 700, color: buf.depth > 10 ? "#ff9f0a" : buf.depth > 0 ? "#1a8cff" : "rgba(255,255,255,0.9)", lineHeight: 1 }}>{buf.depth}</span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{buf.depth === 0 ? "No queued ESL events" : buf.depth > 10 ? "High buffer — possible DB lag" : "Events being processed"}</span>
                    </div>
                  </div>
                </div>

                {/* Reconciliation Worker */}
                <div>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Reconciliation Worker</p>
                  <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                      <OpsCard label="Cycles Run"     value={recon.cycles}       icon={RefreshCw}  sub="since server start" />
                      <OpsCard label="Last Ran"       value={lastReconAgo != null ? (lastReconAgo < 60 ? `${lastReconAgo}s ago` : `${Math.round(lastReconAgo/60)}m ago`) : "not yet"} icon={Clock} />
                      <OpsCard label="Pending Events" value={recon.lastPending}  icon={Database}   color={recon.lastPending > 5 ? "#ff9f0a" : undefined} sub="persisted ESL events" />
                      <OpsCard label="Stale (last)"   value={totalStale}         icon={AlertTriangle} color={totalStale > 0 ? "#ff9f0a" : undefined} sub="calls closed by reconciler" />
                    </div>
                    {totalStale > 0 && (
                      <div style={{ background: "rgba(255,159,10,0.07)", border: "1px solid rgba(255,159,10,0.2)", borderRadius: 10, padding: "10px 14px" }}>
                        <p style={{ fontSize: 11, fontWeight: 600, color: "#ff9f0a", margin: "0 0 6px" }}>Stale calls closed in last cycle</p>
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                          {recon.lastStale.initiated > 0  && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>initiated: <strong style={{ color: "#ff9f0a" }}>{recon.lastStale.initiated}</strong></span>}
                          {recon.lastStale.ringing > 0    && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>ringing: <strong style={{ color: "#ff9f0a" }}>{recon.lastStale.ringing}</strong></span>}
                          {recon.lastStale.answered > 0   && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>answered: <strong style={{ color: "#ff453a" }}>{recon.lastStale.answered}</strong></span>}
                          {recon.lastStale.bridged > 0    && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>bridged: <strong style={{ color: "#ff453a" }}>{recon.lastStale.bridged}</strong></span>}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Active Call Queues */}
                <div>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
                    Call Queues ({platformHealth.queues.length} active)
                  </p>
                  {platformHealth.queues.length === 0 ? (
                    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "20px", textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
                      No active queues — callers will appear here once they enter a queue
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {platformHealth.queues.map((q) => (
                        <div key={q.queueId} style={{ background: q.depth > 0 ? "rgba(26,140,255,0.06)" : "rgba(255,255,255,0.04)", border: `1px solid ${q.depth > 0 ? "rgba(26,140,255,0.2)" : "rgba(255,255,255,0.07)"}`, borderRadius: 12, padding: "14px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>{q.queueName || q.queueId}</span>
                              {q.depth > 0 && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#1a8cff", background: "rgba(26,140,255,0.15)", borderRadius: 8, padding: "1px 8px" }}>
                                  {q.depth} waiting
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>ID: {q.queueId.slice(0, 8)}…</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 6 }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Depth</span>
                              <span style={{ fontSize: 16, fontWeight: 700, color: q.depth > 0 ? "#1a8cff" : "rgba(255,255,255,0.6)" }}>{q.depth}</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Avg Wait</span>
                              <span style={{ fontSize: 16, fontWeight: 700, color: q.avgWaitSec > 120 ? "#ff9f0a" : "rgba(255,255,255,0.6)" }}>{q.avgWaitSec}s</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Agents</span>
                              <span style={{ fontSize: 16, fontWeight: 700, color: q.agentsAvail > 0 ? "#30d158" : "#ff453a" }}>{q.agentsAvail}</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Handled</span>
                              <span style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>{q.callsHandled}</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Abandoned</span>
                              <span style={{ fontSize: 16, fontWeight: 700, color: q.callsAbandoned > 0 ? "#ff9f0a" : "rgba(255,255,255,0.6)" }}>{q.callsAbandoned}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Historical Sparklines (ring buffer — one sample per recon cycle) */}
                {healthHistory.length > 0 && (
                  <div>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>
                      History ({healthHistory.length} samples · 1 per cycle · oldest → newest)
                    </p>
                    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
                      {/* ESL connection timeline */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>ESL Connection</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <EslTimeline samples={healthHistory} width={320} height={14} />
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                            <span style={{ color: "#30d158" }}>■</span> up &nbsp;
                            <span style={{ color: "#ff453a" }}>■</span> down
                          </span>
                        </div>
                      </div>
                      {/* Sparklines row */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
                        <Sparkline
                          values={healthHistory.map(s => s.bufferDepth)}
                          width={220} height={40}
                          color="#1a8cff"
                          label="ESL Buffer Depth"
                        />
                        <Sparkline
                          values={healthHistory.map(s => s.staleTotal)}
                          width={220} height={40}
                          color="#ff9f0a"
                          label="Stale Calls Closed"
                        />
                        <Sparkline
                          values={healthHistory.map(s => s.pendingCount)}
                          width={220} height={40}
                          color="#bf5af2"
                          label="Pending ESL Events"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", margin: 0 }}>Refreshes every 15 s · All data is in-memory (no DB round-trip) · as of {new Date(platformHealth.asOf).toLocaleTimeString()}</p>
              </>
            );
          })()}
        </div>
      )}

      {/* ── Infrastructure ────────────────────────────────────────── */}
      {section === "infra" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* System resources */}
          {sysMetrics && (
            <div>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>System Resources — {sysMetrics.system.hostname}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8 }}>
                <OpsCard label="CPU" value={`${sysMetrics.cpu.avgUsagePct}%`} icon={Cpu} pct={sysMetrics.cpu.avgUsagePct} sub={`${sysMetrics.cpu.cores} cores · ${sysMetrics.cpu.loadavg["1m"]} load`} />
                <OpsCard label="RAM" value={`${sysMetrics.memory.usedPct}%`} icon={MemoryStick} pct={sysMetrics.memory.usedPct} sub={`${sysMetrics.memory.usedMb} / ${sysMetrics.memory.totalMb} MB`} />
                {sysMetrics.disk && (
                  <OpsCard label="Disk" value={`${sysMetrics.disk.usedPct}%`} icon={HardDrive} pct={sysMetrics.disk.usedPct} sub={`${fmtBytes(sysMetrics.disk.usedKb)} / ${fmtBytes(sysMetrics.disk.totalKb)}`} />
                )}
                <OpsCard label="Process RSS" value={`${Math.round(sysMetrics.process.rssKb/1024)} MB`} icon={Server} sub={`Heap: ${Math.round(sysMetrics.process.heapUsedKb/1024)} / ${Math.round(sysMetrics.process.heapTotalKb/1024)} MB`} />
                <OpsCard label="Sys Uptime" value={fmtUptimeSec(sysMetrics.system.uptimeS)} sub={`PID ${sysMetrics.process.pid} · ${sysMetrics.system.platform}/${sysMetrics.system.arch}`} />
              </div>
            </div>
          )}

          {/* Service health status grid */}
          <div>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Service Health</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8 }}>

              {/* TLS cert */}
              {tlsInfo && (
                <div style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${tlsInfo.critical ? "rgba(255,69,58,0.3)" : tlsInfo.warning ? "rgba(255,159,10,0.3)" : "rgba(255,255,255,0.07)"}`, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <OpsDot ok={!!(tlsInfo.available && tlsInfo.healthy)} warn={tlsInfo.warning} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.07em" }}>TLS Certificate</span>
                  </div>
                  {tlsInfo.available ? (
                    <>
                      <span style={{ fontSize: 20, fontWeight: 700, color: tlsInfo.critical ? "#ff453a" : tlsInfo.warning ? "#ff9f0a" : "#30d158" }}>{tlsInfo.daysRemaining}d left</span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{tlsInfo.issuer} · expires {tlsInfo.validTo ? new Date(tlsInfo.validTo).toLocaleDateString() : "unknown"}</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{tlsInfo.reason ?? "Not checked"}</span>
                  )}
                </div>
              )}

              {/* Prometheus */}
              <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <OpsDot ok={true} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Metrics</span>
                </div>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>/api/metrics</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Prometheus scrape endpoint active</span>
              </div>
            </div>
          </div>

          {/* Service controls */}
          <div>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Service Controls</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={eslReconnect}
                disabled={eslRecon === "busy"}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)", background: eslRecon === "done" ? "rgba(48,209,88,0.15)" : eslRecon === "err" ? "rgba(255,69,58,0.15)" : "rgba(255,255,255,0.06)", color: eslRecon === "done" ? "#30d158" : eslRecon === "err" ? "#ff453a" : "rgba(255,255,255,0.7)" }}
              >
                {eslRecon === "busy" ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Zap size={12} />}
                {eslRecon === "done" ? "ESL Reconnected" : eslRecon === "err" ? "Reconnect Failed" : "Reconnect ESL"}
              </button>
              <button
                onClick={pushFsConfig}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}
              >
                <Server size={12} /> Push FS Config
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Live Registrations ────────────────────────────────────── */}
      {section === "regs" && regs && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: "#30d158" }}>{regs.totalOnline}</span>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>online devices</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginLeft: "auto" }}>as of {new Date(regs.asOf).toLocaleTimeString()}</span>
          </div>

          {/* Verto sessions */}
          {regs.verto.length > 0 && (
            <div>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Verto (WebRTC) — {regs.verto.length}</p>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
                {regs.verto.map((s, i) => (
                  <div key={s.sessId} style={{ display: "grid", gridTemplateColumns: "32px 80px 1fr 90px 90px", gap: 12, alignItems: "center", padding: "10px 14px", borderBottom: i < regs.verto.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                    <OpsDot ok={s.alive} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#1a8cff" }}>Ext {s.extension}</span>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.displayName ?? "—"}</span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{s.alive ? `${Math.round(s.pingAgeMs/1000)}s ago` : "stale"}</span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{s.reconnectCount > 0 ? `${s.reconnectCount} reconnects` : "stable"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SIP sessions */}
          {regs.sip.length > 0 && (
            <div>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>SIP (Mobile) — {regs.sip.length}</p>
              <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
                {regs.sip.map((s, i) => (
                  <div key={`${s.extension}-${i}`} style={{ display: "grid", gridTemplateColumns: "32px 80px 1fr 90px 90px", gap: 12, alignItems: "center", padding: "10px 14px", borderBottom: i < regs.sip.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                    <OpsDot ok={s.alive} warn={s.expiresInMs < 300_000 && s.alive} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#bf5af2" }}>Ext {s.extension}</span>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.displayName ?? s.contact ?? "—"}</span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{s.alive ? `expires ${Math.floor(s.expiresInMs/60000)}m` : "expired"}</span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{Math.round(s.regAgeMs/60000)}m ago</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {regs.verto.length === 0 && regs.sip.length === 0 && (
            <div style={{ padding: "24px", textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>No active registrations</div>
          )}
        </div>
      )}

      {/* ── Deploy Info ───────────────────────────────────────────── */}
      {section === "deploy" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {gitInfo && (
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <GitBranch size={14} style={{ color: "rgba(255,255,255,0.4)" }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>Current Deployment</span>
                {!gitInfo.available && <span style={{ fontSize: 11, color: "#ff9f0a", background: "rgba(255,159,10,0.1)", borderRadius: 8, padding: "2px 8px" }}>Git not available</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Commit</span>
                <span style={{ fontSize: 12, color: "#a8ff78", fontFamily: "monospace" }}>{gitInfo.shortSha}</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Branch</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "monospace" }}>{gitInfo.branch}</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Message</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{gitInfo.message}</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Author</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{gitInfo.author ?? "—"}</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Date</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{gitInfo.date ? new Date(gitInfo.date).toLocaleString() : "—"}</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Full SHA</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", wordBreak: "break-all" }}>{gitInfo.sha}</span>
              </div>
            </div>
          )}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "14px 16px" }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", margin: "0 0 8px" }}>Deploy to VPS</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "0 0 8px" }}>SSH into your VPS and run:</p>
            <code style={{ display: "block", fontSize: 11, color: "#a8ff78", fontFamily: "monospace", background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 12px" }}>
              cd /home/ubuntu/PRawwPlus && bash deploy/update.sh
            </code>
          </div>
        </div>
      )}

      {/* ── Live Event Stream ─────────────────────────────────────── */}
      {section === "events" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>SSE Event Stream</span>
            <span style={{ fontSize: 11, color: sseStatus === "connected" ? "#30d158" : "#ff9f0a", background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "2px 8px" }}>
              ● {sseStatus}
            </span>
            <button onClick={() => setEvents([])} style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.3)", background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "2px 8px", cursor: "pointer" }}>Clear</button>
          </div>
          <div
            ref={eventLogRef}
            style={{ background: "rgba(0,0,0,0.35)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)", padding: "12px", height: 360, overflowY: "auto", fontFamily: "monospace", fontSize: 11 }}
          >
            {events.length === 0 ? (
              <span style={{ color: "rgba(255,255,255,0.2)" }}>Waiting for events… (metrics broadcast every 5s)</span>
            ) : (
              events.map((ev, i) => (
                <div key={i} style={{ marginBottom: 4, color: ev.type === "esl" ? "#bf5af2" : "rgba(255,255,255,0.55)" }}>
                  <span style={{ color: "rgba(255,255,255,0.2)" }}>{new Date(ev.ts).toLocaleTimeString()} </span>
                  <span style={{ color: "#a8ff78" }}>[{ev.type}] </span>
                  <span>{ev.data.slice(0, 200)}{ev.data.length > 200 ? "…" : ""}</span>
                </div>
              ))
            )}
          </div>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", margin: 0 }}>Live SSE feed. Metrics broadcast every 5 s · ESL events broadcast in realtime · Last 100 events retained</p>
        </div>
      )}

      {/* ── Push Stats ───────────────────────────────────────────── */}
      {section === "push" && pushStats && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8 }}>
            <OpsCard label="FCM Sent"       value={pushStats.fcm.sent}     color={pushStats.fcm.sent     > 0 ? "#30d158" : undefined} icon={Bell} sub={`${pushStats.fcm.failed} failed`} />
            <OpsCard label="Web Push Sent"  value={pushStats.webpush.sent} color={pushStats.webpush.sent > 0 ? "#30d158" : undefined} icon={Bell} sub={`${pushStats.webpush.failed} failed`} />
            <OpsCard label="Expo Sent"      value={pushStats.expo.sent}    color={pushStats.expo.sent    > 0 ? "#30d158" : undefined} icon={Bell} sub={`${pushStats.expo.failed} failed`} />
            <OpsCard label="Wakeups"        value={pushStats.wakeups}      color={pushStats.wakeups > 0 ? "#ff9f0a" : undefined} icon={Smartphone} sub="mobile wakeup pushes" />
          </div>
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>Overall Delivery</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: "#30d158" }}>{pushStats.totals.sent}</span>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>sent · {pushStats.totals.failed} failed</span>
              {pushStats.totals.successRate !== null && (
                <span style={{ fontSize: 13, color: "#a8ff78", marginLeft: "auto" }}>{pushStats.totals.successRate}% success rate</span>
              )}
            </div>
            {pushStats.totals.successRate !== null && (
              <div style={{ height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pushStats.totals.successRate}%`, background: pushStats.totals.successRate > 90 ? "#30d158" : pushStats.totals.successRate > 70 ? "#ff9f0a" : "#ff453a" }} />
              </div>
            )}
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>Counters reset on server restart</span>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Main Admin Page ───────────────────────────────────────────────────────────
export default function Admin() {
  const [tab, setTab] = useState<TabId>("overview");

  return (
    <div data-theme="dark" className="space-y-4 animate-in fade-in duration-500">
      {/* Header */}
      <div className="pt-1 flex items-center gap-3">
        <Shield className="w-5 h-5 text-white/40 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold text-white leading-none tracking-tight">Admin Panel</h1>
          <p className="text-xs text-white/35 mt-0.5">Manage users, billing, and platform settings</p>
        </div>
      </div>

      {/* Scrollable pill tabs */}
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

      {/* Tab content */}
      <div>
        {tab === "overview"      && <OverviewTab onSwitchTab={setTab} />}
        {tab === "operations"    && <OperationsTab />}
        {tab === "observability" && <ObservabilityTab />}
        {tab === "users"         && <UsersTab />}
        {tab === "live"          && <LiveCallsTab />}
        {tab === "errors"        && <ErrorsTab onSwitchTab={setTab} />}
        {tab === "system"           && <SystemTab />}
        {tab === "platform-health"  && <PlatformHealthTab />}
        {tab === "push"          && <PushTab />}
        {tab === "referrals"     && <ReferralsTab />}
        {tab === "earnings"      && <EarningsTab />}
        {tab === "expenses"      && <ExpensesTab />}
        {tab === "payouts"       && <PayoutsTab />}
        {tab === "abuse"         && <CallsAbuseTab />}
        {tab === "announcements" && <AnnouncementsTab />}
        {tab === "rate-plans"    && <RatePlansTab />}
        {tab === "audit"         && <AuditTab />}
        {tab === "alert-rules"   && <AlertRulesTab />}
        {tab === "ip-blocks"     && <IpBlocksTab />}
        {tab === "tenants"       && <TenantsTab />}
        {tab === "ivr"           && <IvrQueuesTab />}
        {tab === "security"      && <SecurityTab />}
        {tab === "analytics"     && <AnalyticsTab />}
        {tab === "commissions"   && <CommissionsTab />}
      </div>
    </div>
  );
}

// ─── Platform Health Tab ────────────────────────────────────────────────────────

interface PlatformHealthData {
  status:        string;
  ts:            string;
  uptimeSeconds: number;
  db:            { ok: boolean; latencyMs: number; state: number };
  esl:           { connected: boolean; lastEventStaleSec: number | null; eventsThisMinute: number; bgapiQueueDepth: number; reconnectAttempt: number; stalledThroughputEvents: number };
  websocket:     { activeVertoClients: number; activeSipClients: number; sipRegistrationsInMemory: number; wsConnectionsRejectedIpLimit: number };
  calls:         { activeCalls: number; callsInitiated: number; callsAnswered: number; callsFailed: number; answerRatePct: number | null };
  security:      { sipFloodBlocked: number; callThrottleRejections: number; registrationFailures: number; bgapiQueueDropped: number };
  sweeper:       { staleSweepRuns: number; staleSessionCleanups: number; zombieCallsKilled: number };
  push:          { fcm: { sent: number; failed: number }; web: { sent: number; failed: number }; expo: { sent: number; failed: number }; wakeups: number };
  process:       { heapUsedMb: number; heapTotalMb: number; rssMb: number; cpuUserMs: number; cpuSysMs: number; loopLagMs: number; sampledAt: string | null };
  history:       Array<{ ts: number; heapUsedMb: number; rssMb: number; loopLagMs: number; activeCalls: number; wsVertoClients: number }>;
}

function PhStatusDot({ ok }: { ok: boolean }) {
  return (
    <span style={{
      display: "inline-block",
      width: 8, height: 8, borderRadius: "50%",
      background: ok ? "#22c55e" : "#ef4444",
      marginRight: 6, flexShrink: 0,
    }} />
  );
}

function PhMetric({ label, value, unit, warn }: { label: string; value: string | number; unit?: string; warn?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 90 }}>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color: warn ? "#fbbf24" : "#f8fafc", lineHeight: 1 }}>
        {value}<span style={{ fontSize: 11, fontWeight: 400, color: "rgba(255,255,255,0.5)", marginLeft: 2 }}>{unit}</span>
      </span>
    </div>
  );
}

function PhCard({ title, icon: Icon, children, borderColor }: { title: string; icon: React.ElementType; children: React.ReactNode; borderColor?: string }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: `1px solid ${borderColor ?? "rgba(255,255,255,0.08)"}`,
      borderRadius: 10,
      padding: "16px 18px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
        <Icon size={14} style={{ color: "rgba(255,255,255,0.5)" }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function SparkLine({ data, dataKey, color }: { data: PlatformHealthData["history"]; dataKey: keyof PlatformHealthData["history"][0]; color: string }) {
  if (!data || data.length < 2) return <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>no data</span>;
  return (
    <ResponsiveContainer width="100%" height={48}>
      <RLineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line type="monotone" dataKey={dataKey as string} stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        <Tooltip
          contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 11 }}
          labelStyle={{ display: "none" }}
          formatter={(v: number) => [typeof v === "number" ? v.toFixed(1) : v, dataKey as string]}
        />
      </RLineChart>
    </ResponsiveContainer>
  );
}

function PlatformHealthTab() {
  const [data,    setData]    = useState<PlatformHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [lastOk,  setLastOk]  = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await adminFetch("/admin/platform-health");
      setData(d);
      setError(null);
      setLastOk(new Date().toLocaleTimeString());
    } catch (e: any) {
      setError(e.message ?? "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 32, color: "rgba(255,255,255,0.4)" }}>
      <Loader2 size={16} className="animate-spin" />
      <span>Loading platform health…</span>
    </div>
  );

  if (error) return (
    <div style={{ padding: 24, color: "#f87171", fontSize: 13 }}>
      <AlertTriangle size={14} style={{ display: "inline", marginRight: 6 }} />
      {error}
    </div>
  );

  if (!data) return null;

  const healthy     = data.status === "ok";
  const hist        = data.history ?? [];
  const loopLagWarn = (data.process?.loopLagMs ?? 0) > 100;
  const heapWarn    = (data.process?.heapUsedMb ?? 0) > 400;

  return (
    <div style={{ padding: "20px 0", display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "6px 14px", borderRadius: 20,
          background: healthy ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
          border: `1px solid ${healthy ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
          color: healthy ? "#4ade80" : "#f87171",
          fontSize: 12, fontWeight: 700, letterSpacing: "0.05em",
        }}>
          <PhStatusDot ok={healthy} />
          {healthy ? "HEALTHY" : "DEGRADED"}
        </div>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
          Uptime {Math.floor(data.uptimeSeconds / 3600)}h {Math.floor((data.uptimeSeconds % 3600) / 60)}m
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
          Updated {lastOk ?? "—"}
        </span>
        <button
          onClick={() => { setLoading(true); refresh(); }}
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", color: "rgba(255,255,255,0.6)", fontSize: 11 }}
        >
          <RefreshCw size={11} style={{ display: "inline", marginRight: 4 }} />Refresh
        </button>
      </div>

      {/* Row 1: DB / ESL / WS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>

        <PhCard title="Database" icon={Database} borderColor={data.db.ok ? undefined : "rgba(239,68,68,0.4)"}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <PhStatusDot ok={data.db.ok} />
            <span style={{ fontSize: 13, fontWeight: 600, color: data.db.ok ? "#f8fafc" : "#f87171" }}>
              {data.db.ok ? "Connected" : "Disconnected"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <PhMetric label="Latency" value={data.db.latencyMs} unit="ms" warn={data.db.latencyMs > 50} />
            <PhMetric label="State" value={["Disconnected","Connected","Connecting","Disconnecting","Uninitialized"][data.db.state] ?? data.db.state} />
          </div>
        </PhCard>

        <PhCard title="FreeSWITCH ESL" icon={Radio} borderColor={data.esl.connected ? undefined : "rgba(239,68,68,0.4)"}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <PhStatusDot ok={data.esl.connected} />
            <span style={{ fontSize: 13, fontWeight: 600, color: data.esl.connected ? "#f8fafc" : "#f87171" }}>
              {data.esl.connected ? "Connected" : "Disconnected"}
            </span>
            {data.esl.stalledThroughputEvents > 0 && (
              <span style={{ fontSize: 10, color: "#fbbf24", marginLeft: 4 }}>
                ⚠ {data.esl.stalledThroughputEvents} stall{data.esl.stalledThroughputEvents !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <PhMetric label="Events/min" value={data.esl.eventsThisMinute} />
            <PhMetric label="Stale" value={data.esl.lastEventStaleSec === null ? "—" : `${data.esl.lastEventStaleSec}s`} warn={(data.esl.lastEventStaleSec ?? 0) > 60} />
            <PhMetric label="Reconnects" value={data.esl.reconnectAttempt} />
            <PhMetric label="BgAPI Q" value={data.esl.bgapiQueueDepth} warn={data.esl.bgapiQueueDepth > 50} />
          </div>
        </PhCard>

        <PhCard title="WebSocket" icon={Wifi}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <PhMetric label="Verto" value={data.websocket.activeVertoClients} />
            <PhMetric label="SIP WS" value={data.websocket.activeSipClients} />
            <PhMetric label="SIP Reg" value={data.websocket.sipRegistrationsInMemory} />
            <PhMetric label="Rejected" value={data.websocket.wsConnectionsRejectedIpLimit} warn={data.websocket.wsConnectionsRejectedIpLimit > 0} />
          </div>
        </PhCard>

      </div>

      {/* Row 2: Calls / Security / Sweeper */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>

        <PhCard title="Calls" icon={PhoneCall}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <PhMetric label="Active"    value={data.calls.activeCalls} />
            <PhMetric label="Initiated" value={data.calls.callsInitiated} />
            <PhMetric label="Answered"  value={data.calls.callsAnswered} />
            <PhMetric label="Answer %" value={`${(data.calls.answerRatePct ?? 0).toFixed(1)}%`} warn={(data.calls.answerRatePct ?? 100) < 80} />
          </div>
        </PhCard>

        <PhCard title="Security" icon={ShieldCheck} borderColor={
          (data.security.sipFloodBlocked > 0 || data.security.callThrottleRejections > 0)
            ? "rgba(251,191,36,0.3)" : undefined
        }>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <PhMetric label="SIP Flood"  value={data.security.sipFloodBlocked}       warn={data.security.sipFloodBlocked > 0} />
            <PhMetric label="Throttled"  value={data.security.callThrottleRejections} warn={data.security.callThrottleRejections > 0} />
            <PhMetric label="Reg Fails"  value={data.security.registrationFailures}   warn={data.security.registrationFailures > 10} />
            <PhMetric label="BgAPI Drop" value={data.security.bgapiQueueDropped}      warn={data.security.bgapiQueueDropped > 0} />
          </div>
        </PhCard>

        <PhCard title="Session Sweeper" icon={Zap}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <PhMetric label="Runs"    value={data.sweeper.staleSweepRuns} />
            <PhMetric label="Stale"   value={data.sweeper.staleSessionCleanups} />
            <PhMetric label="Zombies" value={data.sweeper.zombieCallsKilled} warn={data.sweeper.zombieCallsKilled > 0} />
          </div>
        </PhCard>

      </div>

      {/* Row 3: Process */}
      <PhCard title="Process" icon={Cpu} borderColor={loopLagWarn || heapWarn ? "rgba(251,191,36,0.3)" : undefined}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <PhMetric label="Heap Used"  value={(data.process.heapUsedMb ?? 0).toFixed(1)} unit="MiB" warn={heapWarn} />
          <PhMetric label="Heap Total" value={(data.process.heapTotalMb ?? 0).toFixed(1)} unit="MiB" />
          <PhMetric label="RSS"        value={(data.process.rssMb ?? 0).toFixed(1)}        unit="MiB" />
          <PhMetric label="Loop Lag"   value={(data.process.loopLagMs ?? 0).toFixed(1)} unit="ms" warn={loopLagWarn} />
        </div>
      </PhCard>

      {/* Row 4: Sparklines */}
      {hist.length > 1 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>

          <PhCard title="Heap (MiB) — 15 min" icon={MemoryStick}>
            <SparkLine data={hist} dataKey="heapUsedMb" color="#60a5fa" />
          </PhCard>

          <PhCard title="Event-Loop Lag (ms) — 15 min" icon={Activity}>
            <SparkLine data={hist} dataKey="loopLagMs" color={loopLagWarn ? "#fbbf24" : "#4ade80"} />
          </PhCard>

          <PhCard title="Active Calls — 15 min" icon={PhoneCall}>
            <SparkLine data={hist} dataKey="activeCalls" color="#a78bfa" />
          </PhCard>

          <PhCard title="WS Verto Clients — 15 min" icon={Wifi}>
            <SparkLine data={hist} dataKey="wsVertoClients" color="#fb923c" />
          </PhCard>

        </div>
      )}

      {/* Row 5: Push */}
      <PhCard title="Push Notifications" icon={Bell}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <PhMetric label="FCM Sent"   value={data.push.fcm.sent} />
          <PhMetric label="FCM Failed" value={data.push.fcm.failed} warn={data.push.fcm.failed > 0} />
          <PhMetric label="Web Sent"   value={data.push.web.sent} />
          <PhMetric label="Expo Sent"  value={data.push.expo.sent} />
          <PhMetric label="Wakeups"    value={data.push.wakeups} />
        </div>
      </PhCard>

    </div>
  );
}

// ─── Audit Log Tab ─────────────────────────────────────────────────────────────
interface AuditEntry {
  _id: string;
  adminId: string;
  adminEmail?: string;
  action: string;
  targetType: string;
  targetId?: string;
  targetLabel?: string;
  details?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

const ACTION_COLOR: Record<string, string> = {
  "user.lock":           "#f87171",
  "user.unlock":         "#34d399",
  "user.set-role":       "#a78bfa",
  "user.adjust-credit":  "#fbbf24",
  "user.grant-badge":    "#60a5fa",
  "user.reject-badge":   "#f87171",
  "user.verify-email":   "#34d399",
  "user.verify-phone":   "#34d399",
};

function AuditTab() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const LIMIT = 25;

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const data = await adminFetch(`/admin/audit-logs?page=${p}&limit=${LIMIT}`);
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
      setPage(p);
    } catch (e: any) {
      toast({ title: "Failed to load audit logs", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(1); }, [load]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>Audit Log</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "2px 0 0" }}>Immutable record of all admin actions — retained for 2 years</p>
        </div>
        <button onClick={() => load(1)} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: loading ? "not-allowed" : "pointer", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)", opacity: loading ? 0.5 : 1 }}>
          <RefreshCw style={{ width: 11, height: 11, animation: loading ? "spin 1s linear infinite" : "none" }} />
          Refresh
        </button>
      </div>

      {loading && logs.length === 0 && (
        <div className="space-y-2">
          {[1,2,3,4,5].map((i) => <div key={i} className="rounded-xl bg-white/[0.04] animate-pulse" style={{ height: 52 }} />)}
        </div>
      )}

      {!loading && logs.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
          No audit log entries yet. Admin actions will appear here.
        </div>
      )}

      {logs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {logs.map((entry) => {
            const actionColor = ACTION_COLOR[entry.action] ?? "rgba(255,255,255,0.45)";
            return (
              <div key={entry._id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ flexShrink: 0, width: 8, height: 8, borderRadius: "50%", background: actionColor, marginTop: 5 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: actionColor, fontFamily: "monospace" }}>{entry.action}</span>
                    {entry.targetLabel && (
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.targetLabel}</span>
                    )}
                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                        {Object.entries(entry.details).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 3, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>by {entry.adminEmail ?? entry.adminId}</span>
                    {entry.ip && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>{entry.ip}</span>}
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, paddingTop: 4 }}>
          <button onClick={() => load(page - 1)} disabled={page <= 1 || loading} style={{ padding: "6px 14px", borderRadius: 16, fontSize: 12, fontWeight: 600, border: "none", cursor: page <= 1 ? "not-allowed" : "pointer", background: "rgba(255,255,255,0.07)", color: page <= 1 ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.6)" }}>← Prev</button>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>Page {page} of {totalPages}</span>
          <button onClick={() => load(page + 1)} disabled={page >= totalPages || loading} style={{ padding: "6px 14px", borderRadius: 16, fontSize: 12, fontWeight: 600, border: "none", cursor: page >= totalPages ? "not-allowed" : "pointer", background: "rgba(255,255,255,0.07)", color: page >= totalPages ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.6)" }}>Next →</button>
        </div>
      )}
    </div>
  );
}

// ─── Alert Rules Tab ────────────────────────────────────────────────────────────

interface AlertRuleEntry {
  _id: string;
  name: string;
  enabled: boolean;
  metric: string;
  condition: string;
  threshold: number;
  windowMinutes: number;
  cooldownMinutes: number;
  channels: { slackWebhook?: string; webhookUrl?: string; emailTo?: string };
  lastFiredAt?: string;
  createdAt: string;
}

interface AlertEventEntry {
  _id: string;
  ruleName: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  channels: string[];
  firedAt: string;
}

const METRIC_LABELS: Record<string, string> = {
  answer_rate:              "Answer Rate (%)",
  ice_failure_rate:         "ICE Failure Rate (%)",
  ws_disconnect_rate:       "WS Disconnects / min",
  active_calls_drop:        "Active Calls Drop to 0",
  call_setup_latency_p95:   "Call Setup Latency p95 (ms)",
  registration_failure_rate: "SIP Reg. Failures / min",
  reconnect_failure_rate:   "Reconnect Failures / min",
};

function AlertRulesTab() {
  const { toast } = useToast();
  const [rules, setRules]   = useState<AlertRuleEntry[]>([]);
  const [events, setEvents] = useState<AlertEventEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "", metric: "answer_rate", condition: "below", threshold: "80",
    windowMinutes: "5", cooldownMinutes: "30",
    slackWebhook: "", webhookUrl: "", emailTo: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, e] = await Promise.all([
        adminFetch("/admin/alert-rules"),
        adminFetch("/admin/alert-events?limit=20"),
      ]);
      setRules(r.rules ?? []);
      setEvents(e.events ?? []);
    } catch (err: any) {
      toast({ title: "Failed to load alerts", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (rule: AlertRuleEntry) => {
    try {
      await adminFetch(`/admin/alert-rules/${rule._id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      setRules((prev) => prev.map((r) => r._id === rule._id ? { ...r, enabled: !r.enabled } : r));
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  };

  const deleteRule = async (id: string) => {
    try {
      await adminFetch(`/admin/alert-rules/${id}`, { method: "DELETE" });
      setRules((prev) => prev.filter((r) => r._id !== id));
      toast({ title: "Rule deleted" });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const testRule = async (id: string) => {
    try {
      const res = await adminFetch(`/admin/alert-rules/${id}/test`, { method: "POST" });
      toast({ title: "Test delivered", description: `Channels: ${(res.fired ?? []).join(", ") || "none"}` });
    } catch (err: any) {
      toast({ title: "Test failed", description: err.message, variant: "destructive" });
    }
  };

  const createRule = async () => {
    try {
      const channels: Record<string, string> = {};
      if (form.slackWebhook) channels.slackWebhook = form.slackWebhook;
      if (form.webhookUrl)   channels.webhookUrl   = form.webhookUrl;
      if (form.emailTo)      channels.emailTo      = form.emailTo;

      await adminFetch("/admin/alert-rules", {
        method: "POST",
        body: JSON.stringify({
          name: form.name, metric: form.metric, condition: form.condition,
          threshold: Number(form.threshold),
          windowMinutes: Number(form.windowMinutes),
          cooldownMinutes: Number(form.cooldownMinutes),
          channels,
        }),
      });
      setShowForm(false);
      setForm({ name: "", metric: "answer_rate", condition: "below", threshold: "80", windowMinutes: "5", cooldownMinutes: "30", slackWebhook: "", webhookUrl: "", emailTo: "" });
      toast({ title: "Rule created" });
      load();
    } catch (err: any) {
      toast({ title: "Create failed", description: err.message, variant: "destructive" });
    }
  };

  const cardStyle: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 14px" };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" };
  const inputStyle: React.CSSProperties = { width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "7px 10px", fontSize: 12, color: "#fff", outline: "none" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>Alert Rules</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "2px 0 0" }}>Threshold-based alerts delivered to Slack, webhook, or email</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => load()} style={{ padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)" }}>
            <RefreshCw style={{ width: 11, height: 11, display: "inline", marginRight: 5 }} />Refresh
          </button>
          <button onClick={() => setShowForm(true)} style={{ padding: "7px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", background: "#1a8cff", color: "#fff" }}>
            + New Rule
          </button>
        </div>
      </div>

      {showForm && (
        <div style={{ ...cardStyle, borderColor: "rgba(26,140,255,0.3)" }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#fff", margin: "0 0 14px" }}>Create Alert Rule</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><p style={labelStyle}>Name</p><input style={inputStyle} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Low answer rate" /></div>
            <div><p style={labelStyle}>Metric</p>
              <select style={{ ...inputStyle }} value={form.metric} onChange={(e) => setForm((p) => ({ ...p, metric: e.target.value }))}>
                {Object.entries(METRIC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><p style={labelStyle}>Condition</p>
              <select style={{ ...inputStyle }} value={form.condition} onChange={(e) => setForm((p) => ({ ...p, condition: e.target.value }))}>
                <option value="below">Below threshold</option>
                <option value="above">Above threshold</option>
              </select>
            </div>
            <div><p style={labelStyle}>Threshold</p><input style={inputStyle} type="number" value={form.threshold} onChange={(e) => setForm((p) => ({ ...p, threshold: e.target.value }))} /></div>
            <div><p style={labelStyle}>Window (min)</p><input style={inputStyle} type="number" value={form.windowMinutes} onChange={(e) => setForm((p) => ({ ...p, windowMinutes: e.target.value }))} /></div>
            <div><p style={labelStyle}>Cooldown (min)</p><input style={inputStyle} type="number" value={form.cooldownMinutes} onChange={(e) => setForm((p) => ({ ...p, cooldownMinutes: e.target.value }))} /></div>
          </div>
          <p style={{ ...labelStyle, margin: "14px 0 8px" }}>Delivery Channels</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input style={inputStyle} value={form.slackWebhook} onChange={(e) => setForm((p) => ({ ...p, slackWebhook: e.target.value }))} placeholder="Slack Webhook URL (optional)" />
            <input style={inputStyle} value={form.webhookUrl} onChange={(e) => setForm((p) => ({ ...p, webhookUrl: e.target.value }))} placeholder="Generic Webhook URL (optional)" />
            <input style={inputStyle} value={form.emailTo} onChange={(e) => setForm((p) => ({ ...p, emailTo: e.target.value }))} placeholder="Email address (optional)" />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={createRule} style={{ padding: "8px 20px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", background: "#1a8cff", color: "#fff" }}>Create</button>
            <button onClick={() => setShowForm(false)} style={{ padding: "8px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}>Cancel</button>
          </div>
        </div>
      )}

      {loading && rules.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1,2,3].map((i) => <div key={i} style={{ height: 72, borderRadius: 12, background: "rgba(255,255,255,0.04)", animation: "pulse 2s infinite" }} />)}
        </div>
      )}

      {rules.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rules.map((rule) => (
            <div key={rule._id} style={{ ...cardStyle, opacity: rule.enabled ? 1 : 0.55 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={() => toggle(rule)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: rule.enabled ? "#30d158" : "rgba(255,255,255,0.25)", flexShrink: 0 }}>
                  {rule.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{rule.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{METRIC_LABELS[rule.metric] ?? rule.metric}</span>
                    <span style={{ fontSize: 11, color: rule.condition === "below" ? "#ff9f0a" : "#ff453a", fontWeight: 600 }}>
                      {rule.condition} {rule.threshold}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 3, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>window: {rule.windowMinutes}m</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>cooldown: {rule.cooldownMinutes}m</span>
                    {rule.channels.slackWebhook && <span style={{ fontSize: 10, color: "#a78bfa" }}>slack</span>}
                    {rule.channels.webhookUrl && <span style={{ fontSize: 10, color: "#60a5fa" }}>webhook</span>}
                    {rule.channels.emailTo && <span style={{ fontSize: 10, color: "#34d399" }}>email</span>}
                    {rule.lastFiredAt && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>last fired {formatDistanceToNow(new Date(rule.lastFiredAt), { addSuffix: true })}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => testRule(rule._id)} style={{ padding: "5px 10px", borderRadius: 14, fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}>Test</button>
                  <button onClick={() => deleteRule(rule._id)} style={{ padding: "5px 10px", borderRadius: 14, fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", background: "rgba(248,113,113,0.1)", color: "#f87171" }}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {rules.length === 0 && !loading && (
        <div style={{ textAlign: "center", padding: "30px 0", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>No alert rules configured. Create one to get notified when metrics breach thresholds.</div>
      )}

      {events.length > 0 && (
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.7)", margin: "0 0 10px" }}>Recent Fired Alerts</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {events.map((ev) => (
              <div key={ev._id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(255,69,58,0.06)", border: "1px solid rgba(255,69,58,0.15)" }}>
                <AlertTriangle size={13} style={{ color: "#ff453a", flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#fff", margin: 0 }}>{ev.ruleName}</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", margin: "2px 0 0" }}>{ev.message}</p>
                  <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                    {ev.channels.map((ch) => <span key={ch} style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{ch}</span>)}
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{formatDistanceToNow(new Date(ev.firedAt), { addSuffix: true })}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── IP Blocks Tab ─────────────────────────────────────────────────────────────

interface BlockEntry {
  ip: string;
  reason: string;
  blockedAt: number;
  expiresAt: number | null;
  auto: boolean;
}

function IpBlocksTab() {
  const { toast } = useToast();
  const [blocks, setBlocks] = useState<BlockEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ip: "", reason: "", durationMinutes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminFetch("/admin/ip-blocks");
      setBlocks(data.blocks ?? []);
    } catch (err: any) {
      toast({ title: "Failed to load blocks", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const unblock = async (ip: string) => {
    try {
      await adminFetch(`/admin/ip-blocks/${encodeURIComponent(ip)}`, { method: "DELETE" });
      setBlocks((prev) => prev.filter((b) => b.ip !== ip));
      toast({ title: `${ip} unblocked` });
    } catch (err: any) {
      toast({ title: "Unblock failed", description: err.message, variant: "destructive" });
    }
  };

  const addBlock = async () => {
    try {
      await adminFetch("/admin/ip-blocks", {
        method: "POST",
        body: JSON.stringify({
          ip: form.ip,
          reason: form.reason,
          durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : undefined,
        }),
      });
      setShowForm(false);
      setForm({ ip: "", reason: "", durationMinutes: "" });
      toast({ title: `${form.ip} blocked` });
      load();
    } catch (err: any) {
      toast({ title: "Block failed", description: err.message, variant: "destructive" });
    }
  };

  const cardStyle: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 14px" };
  const inputStyle: React.CSSProperties = { width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "7px 10px", fontSize: 12, color: "#fff", outline: "none" };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 4px" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: 0 }}>IP Block List</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "2px 0 0" }}>Auto-blocked IPs (SIP/login flood) and manual blocks</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)" }}>
            <RefreshCw style={{ width: 11, height: 11, display: "inline", marginRight: 5 }} />Refresh
          </button>
          <button onClick={() => setShowForm(true)} style={{ padding: "7px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", background: "#ff453a", color: "#fff" }}>
            + Block IP
          </button>
        </div>
      </div>

      {showForm && (
        <div style={{ ...cardStyle, borderColor: "rgba(255,69,58,0.3)" }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#fff", margin: "0 0 12px" }}>Block an IP</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div><p style={labelStyle}>IP Address</p><input style={inputStyle} value={form.ip} onChange={(e) => setForm((p) => ({ ...p, ip: e.target.value }))} placeholder="1.2.3.4" /></div>
            <div><p style={labelStyle}>Reason</p><input style={inputStyle} value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} placeholder="Reason" /></div>
            <div><p style={labelStyle}>Duration (min, blank = permanent)</p><input style={inputStyle} type="number" value={form.durationMinutes} onChange={(e) => setForm((p) => ({ ...p, durationMinutes: e.target.value }))} placeholder="blank = permanent" /></div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={addBlock} style={{ padding: "8px 20px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", background: "#ff453a", color: "#fff" }}>Block</button>
            <button onClick={() => setShowForm(false)} style={{ padding: "8px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}>Cancel</button>
          </div>
        </div>
      )}

      {loading && blocks.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1,2,3].map((i) => <div key={i} style={{ height: 60, borderRadius: 12, background: "rgba(255,255,255,0.04)", animation: "pulse 2s infinite" }} />)}
        </div>
      )}

      {blocks.length === 0 && !loading && (
        <div style={{ textAlign: "center", padding: "30px 0", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
          <ShieldCheck style={{ width: 28, height: 28, margin: "0 auto 8px", display: "block", opacity: 0.3 }} />
          No blocked IPs. Automatic blocks appear here when flood thresholds are exceeded.
        </div>
      )}

      {blocks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {blocks.map((b) => {
            const isExpiring = b.expiresAt !== null;
            const expiresIn  = isExpiring ? Math.max(0, Math.round((b.expiresAt! - Date.now()) / 60_000)) : null;
            return (
              <div key={b.ip} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: b.auto ? "#ff9f0a" : "#ff453a", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <code style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "monospace" }}>{b.ip}</code>
                    {b.auto && <span style={{ fontSize: 10, fontWeight: 700, color: "#ff9f0a", background: "rgba(255,159,10,0.1)", padding: "1px 6px", borderRadius: 8 }}>auto</span>}
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{b.reason}</span>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>blocked {formatDistanceToNow(new Date(b.blockedAt), { addSuffix: true })}</span>
                    {isExpiring && expiresIn !== null && (
                      <span style={{ fontSize: 10, color: expiresIn < 5 ? "#ff9f0a" : "rgba(255,255,255,0.25)" }}>
                        expires in {expiresIn}m
                      </span>
                    )}
                    {!isExpiring && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>permanent</span>}
                  </div>
                </div>
                <button onClick={() => unblock(b.ip)} style={{ padding: "5px 12px", borderRadius: 14, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", background: "rgba(52,211,153,0.1)", color: "#34d399", flexShrink: 0 }}>
                  Unblock
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// T009: Tenants Tab — per-tenant overview and isolation controls
// ─────────────────────────────────────────────────────────────────────────────

interface TenantSummary {
  tenantId: string;
  memberCount: number;
  createdAt: string;
  members: { id: string; email?: string; name?: string; isAdmin: boolean; role: string; locked: boolean }[];
}

function TenantsTab() {
  const [tenants, setTenants]   = React.useState<TenantSummary[]>([]);
  const [loading, setLoading]   = React.useState(true);
  const [error,   setError]     = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminFetch("/admin/tenants");
      setTenants(data.tenants ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Tenant Isolation</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Users grouped by tenantId. Personal accounts have no tenant.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading tenants…
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 gap-4">
          {tenants.map((t) => (
            <div
              key={t.tenantId}
              className={`border rounded-xl p-4 cursor-pointer transition-colors ${
                selected === t.tenantId ? "border-blue-500 bg-blue-50" : "hover:bg-gray-50"
              }`}
              onClick={() => setSelected(selected === t.tenantId ? null : t.tenantId)}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-100">
                    <Building2 className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      {t.tenantId === "__personal__"
                        ? "Personal accounts (no tenant)"
                        : t.tenantId}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t.memberCount} member{t.memberCount !== 1 ? "s" : ""} · since{" "}
                      {new Date(t.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform ${
                    selected === t.tenantId ? "rotate-180" : ""
                  }`}
                />
              </div>

              {selected === t.tenantId && (
                <div className="mt-4 border-t pt-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Members
                  </p>
                  {t.members.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between text-sm px-2 py-1.5 rounded-lg bg-white border"
                    >
                      <div>
                        <span className="font-medium">{m.name ?? m.email ?? m.id}</span>
                        {m.email && m.name && (
                          <span className="text-gray-400 ml-1.5 text-xs">({m.email})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {m.isAdmin && (
                          <span className="px-1.5 py-0.5 text-xs rounded bg-purple-100 text-purple-700">
                            admin
                          </span>
                        )}
                        {m.locked && (
                          <span className="px-1.5 py-0.5 text-xs rounded bg-red-100 text-red-700">
                            locked
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600">
                          {m.role}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {tenants.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No tenant data found</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── IVR & Queues Tab (Phase 2) ───────────────────────────────────────────────

type IvrSection = "flows" | "queues";

function IvrQueuesTab() {
  const [section, setSection] = useState<IvrSection>("flows");
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Network className="w-6 h-6 text-indigo-400" />
        <h2 className="text-xl font-bold text-white">IVR & Call Queues</h2>
      </div>
      <div className="flex gap-2">
        {(["flows","queues"] as IvrSection[]).map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              section === s
                ? "bg-indigo-600 text-white"
                : "bg-white/5 text-gray-400 hover:bg-white/10"
            }`}
          >
            {s === "flows" ? "IVR Flows" : "Call Queues"}
          </button>
        ))}
      </div>
      {section === "flows" ? <IvrFlowsPanel /> : <CallQueuesPanel />}
    </div>
  );
}

interface IvrFlow {
  id: string;
  name: string;
  extension: number;
  description?: string;
  active: boolean;
  startNode: string;
  nodes: unknown[];
  tenantId?: string;
}

function IvrFlowsPanel() {
  const [flows, setFlows] = useState<IvrFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", extension: "", description: "", startNode: "main", active: true });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await adminFetch("/ivr/flows");
      const d = await r.json();
      setFlows(d.flows ?? []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true); setErr("");
    try {
      const r = await adminFetch("/ivr/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, extension: Number(form.extension) }),
      });
      if (!r.ok) { const d: { error?: string } = await r.json(); setErr(d.error ?? "Failed"); return; }
      setShowForm(false);
      setForm({ name: "", extension: "", description: "", startNode: "main", active: true });
      await load();
    } finally { setSaving(false); }
  }

  async function del(id: string) {
    if (!confirm("Delete this IVR flow?")) return;
    await adminFetch(`/ivr/flows/${id}`, { method: "DELETE" });
    await load();
  }

  async function push(id: string) {
    const r = await adminFetch(`/ivr/flows/${id}/push`, { method: "POST" });
    const d: { message?: string; error?: string } = await r.json();
    alert(d.message ?? d.error ?? "Done");
  }

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors">
          <GitBranch className="w-4 h-4" /> New IVR Flow
        </button>
      </div>

      {showForm && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">New IVR Flow</h3>
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="Main Menu" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Extension / DID</label>
              <input value={form.extension} onChange={e => setForm(f => ({ ...f, extension: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. 7000" type="number" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-400 mb-1 block">Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="Optional description" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg disabled:opacity-50 transition-colors">
              {saving ? "Creating…" : "Create"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 text-sm rounded-lg transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {flows.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Network className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No IVR flows configured yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {flows.map(f => (
            <div key={f.id} className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${f.active ? "bg-green-400" : "bg-gray-600"}`} />
                <div>
                  <p className="text-sm font-medium text-white">{f.name}</p>
                  <p className="text-xs text-gray-500">Ext {f.extension} · {f.nodes?.length ?? 0} nodes{f.description ? ` · ${f.description}` : ""}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => push(f.id)} className="text-xs px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors">Push to FS</button>
                <button onClick={() => del(f.id)} className="text-xs px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface CallQueue {
  id: string;
  name: string;
  extension: number;
  strategy: string;
  active: boolean;
  agents: { userId: string; extension: number; paused: boolean; penalty: number }[];
  liveDepth?: number;
  liveStats?: { answered: number; abandoned: number; avgWaitSec: number } | null;
}

function CallQueuesPanel() {
  const [queues, setQueues] = useState<CallQueue[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", extension: "", strategy: "round-robin", maxWaitSec: "120", maxQueueDepth: "20" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await adminFetch("/queues");
      const d = await r.json();
      setQueues(d.queues ?? []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true); setErr("");
    try {
      const r = await adminFetch("/queues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, extension: Number(form.extension), maxWaitSec: Number(form.maxWaitSec), maxQueueDepth: Number(form.maxQueueDepth) }),
      });
      if (!r.ok) { const d: { error?: string } = await r.json(); setErr(d.error ?? "Failed"); return; }
      setShowForm(false);
      setForm({ name: "", extension: "", strategy: "round-robin", maxWaitSec: "120", maxQueueDepth: "20" });
      await load();
    } finally { setSaving(false); }
  }

  async function del(id: string) {
    if (!confirm("Delete this queue?")) return;
    await adminFetch(`/queues/${id}`, { method: "DELETE" });
    await load();
  }

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;

  const strategies = ["round-robin","least-recent","fewest-calls","random","linear","ringall"];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors">
          <List className="w-4 h-4" /> New Queue
        </button>
      </div>

      {showForm && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">New Call Queue</h3>
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Queue Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="Support Queue" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Extension</label>
              <input value={form.extension} onChange={e => setForm(f => ({ ...f, extension: e.target.value }))} type="number" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" placeholder="8000" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Strategy</label>
              <select value={form.strategy} onChange={e => setForm(f => ({ ...f, strategy: e.target.value }))} className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                {strategies.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Max Wait (secs)</label>
              <input value={form.maxWaitSec} onChange={e => setForm(f => ({ ...f, maxWaitSec: e.target.value }))} type="number" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg disabled:opacity-50 transition-colors">
              {saving ? "Creating…" : "Create"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 text-sm rounded-lg transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {queues.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <List className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No call queues configured yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {queues.map(q => (
            <div key={q.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${q.active ? "bg-green-400" : "bg-gray-600"}`} />
                  <div>
                    <p className="text-sm font-medium text-white">{q.name}</p>
                    <p className="text-xs text-gray-500">Ext {q.extension} · {q.strategy} · {q.agents?.length ?? 0} agents</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {q.liveStats && (
                    <div className="flex gap-4 text-xs">
                      <span className="text-green-400">{q.liveStats.answered} ans</span>
                      <span className="text-red-400">{q.liveStats.abandoned} abn</span>
                      <span className="text-blue-400">{q.liveStats.avgWaitSec?.toFixed(0)}s avg wait</span>
                    </div>
                  )}
                  {q.liveDepth !== undefined && q.liveDepth > 0 && (
                    <span className="text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full">{q.liveDepth} waiting</span>
                  )}
                  <button onClick={() => del(q.id)} className="text-xs px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Security Tab (Phase 4) ────────────────────────────────────────────────────

interface SecurityOverview {
  totalUsers: number;
  twoFaEnabledCount: number;
  twoFaAdoptionPct: number;
  lockedAccounts: number;
  pendingVerification: number;
}

function SecurityTab() {
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetUserId, setResetUserId] = useState("");
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setLoading(true);
    adminFetch("/security/overview")
      .then((r: Response) => r.json())
      .then((d: SecurityOverview) => setOverview(d))
      .finally(() => setLoading(false));
  }, []);

  async function resetTotp() {
    if (!resetUserId.trim()) { setMsg("Enter a user ID first"); return; }
    if (!confirm(`Force-disable 2FA for user ${resetUserId}?`)) return;
    setResetting(true); setMsg("");
    try {
      const r = await adminFetch(`/security/2fa/admin-reset/${resetUserId.trim()}`, { method: "DELETE" });
      const d: { error?: string } = await r.json();
      setMsg(r.ok ? "2FA reset successfully." : d.error ?? "Failed");
      if (r.ok) setResetUserId("");
    } finally { setResetting(false); }
  }

  if (loading) return <div className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-400" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-6 h-6 text-green-400" />
        <h2 className="text-xl font-bold text-white">Security & Compliance</h2>
      </div>

      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Users",       value: overview.totalUsers,          icon: Users,         color: "text-blue-400"  },
            { label: "2FA Enabled",       value: overview.twoFaEnabledCount,   icon: ShieldCheck,   color: "text-green-400" },
            { label: "2FA Adoption",      value: `${overview.twoFaAdoptionPct}%`, icon: ShieldCheckIcon, color: "text-emerald-400" },
            { label: "Locked Accounts",   value: overview.lockedAccounts,      icon: ShieldQuestion, color: "text-red-400"   },
          ].map(stat => (
            <div key={stat.label} className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-3">
              <stat.icon className={`w-8 h-8 ${stat.color}`} />
              <div>
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-gray-400">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-green-400" />Admin: Reset User 2FA</h3>
          <p className="text-xs text-gray-400">Force-disable TOTP 2FA for a user (e.g. lost authenticator). Use their User ID.</p>
          {msg && <p className={`text-sm ${msg.includes("success") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
          <div className="flex gap-2">
            <input
              value={resetUserId}
              onChange={e => setResetUserId(e.target.value)}
              placeholder="User ID (UUID)"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
            <button
              onClick={resetTotp}
              disabled={resetting}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg disabled:opacity-50 transition-colors"
            >
              {resetting ? "Resetting…" : "Reset 2FA"}
            </button>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><FileText className="w-4 h-4 text-blue-400" />POPIA Compliance</h3>
          <p className="text-xs text-gray-400">PRaww+ is designed for POPIA compliance (Protection of Personal Information Act, South Africa).</p>
          <ul className="space-y-2 text-xs text-gray-300">
            {[
              "Users can request full data export from their Profile page",
              "Admin can verify 2FA status per user",
              "Audit log tracks all admin actions",
              "Session expiry enforced platform-wide",
              "IP block list for threat mitigation",
            ].map(item => (
              <li key={item} className="flex items-start gap-2">
                <Check className="w-3 h-3 text-green-400 mt-0.5 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><ShieldQuestion className="w-4 h-4 text-yellow-400" />Security Recommendations</h3>
        {overview && overview.twoFaAdoptionPct < 80 && (
          <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
            <p className="text-xs text-yellow-300">Only {overview.twoFaAdoptionPct}% of users have 2FA enabled. Consider enforcing 2FA for admin accounts.</p>
          </div>
        )}
        {overview && overview.lockedAccounts > 0 && (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-300">{overview.lockedAccounts} account{overview.lockedAccounts !== 1 ? "s are" : " is"} currently locked. Review in the Users tab.</p>
          </div>
        )}
        {overview && overview.twoFaAdoptionPct >= 80 && overview.lockedAccounts === 0 && (
          <div className="flex items-start gap-3 bg-green-500/10 border border-green-500/20 rounded-lg p-3">
            <Check className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
            <p className="text-xs text-green-300">Security posture looks good. 2FA adoption is above 80% and no locked accounts.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Analytics Tab (Phase 8) ──────────────────────────────────────────────────

interface AnalyticsSummary {
  totalCalls: number;
  completedCalls: number;
  missedCalls: number;
  failedCalls: number;
  totalBillsec: number;
  avgBillsec: number;
  totalCoins: number;
  answerRate: number;
  inboundCalls: number;
  outboundCalls: number;
  from: number;
  to: number;
}

interface DailyBucket {
  date: string;
  totalCalls: number;
  completedCalls: number;
  missedCalls: number;
  totalBillsec: number;
  totalCoins: number;
  answerRate: number;
}

interface TopCaller {
  userId: string;
  totalCalls: number;
  totalBillsec: number;
  totalCoins: number;
}

interface DestStat {
  destination: string;
  count: number;
  totalBillsec: number;
  completedCalls: number;
}

interface AnalyticsAll {
  summary: AnalyticsSummary;
  daily: DailyBucket[];
  topCallers: TopCaller[];
  destinations: DestStat[];
}

function fmtSecs(s: number): string {
  if (s < 60)  return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-ZA", { month: "short", day: "numeric" });
}

function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsAll | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [section, setSection] = useState<"overview" | "daily" | "callers" | "destinations">("overview");

  async function load(d: number) {
    setLoading(true);
    try {
      const r = await adminFetch(`/analytics/all?days=${d}`);
      const res: AnalyticsAll = await r.json();
      setData(res);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(days); }, [days]);

  const sections: { id: typeof section; label: string }[] = [
    { id: "overview",     label: "Summary"     },
    { id: "daily",        label: "Daily Trend" },
    { id: "callers",      label: "Top Callers" },
    { id: "destinations", label: "Destinations"},
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LineChart className="w-6 h-6 text-purple-400" />
          <h2 className="text-xl font-bold text-white">Analytics & QoS</h2>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                days === d ? "bg-purple-600 text-white" : "bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${
              section === s.id ? "bg-purple-600 text-white" : "bg-white/5 text-gray-400 hover:bg-white/10"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-8 h-8 animate-spin mx-auto text-purple-400" /></div>
      ) : !data ? (
        <div className="text-center py-12 text-gray-500 text-sm">Failed to load analytics</div>
      ) : (
        <>
          {section === "overview" && <AnalyticsSummaryPanel summary={data.summary} />}
          {section === "daily"    && <DailyTrendPanel daily={data.daily} />}
          {section === "callers"  && <TopCallersPanel callers={data.topCallers} />}
          {section === "destinations" && <DestinationsPanel destinations={data.destinations} />}
        </>
      )}
    </div>
  );
}

function AnalyticsSummaryPanel({ summary }: { summary: AnalyticsSummary }) {
  const cards = [
    { label: "Total Calls",      value: summary.totalCalls,                  icon: Phone,      color: "text-blue-400"   },
    { label: "Completed",        value: summary.completedCalls,               icon: Check,      color: "text-green-400"  },
    { label: "Missed",           value: summary.missedCalls,                  icon: PhoneOff,   color: "text-red-400"    },
    { label: "Answer Rate",      value: `${summary.answerRate?.toFixed(1)}%`, icon: BarChart2,  color: "text-emerald-400" },
    { label: "Total Talk Time",  value: fmtSecs(summary.totalBillsec),        icon: Clock,      color: "text-purple-400" },
    { label: "Avg Call Duration",value: fmtSecs(summary.avgBillsec),          icon: TrendingUp, color: "text-yellow-400" },
    { label: "Coins Used",       value: summary.totalCoins?.toFixed(2),       icon: BadgeDollarSign, color: "text-orange-400" },
    { label: "Inbound / Out",    value: `${summary.inboundCalls} / ${summary.outboundCalls}`, icon: PhoneForwarded, color: "text-cyan-400" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-3">
          <c.icon className={`w-8 h-8 ${c.color} shrink-0`} />
          <div>
            <p className="text-xl font-bold text-white">{c.value}</p>
            <p className="text-xs text-gray-400">{c.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function DailyTrendPanel({ daily }: { daily: DailyBucket[] }) {
  if (!daily?.length) return <div className="text-center py-12 text-gray-500 text-sm">No daily data available</div>;

  const max = Math.max(...daily.map(d => d.totalCalls), 1);

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">Total calls per day (bar height = relative volume)</p>
      <div className="flex items-end gap-1 h-32">
        {daily.map(d => (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div
              className="w-full bg-purple-500/60 hover:bg-purple-500 rounded-t transition-colors"
              style={{ height: `${Math.max(4, (d.totalCalls / max) * 100)}%` }}
              title={`${d.date}: ${d.totalCalls} calls, ${d.answerRate?.toFixed(0)}% ans`}
            />
            <span className="text-[9px] text-gray-600 rotate-45 origin-left whitespace-nowrap absolute -bottom-4">{fmtDate(d.date)}</span>
          </div>
        ))}
      </div>
      <div className="mt-8 overflow-auto">
        <table className="w-full text-xs text-gray-300 border-collapse">
          <thead>
            <tr className="border-b border-white/10">
              {["Date","Total","Completed","Missed","Talk Time","Coins","Ans%"].map(h => (
                <th key={h} className="text-left py-2 px-2 text-gray-400 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...daily].reverse().map(d => (
              <tr key={d.date} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-1.5 px-2">{fmtDate(d.date)}</td>
                <td className="py-1.5 px-2 font-medium">{d.totalCalls}</td>
                <td className="py-1.5 px-2 text-green-400">{d.completedCalls}</td>
                <td className="py-1.5 px-2 text-red-400">{d.missedCalls}</td>
                <td className="py-1.5 px-2">{fmtSecs(d.totalBillsec)}</td>
                <td className="py-1.5 px-2 text-yellow-400">{d.totalCoins?.toFixed(2)}</td>
                <td className="py-1.5 px-2">{d.answerRate?.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopCallersPanel({ callers }: { callers: TopCaller[] }) {
  if (!callers?.length) return <div className="text-center py-12 text-gray-500 text-sm">No caller data available</div>;
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs text-gray-300 border-collapse">
        <thead>
          <tr className="border-b border-white/10">
            {["#","User ID","Total Calls","Talk Time","Coins Used"].map(h => (
              <th key={h} className="text-left py-2 px-3 text-gray-400 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {callers.map((c, i) => (
            <tr key={c.userId} className="border-b border-white/5 hover:bg-white/5">
              <td className="py-2 px-3 font-bold text-gray-500">{i + 1}</td>
              <td className="py-2 px-3 font-mono text-purple-300 max-w-[160px] truncate">{c.userId}</td>
              <td className="py-2 px-3 font-semibold">{c.totalCalls}</td>
              <td className="py-2 px-3">{fmtSecs(c.totalBillsec)}</td>
              <td className="py-2 px-3 text-yellow-400">{c.totalCoins?.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DestinationsPanel({ destinations }: { destinations: DestStat[] }) {
  if (!destinations?.length) return <div className="text-center py-12 text-gray-500 text-sm">No destination data available</div>;
  const max = Math.max(...destinations.map(d => d.count), 1);
  return (
    <div className="space-y-2">
      {destinations.map(d => (
        <div key={d.destination} className="bg-white/5 border border-white/10 rounded-lg p-3 flex items-center gap-4">
          <Phone className="w-4 h-4 text-gray-500 shrink-0" />
          <span className="font-mono text-sm text-white w-36 shrink-0">{d.destination || "(unknown)"}</span>
          <div className="flex-1 bg-white/5 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full"
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-300 w-16 text-right">{d.count} calls</span>
          <span className="text-xs text-gray-500 w-20 text-right">{fmtSecs(d.totalBillsec)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Commissions Tab (Phase 7) ────────────────────────────────────────────────

interface Commission {
  id: string;
  resellerId: string;
  type: string;
  amountCents: number;
  status: "pending" | "approved" | "paid" | "cancelled";
  description?: string;
  referenceId?: string;
  createdAt: string;
}

interface CommissionSummary {
  pendingCents: number;
  approvedCents: number;
  paidCents: number;
  lifetimeCents: number;
  pendingCount: number;
  approvedCount: number;
}

function CommissionsTab() {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [summary, setSummary] = useState<CommissionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [resellerIdFilter, setResellerIdFilter] = useState("");
  const [approveId, setApproveId] = useState("");
  const [approving, setApproving] = useState(false);
  const [msg, setMsg] = useState("");

  async function load(rid?: string) {
    setLoading(true);
    try {
      const qs = rid ? `?resellerId=${rid}` : "";
      const d: { commissions?: Commission[]; summary?: CommissionSummary } =
        await adminFetch(`/reseller/commissions${qs}`);
      setCommissions(d.commissions ?? []);
      setSummary(d.summary ?? null);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function approve() {
    if (!approveId.trim()) { setMsg("Enter a reseller ID"); return; }
    setApproving(true); setMsg("");
    try {
      const d: { approved?: number } = await adminFetch("/reseller/commissions/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resellerId: approveId.trim() }),
      });
      setMsg(`Approved ${d.approved ?? 0} commission(s).`);
      await load(approveId.trim());
    } catch (e: any) {
      setMsg(e.message ?? "Failed");
    } finally { setApproving(false); }
  }

  const formatRand = (cents: number) => `R${(cents / 100).toFixed(2)}`;
  const statusColor: Record<string, string> = {
    pending:   "text-yellow-400 bg-yellow-400/10",
    approved:  "text-blue-400 bg-blue-400/10",
    paid:      "text-green-400 bg-green-400/10",
    cancelled: "text-gray-500 bg-gray-500/10",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <TrendingUp className="w-6 h-6 text-orange-400" />
        <h2 className="text-xl font-bold text-white">Reseller Commissions</h2>
      </div>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Pending",   value: formatRand(summary.pendingCents),   color: "text-yellow-400", note: `${summary.pendingCount} items`  },
            { label: "Approved",  value: formatRand(summary.approvedCents),  color: "text-blue-400",   note: `${summary.approvedCount} items` },
            { label: "Paid Out",  value: formatRand(summary.paidCents),      color: "text-green-400",  note: ""                               },
            { label: "Lifetime",  value: formatRand(summary.lifetimeCents),  color: "text-orange-400", note: ""                               },
          ].map(s => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-400 mt-1">{s.label}{s.note ? ` · ${s.note}` : ""}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3 flex-wrap items-end">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Filter by Reseller ID</label>
          <input
            value={resellerIdFilter}
            onChange={e => setResellerIdFilter(e.target.value)}
            placeholder="Reseller user ID"
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white w-64"
          />
        </div>
        <button
          onClick={() => load(resellerIdFilter || undefined)}
          className="px-4 py-2 bg-orange-600/80 hover:bg-orange-600 text-white text-sm rounded-lg transition-colors"
        >
          Filter
        </button>
        <button
          onClick={() => { setResellerIdFilter(""); load(); }}
          className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 text-sm rounded-lg transition-colors"
        >
          Clear
        </button>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white">Approve Pending Commissions</h3>
        {msg && <p className={`text-sm ${msg.includes("Approved") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
        <div className="flex gap-2">
          <input
            value={approveId}
            onChange={e => setApproveId(e.target.value)}
            placeholder="Reseller User ID"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
          />
          <button
            onClick={approve}
            disabled={approving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg disabled:opacity-50 transition-colors"
          >
            {approving ? "Approving…" : "Approve All"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto text-orange-400" /></div>
      ) : commissions.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No commissions found</p>
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-xs text-gray-300 border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                {["Type","Amount","Status","Description","Reference","Date"].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-gray-400 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {commissions.map(c => (
                <tr key={c.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-2 px-3 font-medium capitalize">{c.type.replace(/_/g, " ")}</td>
                  <td className="py-2 px-3 text-orange-400 font-semibold">{formatRand(c.amountCents)}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColor[c.status] ?? ""}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-gray-400 max-w-[200px] truncate">{c.description ?? "—"}</td>
                  <td className="py-2 px-3 font-mono text-gray-500 max-w-[120px] truncate">{c.referenceId ?? "—"}</td>
                  <td className="py-2 px-3 text-gray-500">{new Date(c.createdAt).toLocaleDateString("en-ZA")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
