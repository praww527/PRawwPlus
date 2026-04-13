import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/hooks/use-toast";
import { cn, formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import {
  Users, TrendingUp, DollarSign, PhoneCall, ShieldAlert, Lock, Unlock, UserCheck,
  UserX, BarChart3, Link2, BadgeDollarSign, Receipt, CreditCard, RefreshCw,
  ChevronDown, Trash2, CheckCircle2, XCircle, Shield, Settings, Megaphone,
  AlertTriangle, Flag, Clock, Edit2, ToggleLeft, ToggleRight,
} from "lucide-react";

const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "users", label: "Users", icon: Users },
  { id: "referrals", label: "Referrals", icon: Link2 },
  { id: "earnings", label: "Earnings", icon: BadgeDollarSign },
  { id: "expenses", label: "Expenses", icon: Receipt },
  { id: "payouts", label: "Payouts", icon: CreditCard },
  { id: "abuse", label: "Calls & Abuse", icon: ShieldAlert },
  { id: "announcements", label: "Announcements", icon: Megaphone },
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

function roleBadge(role: string) {
  const map: Record<string, string> = {
    admin: "bg-red-500/15 text-red-400 border-red-500/25",
    reseller: "bg-violet-500/15 text-violet-400 border-violet-500/25",
    user: "bg-white/8 text-white/50 border-white/10",
  };
  return map[role] ?? map.user;
}

function statusBadge(approved: boolean, locked: boolean) {
  if (locked) return "bg-red-500/15 text-red-400 border-red-500/25";
  if (!approved) return "bg-amber-500/15 text-amber-400 border-amber-500/25";
  return "bg-emerald-500/15 text-emerald-400 border-emerald-500/25";
}
function statusLabel(approved: boolean, locked: boolean) {
  if (locked) return "Locked";
  if (!approved) return "Pending";
  return "Approved";
}

