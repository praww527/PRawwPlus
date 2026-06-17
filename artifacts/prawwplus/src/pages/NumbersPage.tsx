import { useState, useEffect, useCallback } from "react";
import {
  Hash, RefreshCw, Clock, CheckCircle, XCircle, AlertCircle,
  Settings, Plus, X, Search, Loader2,
} from "lucide-react";
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
  if (!res.ok) throw new Error(data.error ?? data.message ?? "Request failed");
  return data;
}

type Tab = "numbers" | "port";

function StatusBadge({ status }: { status: string }) {
  const s = (status ?? "").toLowerCase();
  if (s === "active" || s === "available")
    return <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">Active</span>;
  if (s === "pending")
    return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Pending</span>;
  if (s === "reserved")
    return <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400">Reserved</span>;
  if (s === "cancelled" || s === "failed")
    return <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">{status}</span>;
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
  id: string;
  number: string;
  status?: string;
  user?: { name?: string; username?: string } | null;
  routeType?: RouteType;
  routeTarget?: string;
  routeTargetName?: string;
}

interface RingGroup { id: string; _id?: string; name: string; }
interface AgentUser { _id: string; name?: string; username?: string; }
interface Queue     { id: string; _id?: string; name: string; extension?: string; }

function agentLabel(u: AgentUser) { return u.name || u.username || u._id; }
function queueLabel(q: Queue)     { return q.name || `Queue ${q.extension ?? q.id}`; }

function RouteBadge({ routeType, routeTargetName }: { routeType?: string; routeTargetName?: string }) {
  if (!routeType || routeType === "agent" && !routeTargetName)
    return <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>Unrouted</span>;
  const label = ROUTE_TYPE_LABELS[routeType as RouteType] ?? routeType;
  const colors =
    routeType === "agent"
      ? { bg: "rgba(96,165,250,0.12)",  border: "rgba(96,165,250,0.25)",  text: "#93c5fd" }
      : routeType === "ring_group"
      ? { bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.25)",  text: "#34d399" }
      : { bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.25)",  text: "#f59e0b" };
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

const selectStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 10,
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
  color: "rgba(255,255,255,0.9)", fontSize: 14, outline: "none",
  boxSizing: "border-box", cursor: "pointer",
};
const inputStyle: React.CSSProperties = { ...selectStyle };

/* ── Set Route Modal ──────────────────────────────────────────────────────── */
interface SetRouteModalProps {
  number: AdminNumber;
  ringGroups: RingGroup[];
  agents: AgentUser[];
  queues: Queue[];
  onClose: () => void;
  onSaved: () => void;
}

