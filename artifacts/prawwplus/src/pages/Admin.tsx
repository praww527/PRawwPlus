import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/hooks/use-toast";
import { cn, formatCurrency } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Users, DollarSign, PhoneCall, ShieldAlert, Lock, Unlock, UserCheck,
  UserX, BarChart3, Link2, BadgeDollarSign, Receipt, CreditCard, RefreshCw,
  ChevronDown, Trash2, CheckCircle2, Shield, Settings, Megaphone,
  AlertTriangle, Flag, Clock, Edit2, ToggleLeft, ToggleRight, Smartphone,
  BadgeCheck, X, Eye, FileText, Check, Activity, ArrowRight, Phone, PhoneOff,
  Loader2, Bell, BellRing, Send, Users2, Wrench, Info, Server, Database,
  Wifi, WifiOff, Terminal, KeyRound, Globe2, ShieldCheck, ShieldOff,
} from "lucide-react";

const TABS = [
  { id: "overview",      label: "Overview",      icon: BarChart3   },
  { id: "users",         label: "Users",         icon: Users       },
  { id: "live",          label: "Live Calls",    icon: Activity    },
  { id: "system",        label: "System",        icon: Server      },
  { id: "push",          label: "Push",          icon: PhoneCall   },
  { id: "referrals",     label: "Referrals",     icon: Link2       },
  { id: "earnings",      label: "Earnings",      icon: BadgeDollarSign },
  { id: "expenses",      label: "Expenses",      icon: Receipt     },
  { id: "payouts",       label: "Payouts",       icon: CreditCard  },
  { id: "abuse",         label: "Calls & Abuse", icon: ShieldAlert },
  { id: "announcements", label: "Announcements", icon: Megaphone   },
] as const;

type TabId = typeof TABS[number]["id"];