// ── Overview Tab ──────────────────────────────────────────────────────────────
function OverviewTab() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch("/admin/stats").then(setStats).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="grid grid-cols-2 gap-3">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-28 rounded-2xl glass animate-pulse" />)}</div>;
  if (!stats) return null;

  const cards = [
    { title: "Total Users", value: stats.totalUsers, icon: Users, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
    { title: "Active Subs", value: stats.activeSubscriptions, icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
    { title: "Resellers", value: stats.totalResellers, icon: Shield, color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
    { title: "Pending Approval", value: stats.pendingApprovals, icon: UserCheck, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
    { title: "Locked Accounts", value: stats.lockedUsers, icon: Lock, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
    { title: "Total Calls", value: stats.totalCalls, icon: PhoneCall, color: "text-primary", bg: "bg-primary/10 border-primary/20" },
    { title: "Revenue", value: `R${(stats.totalRevenue ?? 0).toFixed(2)}`, icon: DollarSign, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
    { title: "Profit", value: `R${(stats.profit ?? 0).toFixed(2)}`, icon: BarChart3, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c, i) => (
          <div key={i} className="glass rounded-2xl p-4 border border-white/10">
            <div className={cn("w-9 h-9 rounded-full flex items-center justify-center mb-3 border", c.bg)}>
              <c.icon className={cn("w-4 h-4", c.color)} />
            </div>
            <p className="text-xl font-bold text-white">{c.value}</p>
            <p className="text-xs text-white/40 mt-0.5">{c.title}</p>
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl border border-white/10 p-4">
        <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Financial Summary</p>
        <div className="space-y-2.5">
          <div className="flex justify-between items-center">
            <span className="text-sm text-white/60">Total Revenue</span>
            <span className="text-sm font-bold text-white font-mono">R{(stats.totalRevenue ?? 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-white/60">Commissions Paid Out</span>
            <span className="text-sm font-bold text-amber-400 font-mono">– R{(stats.totalCommissions ?? 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-white/60">Total Expenses</span>
            <span className="text-sm font-bold text-red-400 font-mono">– R{(stats.totalExpenses ?? 0).toFixed(2)}</span>
          </div>
          <div className="border-t border-white/10 pt-2.5 flex justify-between items-center">
            <span className="text-sm font-semibold text-white">Net Profit</span>
            <span className={cn("text-sm font-bold font-mono", (stats.profit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400")}>
              R{(stats.profit ?? 0).toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────
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
    } finally {
      setActing(false);
    }
  };

  const filtered = search
    ? users.filter((u) =>
        (u.name || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.username || "").toLowerCase().includes(search.toLowerCase())
      )
    : users;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Search users…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white/5 border-white/10 text-white placeholder:text-white/25"
        />
        <Button size="icon" variant="outline" onClick={load} className="shrink-0 border-white/10">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 rounded-2xl glass animate-pulse" />)}
        </div>
      ) : (
        <div className="glass rounded-2xl border border-white/10 divide-y divide-white/6">
          {filtered.length === 0 && (
            <p className="p-6 text-center text-white/30 text-sm">No users found</p>
          )}
          {filtered.map((u) => (
            <div key={u.id} className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-white/8 border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-white/60">
                    {(u.name || u.username || "?").slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{u.name || u.username}</p>
                  <p className="text-xs text-white/40 truncate">{u.email}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", roleBadge(u.role ?? "user"))}>
                      {u.role ?? "user"}
                    </span>
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", statusBadge(u.approved ?? true, u.locked ?? false))}>
                      {statusLabel(u.approved ?? true, u.locked ?? false)}
                    </span>
                    {u.referralCode && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-blue-500/25 bg-blue-500/10 text-blue-400 font-mono">
                        {u.referralCode}
                      </span>
                    )}
                    {u.phoneOtpLockedUntil && new Date(u.phoneOtpLockedUntil) > new Date() && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-orange-500/25 bg-orange-500/10 text-orange-400 font-medium">
                        OTP Locked
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {!(u.approved ?? true) && (
                  <Button size="sm" variant="outline" className="h-7 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" disabled={acting} onClick={() => act(u.id, "approve")}>
                    <UserCheck className="w-3 h-3 mr-1" /> Approve
                  </Button>
                )}
                {(u.approved ?? true) && !(u.locked ?? false) && (
                  <Button size="sm" variant="outline" className="h-7 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10" disabled={acting} onClick={() => act(u.id, "reject")}>
                    <UserX className="w-3 h-3 mr-1" /> Revoke
                  </Button>
                )}
                {!(u.locked ?? false) ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10" disabled={acting} onClick={() => act(u.id, "lock")}>
                    <Lock className="w-3 h-3 mr-1" /> Lock
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" disabled={acting} onClick={() => act(u.id, "unlock")}>
                    <Unlock className="w-3 h-3 mr-1" /> Unlock
                  </Button>
                )}
                {u.phoneOtpLockedUntil && new Date(u.phoneOtpLockedUntil) > new Date() && (
                  <Button size="sm" variant="outline" className="h-7 text-xs border-orange-500/30 text-orange-400 hover:bg-orange-500/10" disabled={acting} onClick={() => act(u.id, "unlock-otp")}>
                    <ShieldAlert className="w-3 h-3 mr-1" /> Clear OTP Lock
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-7 text-xs border-white/10 text-white/50 hover:bg-white/5" disabled={acting} onClick={() => { setActionUser(u); setNewRole(u.role ?? "user"); setActionType("role"); }}>
                  <Settings className="w-3 h-3 mr-1" /> Role
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs border-white/10 text-white/50 hover:bg-white/5" disabled={acting} onClick={() => { setActionUser(u); setCreditAmount(""); setActionType("credit"); }}>
                  <DollarSign className="w-3 h-3 mr-1" /> Credit
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Role Modal */}
      <Modal isOpen={actionType === "role" && !!actionUser} onClose={() => { setActionUser(null); setActionType(null); }} title="Set User Role" description={`Change role for ${actionUser?.name || actionUser?.username}`}>
        <div className="mt-4 space-y-4">
          {["user", "reseller", "admin"].map((r) => (
            <button key={r} onClick={() => setNewRole(r)} className={cn("w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left", newRole === r ? "border-primary/40 bg-primary/10" : "border-white/10 bg-white/3 hover:bg-white/5")}>
              <div className={cn("w-3 h-3 rounded-full border-2 transition-all", newRole === r ? "bg-primary border-primary" : "border-white/30")} />
              <div>
                <p className="text-sm font-medium text-white capitalize">{r}</p>
                <p className="text-xs text-white/40">
                  {r === "admin" ? "Full platform access" : r === "reseller" ? "Earns commissions via referrals" : "Standard VoIP user"}
                </p>
              </div>
            </button>
          ))}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => { setActionUser(null); setActionType(null); }}>Cancel</Button>
            <Button className="flex-1" disabled={acting} onClick={async () => { await act(actionUser.id, "set-role", { role: newRole }); setActionUser(null); setActionType(null); }}>
              {acting ? "Saving…" : "Save Role"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Credit Modal */}
      <Modal isOpen={actionType === "credit" && !!actionUser} onClose={() => { setActionUser(null); setActionType(null); }} title="Adjust Credit" description={`Modify balance for ${actionUser?.name || actionUser?.username}`}>
        <div className="mt-4 space-y-4">
          <div className="p-3 glass border border-white/10 rounded-xl flex justify-between">
            <span className="text-sm text-white/60">Current Balance</span>
            <span className="font-mono font-bold">{formatCurrency(actionUser?.coins || 0)}</span>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-white/80">Amount (coins, use – to deduct)</label>
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

// ── Referrals Tab ─────────────────────────────────────────────────────────────
function ReferralsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch("/admin/referrals?limit=100").then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 rounded-2xl glass animate-pulse" />)}</div>;

  const referrals: any[] = data?.referrals ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/40">{data?.total ?? 0} referred users</p>
      </div>
      {referrals.length === 0 ? (
        <div className="glass rounded-2xl border border-white/10 p-8 text-center">
          <Link2 className="w-8 h-8 text-white/20 mx-auto mb-3" />
          <p className="text-white/30 text-sm">No referrals yet</p>
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
                {r.reseller && (
                  <p className="text-xs text-violet-400 mt-0.5">
                    Ref by: {r.reseller.name || r.reseller.username}
                    {r.reseller.referralCode && <span className="font-mono ml-1 text-white/30">({r.reseller.referralCode})</span>}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-white/30">{r.createdAt ? format(new Date(r.createdAt), "dd MMM yy") : "—"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Earnings Tab ──────────────────────────────────────────────────────────────
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
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  if (loading) return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 rounded-2xl glass animate-pulse" />)}</div>;

  const earnings: any[] = data?.earnings ?? [];
  const total = earnings.reduce((s, e) => s + e.amount, 0);
  const pending = earnings.filter((e) => e.status === "pending").reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="glass rounded-xl border border-white/10 p-3">
          <p className="text-xs text-white/40">Total Commissions</p>
          <p className="text-lg font-bold text-white font-mono mt-1">R{total.toFixed(2)}</p>
        </div>
        <div className="glass rounded-xl border border-white/10 p-3">
          <p className="text-xs text-white/40">Pending</p>
          <p className="text-lg font-bold text-amber-400 font-mono mt-1">R{pending.toFixed(2)}</p>
        </div>
      </div>
      {earnings.length === 0 ? (
        <div className="glass rounded-2xl border border-white/10 p-8 text-center">
          <BadgeDollarSign className="w-8 h-8 text-white/20 mx-auto mb-3" />
          <p className="text-white/30 text-sm">No commissions recorded yet</p>
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
                  Reseller: {e.reseller?.name || e.reseller?.username || "—"} · User: {e.user?.name || e.user?.username || "—"}
                </p>
                <p className="text-xs text-white/30">{e.createdAt ? format(new Date(e.createdAt), "dd MMM yyyy") : "—"} · purchase R{e.purchaseAmount?.toFixed(2)}</p>
              </div>
              {e.status === "pending" && (
                <Button size="sm" variant="outline" className="h-7 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 shrink-0" onClick={() => markPaid(e.id)}>
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Mark Paid
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Expenses Tab ──────────────────────────────────────────────────────────────
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
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteExpense = async (id: string) => {
    try {
      await adminFetch(`/admin/expenses/${id}`, { method: "DELETE" });
      toast({ title: "Expense deleted" });
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  if (loading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 rounded-2xl glass animate-pulse" />)}</div>;

  const expenses: any[] = data?.expenses ?? [];
  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white/60">Total: <span className="text-white font-mono">R{total.toFixed(2)}</span></p>
        <Button size="sm" onClick={() => setShowAdd((v) => !v)} className="h-8 text-xs">
          <ChevronDown className={cn("w-3 h-3 mr-1 transition-transform", showAdd && "rotate-180")} />
          {showAdd ? "Cancel" : "Add Expense"}
        </Button>
      </div>

      {showAdd && (
        <div className="glass rounded-2xl border border-white/10 p-4 space-y-3">
          <p className="text-sm font-semibold text-white">New Expense</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/50">Type</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full h-10 rounded-lg bg-white/5 border border-white/10 text-white text-sm px-3 outline-none">
                {["sms", "server", "api", "infrastructure", "other"].map((t) => <option key={t} value={t} className="bg-gray-900 text-white">{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/50">Amount (R)</label>
              <Input type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="bg-white/5 border-white/10 text-white h-10" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-white/50">Description</label>
            <Input placeholder="e.g. Monthly server cost" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="bg-white/5 border-white/10 text-white" />
          </div>
          <Button className="w-full" disabled={saving} onClick={addExpense}>{saving ? "Saving…" : "Add Expense"}</Button>
        </div>
      )}

      {expenses.length === 0 ? (
        <div className="glass rounded-2xl border border-white/10 p-8 text-center">
          <Receipt className="w-8 h-8 text-white/20 mx-auto mb-3" />
          <p className="text-white/30 text-sm">No expenses recorded</p>
        </div>
      ) : (
        <div className="glass rounded-2xl border border-white/10 divide-y divide-white/6">
          {expenses.map((e) => (
            <div key={e.id} className="p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white font-mono">R{e.amount.toFixed(2)}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-white/40 capitalize">{e.type}</span>
                </div>
                <p className="text-xs text-white/50 mt-0.5 truncate">{e.description}</p>
                <p className="text-xs text-white/25">{e.createdAt ? format(new Date(e.createdAt), "dd MMM yyyy") : "—"}</p>
              </div>
              <button onClick={() => deleteExpense(e.id)} className="w-8 h-8 rounded-full hover:bg-red-500/10 flex items-center justify-center text-white/30 hover:text-red-400 transition-colors shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Payouts Tab ───────────────────────────────────────────────────────────────
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
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const markPaid = async (payoutId: string) => {
    try {
      await adminFetch(`/admin/payouts/${payoutId}/mark-paid`, { method: "POST" });
      toast({ title: "Payout marked as paid" });
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  if (loading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-2xl glass animate-pulse" />)}</div>;
  const payouts: any[] = data?.payouts ?? [];
  const pendingTotal = payouts.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white/60">Pending: <span className="text-amber-400 font-mono">R{pendingTotal.toFixed(2)}</span></p>
        <Button size="sm" onClick={() => setShowAdd((v) => !v)} className="h-8 text-xs">
          <ChevronDown className={cn("w-3 h-3 mr-1 transition-transform", showAdd && "rotate-180")} />
          {showAdd ? "Cancel" : "New Payout"}
        </Button>
      </div>

      {showAdd && (
        <div className="glass rounded-2xl border border-white/10 p-4 space-y-3">
          <p className="text-sm font-semibold text-white">Create Payout</p>
          <div className="space-y-1">
            <label className="text-xs text-white/50">Reseller</label>
            <select value={form.resellerId} onChange={(e) => setForm((f) => ({ ...f, resellerId: e.target.value }))} className="w-full h-10 rounded-lg bg-white/5 border border-white/10 text-white text-sm px-3 outline-none">
              <option value="" className="bg-gray-900">Select reseller…</option>
              {resellers.map((r) => <option key={r.id} value={r.id} className="bg-gray-900 text-white">{r.name || r.username} ({r.email})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/50">Amount (R)</label>
              <Input type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="bg-white/5 border-white/10 text-white h-10" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/50">Notes (optional)</label>
              <Input placeholder="e.g. March payout" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="bg-white/5 border-white/10 text-white h-10" />
            </div>
          </div>
          <Button className="w-full" disabled={saving} onClick={createPayout}>{saving ? "Creating…" : "Create Payout"}</Button>
        </div>
      )}

      {payouts.length === 0 ? (
        <div className="glass rounded-2xl border border-white/10 p-8 text-center">
          <CreditCard className="w-8 h-8 text-white/20 mx-auto mb-3" />
          <p className="text-white/30 text-sm">No payouts yet</p>
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
                <p className="text-xs text-white/40 mt-0.5">{p.reseller?.name || p.reseller?.username || "—"}</p>
                {p.notes && <p className="text-xs text-white/25 truncate">{p.notes}</p>}
                <p className="text-xs text-white/25">{p.createdAt ? format(new Date(p.createdAt), "dd MMM yyyy") : "—"}{p.paidAt ? ` · Paid ${format(new Date(p.paidAt), "dd MMM yyyy")}` : ""}</p>
              </div>
              {p.status === "pending" && (
                <Button size="sm" variant="outline" className="h-7 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 shrink-0" onClick={() => markPaid(p.id)}>
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Mark Paid
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Calls & Abuse Tab ─────────────────────────────────────────────────────────
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

  const loadCalls = useCallback(async () => {
    setLoading(true);
    try { setCallData(await adminFetch("/admin/calls?limit=50")); } finally { setLoading(false); }
  }, []);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try { setStatsData(await adminFetch("/admin/call-stats?limit=50")); } finally { setLoading(false); }
  }, []);

  const loadFlags = useCallback(async () => {
    setLoading(true);
    try { setFlagsData(await adminFetch("/admin/abuse-flags?limit=50")); } finally { setLoading(false); }
  }, []);

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

  const resolveFlag = async (flagId: string) => {
    try {
      await adminFetch(`/admin/abuse-flags/${flagId}/resolve`, { method: "POST" });
      toast({ title: "Flag resolved" });
      loadFlags();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const deleteFlag = async (flagId: string) => {
    try {
      await adminFetch(`/admin/abuse-flags/${flagId}`, { method: "DELETE" });
      toast({ title: "Flag removed" });
      loadFlags();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  };

  const severityColor = (s: string) =>
    s === "high" ? "border-red-500/25 bg-red-500/10 text-red-400"
    : s === "medium" ? "border-amber-500/25 bg-amber-500/10 text-amber-400"
    : "border-emerald-500/25 bg-emerald-500/10 text-emerald-400";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {(["calls", "stats", "flags"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={cn("px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all",
              view === v ? "bg-primary/15 text-primary border border-primary/25"
                : "text-white/40 hover:text-white/70 border border-transparent hover:bg-white/5")}>
            {v === "calls" ? "Call Logs" : v === "stats" ? "Per-User Stats" : "Abuse Flags"}
          </button>
        ))}
        {view === "flags" && (
          <Button size="sm" onClick={() => setShowFlag((v) => !v)} className="ml-auto h-7 text-xs">
            <Flag className="w-3 h-3 mr-1" />{showFlag ? "Cancel" : "New Flag"}
          </Button>
        )}
      </div>

      {view === "flags" && showFlag && (
        <div className="glass rounded-2xl border border-white/10 p-4 space-y-3">
          <p className="text-sm font-semibold text-white">Flag User</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/50">User ID</label>
              <Input value={flagForm.userId} onChange={(e) => setFlagForm((f) => ({ ...f, userId: e.target.value }))} placeholder="User ID" className="bg-white/5 border-white/10 text-white h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/50">Severity</label>
              <select value={flagForm.severity} onChange={(e) => setFlagForm((f) => ({ ...f, severity: e.target.value }))} className="w-full h-9 rounded-lg bg-white/5 border border-white/10 text-white text-xs px-2 outline-none">
                <option value="low" className="bg-gray-900">Low</option>
                <option value="medium" className="bg-gray-900">Medium</option>
                <option value="high" className="bg-gray-900">High</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-white/50">Reason</label>
            <Input value={flagForm.reason} onChange={(e) => setFlagForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Reason for flagging" className="bg-white/5 border-white/10 text-white h-9 text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-white/50">Notes (optional)</label>
            <Input value={flagForm.notes} onChange={(e) => setFlagForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Additional context" className="bg-white/5 border-white/10 text-white h-9 text-xs" />
          </div>
          <Button className="w-full" disabled={saving} onClick={submitFlag}>{saving ? "Saving…" : "Create Flag"}</Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-2xl glass animate-pulse" />)}</div>
      ) : view === "calls" ? (
        <div className="glass rounded-2xl border border-white/10 divide-y divide-white/6">
          {(callData?.calls ?? []).length === 0 && (
            <div className="p-8 text-center"><PhoneCall className="w-8 h-8 text-white/20 mx-auto mb-3" /><p className="text-white/30 text-sm">No calls recorded</p></div>
          )}
          {(callData?.calls ?? []).map((c: any) => (
            <div key={c.id} className="p-3 flex items-center gap-3">
              <div className={cn("w-2 h-2 rounded-full shrink-0", c.status === "completed" ? "bg-emerald-400" : c.status === "failed" ? "bg-red-400" : "bg-amber-400")} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">{c.username ?? c.userId}</span>
                  <span className="text-xs text-white/40">→ {c.destination}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-white/30">{c.status}</span>
                  {c.duration > 0 && <span className="text-[10px] text-white/30">{Math.floor(c.duration / 60)}m {c.duration % 60}s</span>}
                  {c.createdAt && <span className="text-[10px] text-white/25">{format(new Date(c.createdAt), "dd MMM HH:mm")}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : view === "stats" ? (
        <div className="glass rounded-2xl border border-white/10 divide-y divide-white/6">
          {(statsData?.stats ?? []).length === 0 && (
            <div className="p-8 text-center"><BarChart3 className="w-8 h-8 text-white/20 mx-auto mb-3" /><p className="text-white/30 text-sm">No call stats</p></div>
          )}
          {(statsData?.stats ?? []).map((s: any) => (
            <div key={s.userId} className="p-3 flex items-center gap-3">
              {s.suspicious && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{s.user?.username ?? s.userId}</span>
                  {s.suspicious && <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-red-500/25 bg-red-500/10 text-red-400 font-medium">suspicious</span>}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-white/50">{s.totalCalls} calls</span>
                  <span className="text-xs text-white/40">{Math.floor(s.totalDuration / 60)}m total</span>
                  <span className={cn("text-xs", s.failedRate > 50 ? "text-red-400" : "text-white/40")}>{s.failedRate}% failed</span>
                </div>
              </div>
              <span className="text-xs text-white/25 shrink-0">{s.user?.email ?? ""}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass rounded-2xl border border-white/10 divide-y divide-white/6">
          {(flagsData?.flags ?? []).length === 0 && (
            <div className="p-8 text-center"><Flag className="w-8 h-8 text-white/20 mx-auto mb-3" /><p className="text-white/30 text-sm">No abuse flags</p></div>
          )}
          {(flagsData?.flags ?? []).map((f: any) => (
            <div key={f.id} className="p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{f.user?.username ?? f.userId}</span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-medium", severityColor(f.severity))}>{f.severity}</span>
                  {f.resolvedAt && <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 font-medium">resolved</span>}
                </div>
                <p className="text-xs text-white/50 mt-0.5 truncate">{f.reason}</p>
                {f.notes && <p className="text-xs text-white/30 truncate">{f.notes}</p>}
                <p className="text-[10px] text-white/25">{f.createdAt ? format(new Date(f.createdAt), "dd MMM yyyy") : ""}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {!f.resolvedAt && (
                  <Button size="sm" variant="outline" onClick={() => resolveFlag(f.id)} className="h-7 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">
                    <CheckCircle2 className="w-3 h-3" />
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => deleteFlag(f.id)} className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Announcements Tab ─────────────────────────────────────────────────────────
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
      toast({ title: a.isActive ? "Announcement deactivated" : "Announcement activated" });
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

  const typeColor = (t: string) =>
    t === "warning" ? "border-amber-500/25 bg-amber-500/10 text-amber-400"
    : t === "promo" ? "border-purple-500/25 bg-purple-500/10 text-purple-400"
    : "border-blue-500/25 bg-blue-500/10 text-blue-400";

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-2xl glass animate-pulse" />)}</div>;
  const announcements: any[] = data?.announcements ?? [];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={openNew} className="h-8 text-xs">
          <Megaphone className="w-3 h-3 mr-1" />New Announcement
        </Button>
      </div>

      {showForm && (
        <div className="glass rounded-2xl border border-white/10 p-4 space-y-3">
          <p className="text-sm font-semibold text-white">{editing ? "Edit Announcement" : "New Announcement"}</p>
          <div className="space-y-1">
            <label className="text-xs text-white/50">Title</label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Announcement title" className="bg-white/5 border-white/10 text-white h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-white/50">Message</label>
            <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder="Write your announcement…" rows={3} className="w-full rounded-lg bg-white/5 border border-white/10 text-white text-sm px-3 py-2 outline-none resize-none placeholder:text-white/30" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-white/50">Type</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full h-9 rounded-lg bg-white/5 border border-white/10 text-white text-sm px-2 outline-none">
                <option value="info" className="bg-gray-900">Info</option>
                <option value="warning" className="bg-gray-900">Warning</option>
                <option value="promo" className="bg-gray-900">Promo</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/50">Target</label>
              <select value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} className="w-full h-9 rounded-lg bg-white/5 border border-white/10 text-white text-sm px-2 outline-none">
                <option value="all" className="bg-gray-900">All users</option>
                <option value="resellers" className="bg-gray-900">Resellers only</option>
                <option value="users" className="bg-gray-900">Regular users only</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 items-center">
            <div className="space-y-1">
              <label className="text-xs text-white/50">Expires (optional)</label>
              <Input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} className="bg-white/5 border-white/10 text-white h-9 text-sm" />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <button onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))} className="text-white/50 hover:text-white transition-colors">
                {form.isActive ? <ToggleRight className="w-6 h-6 text-primary" /> : <ToggleLeft className="w-6 h-6" />}
              </button>
              <span className="text-xs text-white/50">{form.isActive ? "Active" : "Inactive"}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={saving} onClick={save}>{saving ? "Saving…" : (editing ? "Save Changes" : "Create")}</Button>
            <Button variant="outline" className="border-white/10 text-white/50 hover:text-white" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {announcements.length === 0 ? (
        <div className="glass rounded-2xl border border-white/10 p-8 text-center">
          <Megaphone className="w-8 h-8 text-white/20 mx-auto mb-3" />
          <p className="text-white/30 text-sm">No announcements yet</p>
        </div>
      ) : (
        <div className="glass rounded-2xl border border-white/10 divide-y divide-white/6">
          {announcements.map((a) => (
            <div key={a.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{a.title}</span>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-medium", typeColor(a.type))}>{a.type}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-white/40 font-medium">{a.target}</span>
                    {!a.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-white/30 font-medium">inactive</span>}
                  </div>
                  <p className="text-xs text-white/50 mt-1 line-clamp-2">{a.message}</p>
                  <div className="flex items-center gap-3 mt-1">
                    {a.expiresAt && <span className="text-[10px] text-white/30 flex items-center gap-1"><Clock className="w-2.5 h-2.5" />Expires {format(new Date(a.expiresAt), "dd MMM yyyy")}</span>}
                    {a.creator && <span className="text-[10px] text-white/25">by {a.creator.username ?? a.creator.name}</span>}
                    <span className="text-[10px] text-white/20">{a.createdAt ? format(new Date(a.createdAt), "dd MMM yyyy") : ""}</span>
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => toggle(a)} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-white/40 hover:text-white">
                    {a.isActive ? <ToggleRight className="w-4 h-4 text-primary" /> : <ToggleLeft className="w-4 h-4" />}
                  </button>
                  <button onClick={() => openEdit(a)} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-white/40 hover:text-white">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => deleteAnn(a.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors text-white/40 hover:text-red-400">
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

// ── Main Admin Page ───────────────────────────────────────────────────────────
export default function Admin() {
  const [tab, setTab] = useState<TabId>("overview");

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <div className="pt-1 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-red-500/12 border border-red-500/20 flex items-center justify-center">
          <ShieldAlert className="w-5 h-5 text-red-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Administration</h1>
          <p className="text-xs text-white/40">Full platform control & analytics</p>
        </div>
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
                ? "bg-primary/15 text-primary border border-primary/25"
                : "text-white/40 hover:text-white/70 hover:bg-white/5 border border-transparent"
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "overview" && <OverviewTab />}
      {tab === "users" && <UsersTab />}
      {tab === "referrals" && <ReferralsTab />}
      {tab === "earnings" && <EarningsTab />}
      {tab === "expenses" && <ExpensesTab />}
      {tab === "payouts" && <PayoutsTab />}
      {tab === "abuse" && <CallsAbuseTab />}
      {tab === "announcements" && <AnnouncementsTab />}
    </div>
  );
}
