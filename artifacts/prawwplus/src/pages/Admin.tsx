import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/hooks/use-toast";
import { cn, formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Users, DollarSign, PhoneCall, ShieldAlert, Lock, Unlock, UserCheck,
  UserX, BarChart3, Link2, BadgeDollarSign, Receipt, CreditCard, RefreshCw,
  ChevronDown, Trash2, CheckCircle2, Shield, Settings, Megaphone,
  AlertTriangle, Flag, Clock, Edit2, ToggleLeft, ToggleRight, Smartphone,
} from "lucide-react";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const PANEL = "rounded-lg border border-white/[0.12] bg-white/[0.025]";
const ROWS  = "divide-y divide-white/[0.08]";

const TABS = [
  { id: "overview",      label: "Overview",      icon: BarChart3   },
  { id: "users",         label: "Users",         icon: Users       },
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

// ─── Mini helpers ──────────────────────────────────────────────────────────────
function RolePill({ role }: { role: string }) {
  const c = role === "admin" ? "#f87171" : role === "reseller" ? "#a78bfa" : "rgba(255,255,255,0.3)";
  return <span style={{ fontSize: 10, fontWeight: 700, color: c, textTransform: "uppercase", letterSpacing: "0.05em" }}>{role}</span>;
}

function StatusPill({ approved, locked }: { approved: boolean; locked: boolean }) {
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

function ActionBtn({ color, disabled, onClick, children }: { color: "green" | "amber" | "red" | "muted"; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) {
  const styles: Record<string, React.CSSProperties> = {
    green: { color: "#34d399", borderColor: "rgba(52,211,153,0.3)" },
    amber: { color: "#f59e0b", borderColor: "rgba(245,158,11,0.3)" },
    red:   { color: "#f87171", borderColor: "rgba(248,113,113,0.3)" },
    muted: { color: "rgba(255,255,255,0.45)", borderColor: "rgba(255,255,255,0.1)" },
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 24, padding: "0 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
        border: "1px solid", display: "inline-flex", alignItems: "center", gap: 4,
        background: "transparent", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1, transition: "all 0.15s",
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
    <div className="space-y-4">
      <div className={`${PANEL} h-16 animate-pulse`} />
      <div className={`${PANEL} h-52 animate-pulse`} />
    </div>
  );
  if (!stats) return null;

  const topStats = [
    { label: "Users",    value: stats.totalUsers            },
    { label: "Calls",    value: stats.totalCalls            },
    { label: "Resellers",value: stats.totalResellers        },
    { label: "Pending",  value: stats.pendingApprovals      },
    { label: "Locked",   value: stats.lockedUsers           },
    { label: "Subs",     value: stats.activeSubscriptions   },
  ];

  const chartData = [
    { name: "Revenue",     v: stats.totalRevenue    ?? 0, color: "#818cf8" },
    { name: "Commissions", v: stats.totalCommissions ?? 0, color: "#f59e0b" },
    { name: "Expenses",    v: stats.totalExpenses   ?? 0, color: "#f87171" },
    { name: "Profit",      v: stats.profit          ?? 0, color: "#34d399" },
  ];

  return (
    <div className="space-y-3">
      {/* KPI strip */}
      <div className={`${PANEL} grid`} style={{ gridTemplateColumns: `repeat(${topStats.length}, 1fr)` }}>
        {topStats.map((s, i) => (
          <div key={s.label} className={cn("p-3 text-center", i > 0 && "border-l border-white/[0.08]")}>
            <p className="text-lg font-bold text-white font-mono leading-none">{s.value ?? 0}</p>
            <p className="text-[10px] text-white/35 mt-1 uppercase tracking-wider leading-none">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Financial chart + summary */}
      <div className={`${PANEL} p-4 space-y-4`}>
        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-widest">Financial Overview</p>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -22, bottom: 0 }} barSize={32}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "rgba(255,255,255,0.35)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `R${v}`} />
            <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <Bar dataKey="v" radius={[3, 3, 0, 0]}>
              {chartData.map((entry, i) => <Cell key={i} fill={entry.color} fillOpacity={0.82} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="space-y-2 border-t border-white/[0.07] pt-3">
          {[
            { label: "Total Revenue",        value: `R${(stats.totalRevenue ?? 0).toFixed(2)}`,       color: undefined     },
            { label: "Commissions Paid Out",  value: `– R${(stats.totalCommissions ?? 0).toFixed(2)}`, color: "#f59e0b"    },
            { label: "Total Expenses",        value: `– R${(stats.totalExpenses ?? 0).toFixed(2)}`,   color: "#f87171"    },
            { label: "Net Profit",            value: `R${(stats.profit ?? 0).toFixed(2)}`,            color: (stats.profit ?? 0) >= 0 ? "#34d399" : "#f87171", bold: true },
          ].map((row) => (
            <div key={row.label} className="flex justify-between items-center">
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: row.bold ? 600 : 400 }}>{row.label}</span>
              <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: row.color ?? "rgba(255,255,255,0.85)" }}>{row.value}</span>
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
  const [actionType, setActionType] = useState<"credit" | "role" | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [acting, setActing] = useState(false);
  const [search, setSearch] = useState("");

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

  const filtered = search
    ? users.filter((u) =>
        (u.name || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.username || "").toLowerCase().includes(search.toLowerCase()))
    : users;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Search users…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white/[0.03] border-white/[0.1] text-white placeholder:text-white/20 text-sm h-9"
        />
        <button
          onClick={load}
          className="w-9 h-9 rounded-lg border border-white/[0.1] flex items-center justify-center text-white/35 hover:text-white/70 hover:bg-white/[0.04] transition-all shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading ? <Skel /> : (
        <div className={`${PANEL} ${ROWS}`}>
          {filtered.length === 0 && (
            <p className="p-6 text-center text-white/25 text-sm">No users found</p>
          )}
          {filtered.map((u) => (
            <div key={u.id} className="p-3.5 space-y-2.5">
              <div className="flex items-start gap-3">
                <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>
                    {(u.name || u.username || "?").slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-sm font-semibold text-white">{u.name || u.username}</span>
                    <RolePill role={u.role ?? "user"} />
                    <StatusPill approved={u.approved ?? true} locked={u.locked ?? false} />
                    {u.phone && <PhonePill verified={u.phoneVerified} />}
                    {u.phoneOtpLockedUntil && new Date(u.phoneOtpLockedUntil) > new Date() && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#f59e0b" }}>otp-locked</span>
                    )}
                  </div>
                  <p className="text-xs text-white/35 mt-0.5 truncate">{u.email}</p>
                  {u.phone && <p className="text-[11px] text-white/20 font-mono">{u.phone}</p>}
                  {u.referralCode && <p className="text-[10px] text-white/20 font-mono">ref: {u.referralCode}</p>}
                </div>
                <p className="text-xs font-bold text-white font-mono shrink-0">{formatCurrency(u.coins || 0)}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {!(u.approved ?? true) && (
                  <ActionBtn color="green" disabled={acting} onClick={() => act(u.id, "approve")}><UserCheck className="w-2.5 h-2.5" />Approve</ActionBtn>
                )}
                {(u.approved ?? true) && !(u.locked ?? false) && (
                  <ActionBtn color="amber" disabled={acting} onClick={() => act(u.id, "reject")}><UserX className="w-2.5 h-2.5" />Revoke</ActionBtn>
                )}
                {!(u.locked ?? false) ? (
                  <ActionBtn color="red" disabled={acting} onClick={() => act(u.id, "lock")}><Lock className="w-2.5 h-2.5" />Lock</ActionBtn>
                ) : (
                  <ActionBtn color="green" disabled={acting} onClick={() => act(u.id, "unlock")}><Unlock className="w-2.5 h-2.5" />Unlock</ActionBtn>
                )}
                {u.phoneOtpLockedUntil && new Date(u.phoneOtpLockedUntil) > new Date() && (
                  <ActionBtn color="amber" disabled={acting} onClick={() => act(u.id, "unlock-otp")}><ShieldAlert className="w-2.5 h-2.5" />Clear OTP</ActionBtn>
                )}
                {u.phone && !u.phoneVerified && (
                  <ActionBtn color="green" disabled={acting} onClick={() => act(u.id, "verify-phone")}><Smartphone className="w-2.5 h-2.5" />Verify Phone</ActionBtn>
                )}
                <ActionBtn color="muted" disabled={acting} onClick={() => { setActionUser(u); setNewRole(u.role ?? "user"); setActionType("role"); }}><Settings className="w-2.5 h-2.5" />Role</ActionBtn>
                <ActionBtn color="muted" disabled={acting} onClick={() => { setActionUser(u); setCreditAmount(""); setActionType("credit"); }}><DollarSign className="w-2.5 h-2.5" />Credit</ActionBtn>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={actionType === "role" && !!actionUser} onClose={() => { setActionUser(null); setActionType(null); }} title="Set User Role" description={`Change role for ${actionUser?.name || actionUser?.username}`}>
        <div className="mt-4 space-y-3">
          {["user", "reseller", "admin"].map((r) => (
            <button key={r} onClick={() => setNewRole(r)} className={cn("w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left", newRole === r ? "border-white/20 bg-white/[0.06]" : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]")}>
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

      <Modal isOpen={actionType === "credit" && !!actionUser} onClose={() => { setActionUser(null); setActionType(null); }} title="Adjust Credit" description={`Modify balance for ${actionUser?.name || actionUser?.username}`}>
        <div className="mt-4 space-y-4">
          <div className={`p-3 ${PANEL} flex justify-between`}>
            <span className="text-sm text-white/50">Current Balance</span>
            <span className="font-mono font-bold text-white">{formatCurrency(actionUser?.coins || 0)}</span>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-white/60">Amount (use – to deduct)</label>
            <Input type="number" step="1" placeholder="e.g. 100 or -50" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} />
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
      <p className="text-xs text-white/35">{data?.total ?? 0} referred users</p>
      {referrals.length === 0 ? (
        <div className={`${PANEL} p-8 text-center`}>
          <Link2 className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No referrals yet</p>
        </div>
      ) : (
        <div className={`${PANEL} ${ROWS}`}>
          {referrals.map((r) => (
            <div key={r.id} className="px-3.5 py-3 flex items-center gap-3">
              <div style={{ width: 28, height: 28, borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)" }}>{(r.name || r.username || "?").slice(0, 2).toUpperCase()}</span>
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
      <div className={`${PANEL} grid grid-cols-2 divide-x divide-white/[0.08]`}>
        <div className="p-3">
          <p className="text-[10px] text-white/35 uppercase tracking-wider">Total</p>
          <p className="text-base font-bold text-white font-mono mt-0.5">R{total.toFixed(2)}</p>
        </div>
        <div className="p-3">
          <p className="text-[10px] text-white/35 uppercase tracking-wider">Pending</p>
          <p className="text-base font-bold font-mono mt-0.5" style={{ color: "#f59e0b" }}>R{pending.toFixed(2)}</p>
        </div>
      </div>
      {earnings.length === 0 ? (
        <div className={`${PANEL} p-8 text-center`}>
          <BadgeDollarSign className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No commissions recorded yet</p>
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
                  {e.reseller?.name || e.reseller?.username || "—"} → {e.user?.name || e.user?.username || "—"}
                </p>
                <p className="text-[11px] text-white/20">{e.createdAt ? format(new Date(e.createdAt), "dd MMM yyyy") : "—"} · purchase R{e.purchaseAmount?.toFixed(2)}</p>
              </div>
              {e.status === "pending" && (
                <ActionBtn color="green" onClick={() => markPaid(e.id)}><CheckCircle2 className="w-2.5 h-2.5" />Mark Paid</ActionBtn>
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/40">Total: <span className="text-white font-mono font-bold">R{total.toFixed(2)}</span></p>
        <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)} className="h-7 text-xs border-white/[0.1] hover:bg-white/[0.04]">
          <ChevronDown className={cn("w-3 h-3 mr-1 transition-transform", showAdd && "rotate-180")} />
          {showAdd ? "Cancel" : "Add Expense"}
        </Button>
      </div>

      {showAdd && (
        <div className={`${PANEL} p-4 space-y-3`}>
          <p className="text-sm font-semibold text-white/70">New Expense</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/40">Type</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full h-9 rounded-lg bg-white/[0.03] border border-white/[0.1] text-white text-sm px-3 outline-none">
                {["sms", "server", "api", "infrastructure", "other"].map((t) => <option key={t} value={t} className="bg-neutral-900 text-white">{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/40">Amount (R)</label>
              <Input type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="bg-white/[0.03] border-white/[0.1] text-white h-9" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-white/40">Description</label>
            <Input placeholder="e.g. Monthly server cost" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="bg-white/[0.03] border-white/[0.1] text-white" />
          </div>
          <Button className="w-full" disabled={saving} onClick={addExpense}>{saving ? "Saving…" : "Add Expense"}</Button>
        </div>
      )}

      {expenses.length === 0 ? (
        <div className={`${PANEL} p-8 text-center`}>
          <Receipt className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No expenses recorded</p>
        </div>
      ) : (
        <div className={`${PANEL} ${ROWS}`}>
          {expenses.map((e) => (
            <div key={e.id} className="px-3.5 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white font-mono">R{e.amount.toFixed(2)}</span>
                  <span className="text-[10px] text-white/35 capitalize">{e.type}</span>
                </div>
                <p className="text-xs text-white/45 mt-0.5 truncate">{e.description}</p>
                <p className="text-[11px] text-white/20">{e.createdAt ? format(new Date(e.createdAt), "dd MMM yyyy") : "—"}</p>
              </div>
              <button onClick={() => deleteExpense(e.id)} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(248,113,113,0.2)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(248,113,113,0.5)", flexShrink: 0 }}>
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

  if (loading) return <Skel />;

  const payouts: any[] = data?.payouts ?? [];
  const pendingTotal = payouts.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/40">Pending: <span style={{ color: "#f59e0b" }} className="font-mono font-bold">R{pendingTotal.toFixed(2)}</span></p>
        <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)} className="h-7 text-xs border-white/[0.1] hover:bg-white/[0.04]">
          <ChevronDown className={cn("w-3 h-3 mr-1 transition-transform", showAdd && "rotate-180")} />
          {showAdd ? "Cancel" : "New Payout"}
        </Button>
      </div>

      {showAdd && (
        <div className={`${PANEL} p-4 space-y-3`}>
          <p className="text-sm font-semibold text-white/70">Create Payout</p>
          <div className="space-y-1">
            <label className="text-xs text-white/40">Reseller</label>
            <select value={form.resellerId} onChange={(e) => setForm((f) => ({ ...f, resellerId: e.target.value }))} className="w-full h-9 rounded-lg bg-white/[0.03] border border-white/[0.1] text-white text-sm px-3 outline-none">
              <option value="" className="bg-neutral-900">Select reseller…</option>
              {resellers.map((r) => <option key={r.id} value={r.id} className="bg-neutral-900 text-white">{r.name || r.username} ({r.email})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/40">Amount (R)</label>
              <Input type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="bg-white/[0.03] border-white/[0.1] text-white h-9" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/40">Notes (optional)</label>
              <Input placeholder="e.g. March payout" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="bg-white/[0.03] border-white/[0.1] text-white h-9" />
            </div>
          </div>
          <Button className="w-full" disabled={saving} onClick={createPayout}>{saving ? "Creating…" : "Create Payout"}</Button>
        </div>
      )}

      {payouts.length === 0 ? (
        <div className={`${PANEL} p-8 text-center`}>
          <CreditCard className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No payouts yet</p>
        </div>
      ) : (
        <div className={`${PANEL} ${ROWS}`}>
          {payouts.map((p) => (
            <div key={p.id} className="px-3.5 py-3 flex items-center gap-3">
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
                <ActionBtn color="green" onClick={() => markPaid(p.id)}><CheckCircle2 className="w-2.5 h-2.5" />Mark Paid</ActionBtn>
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

  const subTabStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600,
    border: "1px solid", cursor: "pointer", transition: "all 0.15s",
    borderColor: active ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.07)",
    background: active ? "rgba(255,255,255,0.06)" : "transparent",
    color: active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)",
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        {(["calls", "stats", "flags"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} style={subTabStyle(view === v)}>
            {v === "calls" ? "Call Logs" : v === "stats" ? "Per-User Stats" : "Abuse Flags"}
          </button>
        ))}
        {view === "flags" && (
          <button onClick={() => setShowFlag((v) => !v)} style={{ ...subTabStyle(false), marginLeft: "auto" }}>
            <Flag className="w-2.5 h-2.5 inline mr-1" />{showFlag ? "Cancel" : "New Flag"}
          </button>
        )}
      </div>

      {view === "flags" && showFlag && (
        <div className={`${PANEL} p-4 space-y-3`}>
          <p className="text-sm font-semibold text-white/70">Flag User</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/40">User ID</label>
              <Input value={flagForm.userId} onChange={(e) => setFlagForm((f) => ({ ...f, userId: e.target.value }))} placeholder="User ID" className="bg-white/[0.03] border-white/[0.1] text-white h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/40">Severity</label>
              <select value={flagForm.severity} onChange={(e) => setFlagForm((f) => ({ ...f, severity: e.target.value }))} className="w-full h-9 rounded-lg bg-white/[0.03] border border-white/[0.1] text-white text-xs px-2 outline-none">
                {["low", "medium", "high"].map((s) => <option key={s} value={s} className="bg-neutral-900 capitalize">{s}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-white/40">Reason</label>
            <Input value={flagForm.reason} onChange={(e) => setFlagForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Reason for flagging" className="bg-white/[0.03] border-white/[0.1] text-white h-9 text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-white/40">Notes (optional)</label>
            <Input value={flagForm.notes} onChange={(e) => setFlagForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Additional context" className="bg-white/[0.03] border-white/[0.1] text-white h-9 text-xs" />
          </div>
          <Button className="w-full" disabled={saving} onClick={submitFlag}>{saving ? "Saving…" : "Create Flag"}</Button>
        </div>
      )}

      {loading ? <Skel /> : view === "calls" ? (
        <div className={`${PANEL} ${ROWS}`}>
          {(callData?.calls ?? []).length === 0 && <div className="p-8 text-center"><PhoneCall className="w-6 h-6 text-white/15 mx-auto mb-2" /><p className="text-white/25 text-sm">No calls recorded</p></div>}
          {(callData?.calls ?? []).map((c: any) => (
            <div key={c.id} className="px-3.5 py-3 flex items-center gap-3">
              <div style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: c.status === "completed" ? "#34d399" : c.status === "failed" ? "#f87171" : "#f59e0b" }} />
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
        <div className={`${PANEL} ${ROWS}`}>
          {(statsData?.stats ?? []).length === 0 && <div className="p-8 text-center"><BarChart3 className="w-6 h-6 text-white/15 mx-auto mb-2" /><p className="text-white/25 text-sm">No call stats</p></div>}
          {(statsData?.stats ?? []).map((s: any) => (
            <div key={s.userId} className="px-3.5 py-3 flex items-center gap-3">
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
        <div className={`${PANEL} ${ROWS}`}>
          {(flagsData?.flags ?? []).length === 0 && <div className="p-8 text-center"><Flag className="w-6 h-6 text-white/15 mx-auto mb-2" /><p className="text-white/25 text-sm">No abuse flags</p></div>}
          {(flagsData?.flags ?? []).map((f: any) => (
            <div key={f.id} className="px-3.5 py-3 flex items-center gap-3">
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
                  <button onClick={() => resolveFlag(f.id)} style={{ width: 27, height: 27, borderRadius: 6, border: "1px solid rgba(52,211,153,0.2)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(52,211,153,0.6)" }}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={() => deleteFlag(f.id)} style={{ width: 27, height: 27, borderRadius: 6, border: "1px solid rgba(248,113,113,0.2)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(248,113,113,0.6)" }}>
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
      toast({ title: "Announcement deleted" });
      load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const typeClr = (t: string) => t === "warning" ? "#f59e0b" : t === "promo" ? "#a78bfa" : "#60a5fa";

  if (loading) return <Skel rows={3} h={64} />;
  const announcements: any[] = data?.announcements ?? [];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={openNew} className="h-8 text-xs">
          <Megaphone className="w-3 h-3 mr-1" />New Announcement
        </Button>
      </div>

      {showForm && (
        <div className={`${PANEL} p-4 space-y-3`}>
          <p className="text-sm font-semibold text-white/70">{editing ? "Edit Announcement" : "New Announcement"}</p>
          <div className="space-y-1">
            <label className="text-xs text-white/40">Title</label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Announcement title" className="bg-white/[0.03] border-white/[0.1] text-white h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-white/40">Message</label>
            <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder="Write your announcement…" rows={3} className="w-full rounded-lg bg-white/[0.03] border border-white/[0.1] text-white text-sm px-3 py-2 outline-none resize-none placeholder:text-white/25" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/40">Type</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full h-9 rounded-lg bg-white/[0.03] border border-white/[0.1] text-white text-sm px-2 outline-none">
                <option value="info" className="bg-neutral-900">Info</option>
                <option value="warning" className="bg-neutral-900">Warning</option>
                <option value="promo" className="bg-neutral-900">Promo</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/40">Target</label>
              <select value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} className="w-full h-9 rounded-lg bg-white/[0.03] border border-white/[0.1] text-white text-sm px-2 outline-none">
                <option value="all" className="bg-neutral-900">All users</option>
                <option value="resellers" className="bg-neutral-900">Resellers only</option>
                <option value="users" className="bg-neutral-900">Regular users only</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 items-center">
            <div className="space-y-1">
              <label className="text-xs text-white/40">Expires (optional)</label>
              <Input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} className="bg-white/[0.03] border-white/[0.1] text-white h-9 text-sm" />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <button onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))} className="text-white/40 hover:text-white transition-colors">
                {form.isActive ? <ToggleRight className="w-6 h-6 text-primary" /> : <ToggleLeft className="w-6 h-6" />}
              </button>
              <span className="text-xs text-white/40">{form.isActive ? "Active" : "Inactive"}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={saving} onClick={save}>{saving ? "Saving…" : (editing ? "Save Changes" : "Create")}</Button>
            <Button variant="outline" className="border-white/[0.1] text-white/50 hover:text-white" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {announcements.length === 0 ? (
        <div className={`${PANEL} p-8 text-center`}>
          <Megaphone className="w-6 h-6 text-white/15 mx-auto mb-2" />
          <p className="text-white/25 text-sm">No announcements yet</p>
        </div>
      ) : (
        <div className={`${PANEL} ${ROWS}`}>
          {announcements.map((a) => (
            <div key={a.id} className="px-3.5 py-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{a.title}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: typeClr(a.type) }}>{a.type}</span>
                    <span className="text-[10px] text-white/30">{a.target}</span>
                    {!a.isActive && <span className="text-[10px] text-white/25">inactive</span>}
                  </div>
                  <p className="text-xs text-white/45 mt-1 line-clamp-2">{a.message}</p>
                  <div className="flex items-center gap-3 mt-1">
                    {a.expiresAt && <span className="text-[10px] text-white/25 flex items-center gap-1"><Clock className="w-2.5 h-2.5" />Expires {format(new Date(a.expiresAt), "dd MMM yyyy")}</span>}
                    {a.creator && <span className="text-[10px] text-white/20">by {a.creator.username ?? a.creator.name}</span>}
                    <span className="text-[10px] text-white/15">{a.createdAt ? format(new Date(a.createdAt), "dd MMM yyyy") : ""}</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => toggle(a)} style={{ width: 27, height: 27, borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    {a.isActive ? <ToggleRight className="w-4 h-4 text-primary" /> : <ToggleLeft className="w-4 h-4 text-white/30" />}
                  </button>
                  <button onClick={() => openEdit(a)} style={{ width: 27, height: 27, borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.4)" }}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => deleteAnn(a.id)} style={{ width: 27, height: 27, borderRadius: 6, border: "1px solid rgba(248,113,113,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(248,113,113,0.5)" }}>
                    <Trash2 className="w-3.5 h-3.5" />
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

// ─── Main Admin Page ───────────────────────────────────────────────────────────
export default function Admin() {
  const [tab, setTab] = useState<TabId>("overview");

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Header */}
      <div className="pt-1 flex items-center gap-3">
        <Shield className="w-5 h-5 text-white/50 shrink-0" />
        <div>
          <h1 className="text-lg font-bold text-white leading-none">Administration</h1>
          <p className="text-xs text-white/35 mt-0.5">Platform control & analytics</p>
        </div>
      </div>

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

      {/* Tab content */}
      {tab === "overview"      && <OverviewTab />}
      {tab === "users"         && <UsersTab />}
      {tab === "referrals"     && <ReferralsTab />}
      {tab === "earnings"      && <EarningsTab />}
      {tab === "expenses"      && <ExpensesTab />}
      {tab === "payouts"       && <PayoutsTab />}
      {tab === "abuse"         && <CallsAbuseTab />}
      {tab === "announcements" && <AnnouncementsTab />}
    </div>
  );
}