function SetRouteModal({ number, ringGroups, agents, queues, onClose, onSaved }: SetRouteModalProps) {
  const [routeType, setRouteType] = useState<RouteType>(number.routeType ?? "agent");
  const [routeTarget, setRouteTarget] = useState<string>(number.routeTarget ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets =
    routeType === "agent"      ? agents.map((a) => ({ id: a._id, label: agentLabel(a) }))
    : routeType === "ring_group" ? ringGroups.map((g) => ({ id: g.id || g._id || "", label: g.name }))
    :                              queues.map((q) => ({ id: q.id || q._id || "", label: queueLabel(q) }));

  const handleSave = async () => {
    if (!routeTarget) { setError("Please select a target"); return; }
    setSaving(true);
    setError(null);
    try {
      await apiFetchJson(`/numbers/${number.id}/route`, {
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
            <select
              style={selectStyle}
              value={routeType}
              onChange={(e) => { setRouteType(e.target.value as RouteType); setRouteTarget(""); }}
            >
              {(Object.keys(ROUTE_TYPE_LABELS) as RouteType[]).map((t) => (
                <option key={t} value={t}>{ROUTE_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>Target</label>
            {targets.length === 0 ? (
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>
                No {ROUTE_TYPE_LABELS[routeType].toLowerCase()}s available.
              </p>
            ) : (
              <select style={selectStyle} value={routeTarget} onChange={(e) => setRouteTarget(e.target.value)}>
                <option value="">— Select —</option>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
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
          <button onClick={handleSave} disabled={saving} style={{
            flex: 2, padding: "11px 0", borderRadius: 12,
            background: saving ? "rgba(59,130,246,0.3)" : "#3b82f6", border: "none",
            color: "#fff", fontSize: 14, fontWeight: 600,
            cursor: saving ? "wait" : "pointer",
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

/* ── Provision Modal (BizVoIP inventory picker) ───────────────────────────── */
interface AvailableDid {
  phone_number: string;
  number_type?: string;
  region?: string | null;
  monthly_cost?: number | null;
  provider_ref?: string;
  source?: string;
}

interface ProvisionModalProps {
  agents: AgentUser[];
  ringGroups: RingGroup[];
  queues: Queue[];
  onClose: () => void;
  onProvisioned: () => void;
}

function ProvisionModal({ agents, ringGroups, queues, onClose, onProvisioned }: ProvisionModalProps) {
  const [available, setAvailable] = useState<AvailableDid[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [pattern, setPattern] = useState("");

  const [selected, setSelected] = useState<AvailableDid | null>(null);
  const [manualNumber, setManualNumber] = useState("");
  const [manualRef, setManualRef] = useState("");
  const [useManual, setUseManual] = useState(false);

  const [routeType, setRouteType] = useState<RouteType>("agent");
  const [routeTarget, setRouteTarget] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchNumbers = async () => {
    setSearching(true);
    setSearchErr(null);
    try {
      const qs = pattern ? `?country_code=ZA&contains=${encodeURIComponent(pattern)}` : "?country_code=ZA";
      const data = await apiFetchJson(`/numbers/search${qs}`);
      setAvailable(data.numbers ?? []);
      setSearchDone(true);
    } catch (err: any) {
      setSearchErr(err.message ?? "Search failed");
      setSearchDone(true);
    } finally {
      setSearching(false);
    }
  };

  const phoneNumber = useManual ? manualNumber : (selected?.phone_number ?? "");
  const providerRef = useManual ? manualRef : (selected?.provider_ref ?? "");

  const targets =
    routeType === "agent"      ? agents.map((a) => ({ id: a._id, label: agentLabel(a) }))
    : routeType === "ring_group" ? ringGroups.map((g) => ({ id: g.id || g._id || "", label: g.name }))
    :                              queues.map((q) => ({ id: q.id || q._id || "", label: queueLabel(q) }));

  const handleProvision = async () => {
    if (!phoneNumber.trim()) { setError("Select or enter a phone number"); return; }
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

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000, display: "flex",
      alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.65)", padding: "20px",
    }}>
      <div style={{
        background: "rgba(20,20,28,0.98)", border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 18, padding: 28, width: "100%", maxWidth: 500,
        maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: 0 }}>Provision DID</h2>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "3px 0 0" }}>
              Select from BizVoIP inventory or enter manually
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", display: "flex" }}>
            <X size={20} />
          </button>
        </div>

        {/* ── BizVoIP number search ── */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 8 }}>
            Search BizVoIP Inventory
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...inputStyle, flex: 1, fontFamily: "monospace" }}
              placeholder="Filter pattern (optional)"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchNumbers()}
            />
            <button
              onClick={searchNumbers}
              disabled={searching}
              style={{
                padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                background: "#3b82f6", border: "none", color: "#fff", cursor: searching ? "wait" : "pointer",
                display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
              }}
            >
              {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {searching ? "Searching…" : "Search"}
            </button>
          </div>

          {searchErr && (
            <p style={{ fontSize: 12, color: "#f87171", marginTop: 8 }}>{searchErr}</p>
          )}

          {searchDone && !searchErr && (
            available.length === 0 ? (
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 8, fontStyle: "italic" }}>
                No available numbers found.
              </p>
            ) : (
              <div style={{
                marginTop: 10, maxHeight: 200, overflowY: "auto",
                border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10,
                background: "rgba(255,255,255,0.03)",
              }}>
                {available.map((d) => (
                  <button
                    key={d.phone_number}
                    onClick={() => { setSelected(d); setUseManual(false); }}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "9px 14px", background: selected?.phone_number === d.phone_number
                        ? "rgba(59,130,246,0.15)" : "none",
                      border: "none",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.9)", margin: 0, fontFamily: "monospace" }}>
                        {d.phone_number}
                      </p>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0 }}>
                        {d.number_type ?? "local"}{d.region ? ` · ${d.region}` : ""}
                        {d.monthly_cost ? ` · R${d.monthly_cost}/mo` : ""}
                      </p>
                    </div>
                    {selected?.phone_number === d.phone_number && (
                      <CheckCircle size={16} style={{ color: "#3b82f6", flexShrink: 0 }} />
                    )}
                  </button>
                ))}
              </div>
            )
          )}
        </div>

        {/* ── Divider ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
          <button
            onClick={() => { setUseManual(!useManual); setSelected(null); }}
            style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", background: "none", border: "none", cursor: "pointer" }}
          >
            {useManual ? "← Use inventory selection" : "Enter number manually →"}
          </button>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
        </div>

        {/* ── Manual entry ── */}
        {useManual && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>
                DID Number *
              </label>
              <input
                style={{ ...inputStyle, fontFamily: "monospace" }}
                placeholder="+27821234567"
                value={manualNumber}
                onChange={(e) => setManualNumber(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>
                BizVoIP Provider Ref (optional)
              </label>
              <input
                style={inputStyle}
                placeholder="Provider reference ID"
                value={manualRef}
                onChange={(e) => setManualRef(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* ── Route assignment ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>Route Type</label>
            <select
              style={selectStyle}
              value={routeType}
              onChange={(e) => { setRouteType(e.target.value as RouteType); setRouteTarget(""); }}
            >
              {(Object.keys(ROUTE_TYPE_LABELS) as RouteType[]).map((t) => (
                <option key={t} value={t}>{ROUTE_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>
              Target (optional)
            </label>
            {targets.length === 0 ? (
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>
                No {ROUTE_TYPE_LABELS[routeType].toLowerCase()}s available.
              </p>
            ) : (
              <select style={selectStyle} value={routeTarget} onChange={(e) => setRouteTarget(e.target.value)}>
                <option value="">— Unassigned —</option>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* ── Summary ── */}
        {(selected || (useManual && manualNumber)) && (
          <div style={{
            marginTop: 14, padding: "10px 14px", borderRadius: 10,
            background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.20)",
          }}>
            <p style={{ fontSize: 12, color: "#93c5fd", margin: 0 }}>
              Ready to provision: <strong style={{ fontFamily: "monospace" }}>{phoneNumber}</strong>
            </p>
          </div>
        )}

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
          <button
            onClick={handleProvision}
            disabled={saving || !phoneNumber.trim()}
            style={{
              flex: 2, padding: "11px 0", borderRadius: 12,
              background: saving || !phoneNumber.trim() ? "rgba(59,130,246,0.3)" : "#3b82f6", border: "none",
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: saving || !phoneNumber.trim() ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            {saving && <RefreshCw size={14} className="animate-spin" />}
            {saving ? "Provisioning…" : "Provision Number"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────────── */
export default function NumbersPage() {
  const { user } = useAuth();
  const isAdmin = (user as any)?.isAdmin === true;

  const [tab, setTab] = useState<Tab>("numbers");
  const [numbers, setNumbers] = useState<(AdminNumber & Record<string, any>)[]>([]);
  const [portReqs, setPortReqs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ringGroups, setRingGroups] = useState<RingGroup[]>([]);
  const [agents, setAgents]         = useState<AgentUser[]>([]);
  const [queues, setQueues]         = useState<Queue[]>([]);

  const [routeModalNum, setRouteModalNum]   = useState<AdminNumber | null>(null);
  const [showProvision, setShowProvision]   = useState(false);

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
        const raw: any[] = numData.value.numbers ?? numData.value.data ?? numData.value ?? [];
        setNumbers(raw);
      } else {
        setNumbers([]);
        setError((numData.reason as Error).message ?? "Failed to load numbers");
      }
      if (portData.status === "fulfilled") {
        setPortReqs(portData.value.data ?? portData.value.requests ?? portData.value ?? []);
      } else {
        setPortReqs([]);
      }

      if (isAdmin) {
        const [rgData, agData, qData] = await Promise.allSettled([
          apiFetchJson("/ring-groups"),
          apiFetchJson("/admin/users?limit=500"),
          apiFetchJson("/queues"),
        ]);
        if (rgData.status === "fulfilled") setRingGroups(rgData.value.ringGroups ?? []);
        if (agData.status === "fulfilled") setAgents(agData.value.users ?? []);
        if (qData.status === "fulfilled")  setQueues(qData.value.queues ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  /* resolve routeTargetName client-side from loaded agent/ring-group/queue data */
  const resolveTargetName = (n: AdminNumber): string | undefined => {
    if (!n.routeType || !n.routeTarget) return undefined;
    if (n.routeType === "agent") {
      if (n.user) return n.user.name || n.user.username;
      const ag = agents.find((a) => a._id === n.routeTarget);
      return ag ? agentLabel(ag) : n.routeTarget;
    }
    if (n.routeType === "ring_group") {
      const rg = ringGroups.find((g) => g.id === n.routeTarget || g._id === n.routeTarget);
      return rg?.name;
    }
    if (n.routeType === "queue") {
      const q = queues.find((q) => q.id === n.routeTarget || q._id === n.routeTarget);
      return q ? queueLabel(q) : n.routeTarget;
    }
    return undefined;
  };

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "numbers", label: "Phone Numbers", count: numbers.length },
    { key: "port",    label: "Port Requests",  count: portReqs.length },
  ];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {routeModalNum && (
        <SetRouteModal
          number={routeModalNum}
          ringGroups={ringGroups}
          agents={agents}
          queues={queues}
          onClose={() => setRouteModalNum(null)}
          onSaved={load}
        />
      )}
      {showProvision && (
        <ProvisionModal
          agents={agents}
          ringGroups={ringGroups}
          queues={queues}
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
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors">
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
            {numbers.map((n) => {
              const numId = n.id ?? n._id;
              const targetName = isAdmin ? resolveTargetName(n) : undefined;
              return (
                <div
                  key={numId}
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
                      {n.country ? ` · ${n.country}` : ""}
                      {n.source ? ` · ${n.source}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {isAdmin && (
                      <RouteBadge routeType={n.routeType} routeTargetName={targetName} />
                    )}
                    <StatusBadge status={n.status ?? "active"} />
                    {isAdmin && (
                      <button
                        onClick={() => setRouteModalNum({ ...n, id: numId })}
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
              );
            })}
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
