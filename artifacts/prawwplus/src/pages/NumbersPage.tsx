import { useState, useEffect, useCallback } from "react";
import { Hash, RefreshCw, Clock, CheckCircle, XCircle, AlertCircle, Settings, Plus, X, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { apiFetch } from "@/lib/apiFetch";
import { useAuth } from "@workspace/auth-web";

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function apiFetchJson(path: string, opts?: RequestInit) {
  const method = (opts?.method ?? "GET").toUpperCase();
  const csrfHeaders: Record<string, string> =
    ["POST", "PUT", "PATCH", "DELETE"].includes(method)
      ? { "X-CSRF-Token": getCsrfToken() }
      : {};
  const res = await apiFetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

type Tab = "numbers" | "port";

function StatusBadge({ status }: { status: string }) {
  const s = (status ?? "").toLowerCase();
  if (s === "active" || s === "available") return <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">Active</span>;
  if (s === "pending") return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Pending</span>;
  if (s === "reserved") return <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400">Reserved</span>;
  if (s === "cancelled" || s === "failed") return <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">{status}</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/50">{status ?? "Unknown"}</span>;
}

function PortStatusIcon({ status }: { status: string }) {
  const s = (status ?? "").toLowerCase();
  if (s === "completed" || s === "active") return <CheckCircle size={14} className="text-green-400" />;
  if (s === "pending" || s === "submitted") return <Clock size={14} className="text-amber-400" />;
  if (s === "failed" || s === "rejected") return <XCircle size={14} className="text-red-400" />;
  return <AlertCircle size={14} className="text-white/30" />;
}

type RouteType = "agent" | "ring_group" | "queue";
const ROUTE_TYPE_LABELS: Record<RouteType, string> = {
  agent:      "Agent",
  ring_group: "Ring Group",
  queue:      "Queue",
};

interface AdminNumber {
  _id: string;
  number: string;
  status: string;
  type?: string;
  assignedTo?: string;
  capability?: string | string[];
  routeType?: RouteType;
  routeTarget?: string;
  routeTargetName?: string;
}

interface RingGroup { id: string; _id?: string; name: string; }
interface AgentUser { _id: string; name?: string; username?: string; }

interface SetRouteModalProps {
  number: AdminNumber;
  ringGroups: RingGroup[];
  agents: AgentUser[];
  onClose: () => void;
  onSaved: () => void;
}

function agentLabel(u: AgentUser) { return u.name || u.username || u._id; }

function SetRouteModal({ number, ringGroups, agents, onClose, onSaved }: SetRouteModalProps) {
  const [routeType, setRouteType] = useState<RouteType>(number.routeType ?? "agent");
  const [routeTarget, setRouteTarget] = useState<string>(number.routeTarget ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!routeTarget) { setError("Please select a target"); return; }
    setSaving(true);
    setError(null);
    try {
      await apiFetchJson(`/numbers/${number._id}/route`, {
        method: "PUT",
        body: JSON.stringify({ routeType, routeTarget }),
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const selectStyle: React.CSSProperties = {
    width: "100%", padding: "10px 14px", borderRadius: 10,
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
    color: "rgba(255,255,255,0.9)", fontSize: 14, outline: "none",
    boxSizing: "border-box", cursor: "pointer",
  };

  const targets = routeType === "agent" ? agents
    : routeType === "ring_group" ? ringGroups.map((g) => ({ _id: g.id || g._id || "", name: g.name, username: undefined }))
    : [];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000, display: "flex",
      alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.65)", padding: "20px",
    }}>
      <div style={{
        background: "rgba(20,20,28,0.98)", border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 18, padding: 28, width: "100%", maxWidth: 420,
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: 0 }}>Set Route</h2>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "3px 0 0", fontFamily: "monospace" }}>{number.number}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", display: "flex" }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>Route Type</label>
            <select style={selectStyle} value={routeType} onChange={(e) => { setRouteType(e.target.value as RouteType); setRouteTarget(""); }}>
              {(Object.keys(ROUTE_TYPE_LABELS) as RouteType[]).map((t) => (
                <option key={t} value={t}>{ROUTE_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>Target</label>
            {routeType === "queue" ? (
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>Queue routing coming soon.</p>
            ) : targets.length === 0 ? (
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>
                No {routeType === "agent" ? "agents" : "ring groups"} available.
              </p>
            ) : (
              <select style={selectStyle} value={routeTarget} onChange={(e) => setRouteTarget(e.target.value)}>
                <option value="">— Select —</option>
                {targets.map((t) => (
                  <option key={t._id} value={t._id}>{agentLabel(t as AgentUser)}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 14, padding: "9px 14px", borderRadius: 9, background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.25)" }}>
            <p style={{ fontSize: 12, color: "#f87171", margin: 0 }}>{error}</p>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "11px 0", borderRadius: 12,
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)",
            color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || routeType === "queue"} style={{
            flex: 2, padding: "11px 0", borderRadius: 12,
            background: saving || routeType === "queue" ? "rgba(59,130,246,0.3)" : "#3b82f6", border: "none",
            color: "#fff", fontSize: 14, fontWeight: 600,
            cursor: saving || routeType === "queue" ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            {saving && <RefreshCw size={14} className="animate-spin" />}
            {saving ? "Saving…" : "Save Route"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ProvisionModalProps {
  agents: AgentUser[];
  ringGroups: RingGroup[];
  onClose: () => void;
  onProvisioned: () => void;
}

function ProvisionModal({ agents, ringGroups, onClose, onProvisioned }: ProvisionModalProps) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [providerRef, setProviderRef] = useState("");
  const [routeType, setRouteType] = useState<RouteType>("agent");
  const [routeTarget, setRouteTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleProvision = async () => {
    if (!phoneNumber.trim()) { setError("Phone number is required"); return; }
    setSaving(true);
    setError(null);
    try {
      await apiFetchJson("/numbers/admin/provision", {
        method: "POST",
        body: JSON.stringify({
          phone_number: phoneNumber.trim(),
          provider_ref: providerRef.trim() || undefined,
          routeType,
          routeTarget: routeTarget || undefined,
        }),
      });
      onProvisioned();
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Provisioning failed");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 14px", borderRadius: 10,
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
    color: "rgba(255,255,255,0.9)", fontSize: 14, outline: "none", boxSizing: "border-box",
  };

  const targets = routeType === "agent"
    ? agents
    : routeType === "ring_group"
    ? ringGroups.map((g) => ({ _id: g.id || g._id || "", name: g.name, username: undefined }))
    : [];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000, display: "flex",
      alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.65)", padding: "20px",
    }}>
      <div style={{
        background: "rgba(20,20,28,0.98)", border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 18, padding: 28, width: "100%", maxWidth: 440,
        maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: 0 }}>Provision DID</h2>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "3px 0 0" }}>Add a number via BizVoIP provider</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", display: "flex" }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>
              DID Number *
            </label>
            <input
              style={{ ...inputStyle, fontFamily: "monospace" }}
              placeholder="+27821234567"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>
              BizVoIP Provider Ref (optional)
            </label>
            <input
              style={inputStyle}
              placeholder="Provider reference ID"
              value={providerRef}
              onChange={(e) => setProviderRef(e.target.value)}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>Route Type</label>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={routeType}
              onChange={(e) => { setRouteType(e.target.value as RouteType); setRouteTarget(""); }}
            >
              {(Object.keys(ROUTE_TYPE_LABELS) as RouteType[]).map((t) => (
                <option key={t} value={t}>{ROUTE_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          {routeType !== "queue" && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>Target (optional)</label>
              {targets.length === 0 ? (
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>
                  No {routeType === "agent" ? "agents" : "ring groups"} available.
                </p>
              ) : (
                <select style={{ ...inputStyle, cursor: "pointer" }} value={routeTarget} onChange={(e) => setRouteTarget(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {targets.map((t) => (
                    <option key={t._id} value={t._id}>{agentLabel(t as AgentUser)}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 14, padding: "9px 14px", borderRadius: 9, background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.25)" }}>
            <p style={{ fontSize: 12, color: "#f87171", margin: 0 }}>{error}</p>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "11px 0", borderRadius: 12,
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)",
            color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}>Cancel</button>
          <button onClick={handleProvision} disabled={saving} style={{
            flex: 2, padding: "11px 0", borderRadius: 12,
            background: saving ? "rgba(59,130,246,0.3)" : "#3b82f6", border: "none",
            color: "#fff", fontSize: 14, fontWeight: 600,
            cursor: saving ? "wait" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            {saving && <RefreshCw size={14} className="animate-spin" />}
            {saving ? "Provisioning…" : "Provision Number"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RouteBadge({ routeType, routeTargetName }: { routeType?: string; routeTargetName?: string }) {
  if (!routeType) return <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>Unrouted</span>;
  const label = routeType === "agent" ? "Agent"
    : routeType === "ring_group" ? "Ring Group"
    : routeType === "queue" ? "Queue"
    : routeType;
  const colors = routeType === "agent"
    ? { bg: "rgba(96,165,250,0.12)", border: "rgba(96,165,250,0.25)", text: "#93c5fd" }
    : routeType === "ring_group"
    ? { bg: "rgba(52,211,153,0.12)", border: "rgba(52,211,153,0.25)", text: "#34d399" }
    : { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.25)", text: "#f59e0b" };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
        background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text,
      }}>{label}</span>
      {routeTargetName && (
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {routeTargetName}
        </span>
      )}
    </div>
  );
}

export default function NumbersPage() {
  const { user } = useAuth();
  const isAdmin = (user as any)?.isAdmin === true;

  const [tab, setTab] = useState<Tab>("numbers");
  const [numbers, setNumbers] = useState<any[]>([]);
  const [portReqs, setPortReqs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ringGroups, setRingGroups] = useState<RingGroup[]>([]);
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [setRouteTarget, setSetRouteTarget] = useState<AdminNumber | null>(null);
  const [showProvision, setShowProvision] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const numbersEndpoint = isAdmin ? "/numbers/admin" : "/numbers";
      const [numData, portData] = await Promise.allSettled([
        apiFetchJson(numbersEndpoint),
        apiFetchJson("/portRequests"),
      ]);
      if (numData.status === "fulfilled") {
        setNumbers(numData.value.data ?? numData.value.numbers ?? numData.value ?? []);
      } else {
        setNumbers([]);
        const msg = numData.reason instanceof Error ? numData.reason.message : "Failed to load phone numbers";
        setError((prev) => prev ? `${prev}; ${msg}` : msg);
      }
      if (portData.status === "fulfilled") {
        setPortReqs(portData.value.data ?? portData.value.requests ?? portData.value ?? []);
      } else {
        setPortReqs([]);
      }

      if (isAdmin) {
        const [rgData, agData] = await Promise.allSettled([
          apiFetchJson("/ring-groups"),
          apiFetchJson("/admin/users?limit=500"),
        ]);
        if (rgData.status === "fulfilled") setRingGroups(rgData.value.ringGroups ?? []);
        if (agData.status === "fulfilled") setAgents(agData.value.users ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "numbers", label: "Phone Numbers", count: numbers.length },
    { key: "port",    label: "Port Requests",  count: portReqs.length },
  ];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {setRouteTarget && (
        <SetRouteModal
          number={setRouteTarget}
          ringGroups={ringGroups}
          agents={agents}
          onClose={() => setSetRouteTarget(null)}
          onSaved={load}
        />
      )}
      {showProvision && (
        <ProvisionModal
          agents={agents}
          ringGroups={ringGroups}
          onClose={() => setShowProvision(false)}
          onProvisioned={load}
        />
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Hash className="text-indigo-400" size={22} />
          <h1 className="text-xl font-bold text-white">Numbers</h1>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowProvision(true)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600,
                background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.25)",
                color: "#34d399", cursor: "pointer",
              }}
            >
              <Plus size={13} />
              Provision from BizVoIP
            </button>
          )}
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors"
          >
            <RefreshCw size={13} />Refresh
          </button>
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-white/5 w-fit">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`text-xs px-4 py-1.5 rounded-lg font-medium transition-colors ${tab === t.key ? "bg-indigo-600 text-white" : "text-white/50 hover:text-white/80"}`}>
            {t.label}{t.count !== undefined && t.count > 0 ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-white/40 text-sm">Loading…</div>
      ) : tab === "numbers" ? (
        numbers.length === 0 ? (
          <div className="text-center py-16 text-white/40 text-sm">No phone numbers found.</div>
        ) : (
          <div className="space-y-2">
            {numbers.map((n) => (
              <div
                key={n._id}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }}
                className="flex items-center gap-3 p-3"
              >
                <div className="w-9 h-9 rounded-xl bg-indigo-600/20 flex items-center justify-center shrink-0">
                  <Hash size={15} className="text-indigo-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white/90 font-mono tracking-wide">{n.number ?? n.phoneNumber}</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {n.type ?? n.numberType ?? "DID"}
                    {n.assignedTo ? ` · ${n.assignedTo}` : (isAdmin ? " · Unassigned" : "")}
                    {n.capability ? ` · ${Array.isArray(n.capability) ? n.capability.join(", ") : n.capability}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {isAdmin && (
                    <RouteBadge routeType={n.routeType} routeTargetName={n.routeTargetName} />
                  )}
                  <StatusBadge status={n.status ?? "active"} />
                  {isAdmin && (
                    <button
                      onClick={() => setSetRouteTarget(n as AdminNumber)}
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                        background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)",
                        color: "rgba(255,255,255,0.55)", cursor: "pointer",
                      }}
                    >
                      <Settings size={12} />
                      Route
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        portReqs.length === 0 ? (
          <div className="text-center py-16 text-white/40 text-sm">No port requests found.</div>
        ) : (
          <div className="space-y-2">
            {portReqs.map((p) => (
              <div key={p._id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }}
                className="flex items-center gap-3 p-3">
                <PortStatusIcon status={p.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white/90 font-mono">{p.number ?? p.phoneNumber}</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {p.carrier ? `From: ${p.carrier}` : ""}
                    {p.submittedAt ? ` · Submitted ${format(new Date(p.submittedAt), "MMM d, yyyy")}` : ""}
                    {p.portDate ? ` · Port date: ${format(new Date(p.portDate), "MMM d, yyyy")}` : ""}
                  </p>
                </div>
                <StatusBadge status={p.status ?? "pending"} />
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