async function adminFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
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
      <p style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: "#fff" }}>R{(payload[0].value as number).toFixed(2)}</p>
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
function OverviewTab() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch("/admin/stats").then(setStats).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white/[0.04] h-16 animate-pulse" />
      <div className="rounded-2xl bg-white/[0.04] h-52 animate-pulse" />
    </div>
  );
  if (!stats) return null;

  const topStats = [
    { label: "Users",    value: stats.totalUsers       },
    { label: "Calls",    value: stats.totalCalls        },
    { label: "Resellers",value: stats.totalResellers   },
    { label: "Pending",  value: stats.pendingApprovals },
    { label: "Locked",   value: stats.lockedUsers      },
    { label: "Subs",     value: stats.activeSubscriptions },
  ];

  const chartData = [
    { name: "Revenue",     v: stats.totalRevenue    ?? 0, color: "#818cf8" },
    { name: "Commissions", v: stats.totalCommissions ?? 0, color: "#f59e0b" },
    { name: "Expenses",    v: stats.totalExpenses   ?? 0, color: "#f87171" },
    { name: "Profit",      v: stats.profit          ?? 0, color: "#34d399" },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white/[0.04]" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
        {topStats.map((s, i) => (
          <div key={s.label} style={{ padding: "12px 8px", textAlign: "center", borderLeft: i % 3 !== 0 ? "1px solid rgba(255,255,255,0.07)" : "none", borderTop: i >= 3 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
            <p className="text-base font-bold text-white font-mono leading-none">{s.value ?? 0}</p>
            <p className="text-[10px] text-white/35 mt-1 uppercase tracking-wider leading-none">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white/[0.04] p-4 space-y-4">
        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-widest">Financial Overview</p>
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
            { label: "Total Revenue",        value: `R${(stats.totalRevenue ?? 0).toFixed(2)}` },
            { label: "Commissions Paid Out",  value: `– R${(stats.totalCommissions ?? 0).toFixed(2)}`, color: "#f59e0b" },
            { label: "Total Expenses",        value: `– R${(stats.totalExpenses ?? 0).toFixed(2)}`,   color: "#f87171" },
            { label: "Net Profit",            value: `R${(stats.profit ?? 0).toFixed(2)}`, color: (stats.profit ?? 0) >= 0 ? "#34d399" : "#f87171", bold: true },
          ].map((row) => (
            <div key={row.label} className="flex justify-between items-center">
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: (row as any).bold ? 600 : 400 }}>{row.label}</span>
              <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: (row as any).color ?? "rgba(255,255,255,0.85)" }}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>
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
  const [filter, setFilter] = useState<"all" | "pending_verify">("all");

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

  if (filter === "pending_verify") {
    filtered = filtered.filter((u) => u.verificationStatus === "pending");
  }

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
      <div className="flex gap-2">
        {(["all", "pending_verify"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: filter === f ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
              color: filter === f ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
              border: "none", transition: "all 0.15s",
            }}
          >
            {f === "all" ? "All Users" : `Verify Requests${pendingVerifyCount > 0 ? ` (${pendingVerifyCount})` : ""}`}
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

interface PushResult { recipients: number; sent: number; fcmOk: number; expoOk: number; skipped: number; errors: number; }

function PushTab() {
  const { toast } = useToast();
  const [msgType,  setMsgType]  = useState<string>("update");
  const [target,   setTarget]   = useState<string>("all");
  const [title,    setTitle]    = useState("");
  const [body,     setBody]     = useState("");
  const [sending,  setSending]  = useState(false);
  const [result,   setResult]   = useState<PushResult | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  // Auto-fill presets when type changes
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
    if (!title.trim() || !body.trim()) {
      setError("Title and message are required.");
      return;
    }
    setSending(true);
    setResult(null);
    setError(null);
    try {
      const data = await adminFetch("/admin/push", {
        method: "POST",
        body: JSON.stringify({ target, type: msgType, title: title.trim(), body: body.trim() }),
      });
      setResult(data);
      toast({ title: "Push sent", description: `Delivered to ${data.sent} / ${data.recipients} device(s).` });
    } catch (e: any) {
      setError(e.message ?? "Failed to send push");
    } finally {
      setSending(false);
    }
  };

  const activeType = PUSH_TYPES.find((t) => t.value === msgType)!;
  const TypeIcon   = activeType.icon;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 560 }}>

      {/* ── Section: Message type ── */}
      <div>
        <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Message type</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {PUSH_TYPES.map(({ value, label, icon: Icon, color, preset }) => {
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
            <span style={{ fontSize: 13, fontWeight: 700, color: "#30d158" }}>Push sent successfully</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            {[
              { label: "Recipients", value: result.recipients },
              { label: "Delivered",  value: result.sent },
              { label: "FCM",        value: result.fcmOk  },
              { label: "Expo",       value: result.expoOk },
              { label: "Skipped",    value: result.skipped },
              { label: "Errors",     value: result.errors  },
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
              {result.skipped} user(s) skipped — no push token registered on their account.
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
        Push notifications are delivered to the PRaww+ mobile app only.
        Users without a registered device token are automatically skipped.
      </p>
    </div>
  );
}

// ─── Live Calls Tab ────────────────────────────────────────────────────────────

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
        const future  = currentIdx < i;
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

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminFetch("/admin/system-health");
      setHealth(data);
    } catch (e: any) {
      toast({ title: "Health check failed", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

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

          {/* Test SSH */}
          <div style={{ padding: "14px 16px" }}>
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
        </SysSection>

        {/* ── Production checklist ── */}
        <SysSection title="Production Checklist" icon={<CheckCircle2 style={{ width: 12, height: 12 }} />}>
          {[
            { label: "MongoDB URI set",             ok: health.envVars.find((v) => v.key === "MONGODB_URI")?.set ?? false },
            { label: "Database connected",          ok: health.db.connected },
            { label: "FreeSWITCH domain set",       ok: Boolean(health.config.domain) },
            { label: "SSH key set (config push)",   ok: health.envVars.find((v) => v.key === "FREESWITCH_SSH_KEY")?.set ?? false },
            { label: "ESL password set",            ok: health.envVars.find((v) => v.key === "FREESWITCH_ESL_PASSWORD")?.set ?? false },
            { label: "ESL connected",               ok: health.esl.connected },
            { label: "App URL set (HTTPS)",         ok: health.envVars.find((v) => v.key === "APP_URL")?.set ?? false },
            { label: "Session secret set",          ok: health.envVars.find((v) => v.key === "SESSION_SECRET")?.set ?? false },
            { label: "Webhook secret set",          ok: health.envVars.find((v) => v.key === "FREESWITCH_WEBHOOK_SECRET")?.set ?? false },
          ].map(({ label, ok }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              {ok
                ? <CheckCircle2 style={{ width: 14, height: 14, color: "#30d158", flexShrink: 0 }} />
                : <AlertTriangle style={{ width: 14, height: 14, color: "#ff453a", flexShrink: 0 }} />}
              <span style={{ fontSize: 12, color: ok ? "rgba(255,255,255,0.75)" : "#ff453a", fontWeight: ok ? 400 : 600 }}>{label}</span>
            </div>
          ))}
        </SysSection>

      </>)}
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
        {tab === "overview"      && <OverviewTab />}
        {tab === "users"         && <UsersTab />}
        {tab === "live"          && <LiveCallsTab />}
        {tab === "system"        && <SystemTab />}
        {tab === "push"          && <PushTab />}
        {tab === "referrals"     && <ReferralsTab />}
        {tab === "earnings"      && <EarningsTab />}
        {tab === "expenses"      && <ExpensesTab />}
        {tab === "payouts"       && <PayoutsTab />}
        {tab === "abuse"         && <CallsAbuseTab />}
        {tab === "announcements" && <AnnouncementsTab />}
      </div>
    </div>
  );
}
