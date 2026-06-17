import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Users, Plus, Trash2, Edit2, X, RefreshCw, ChevronLeft } from "lucide-react";

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function adminFetch(path: string, opts?: RequestInit) {
  const method = (opts?.method ?? "GET").toUpperCase();
  const csrfHeaders: Record<string, string> =
    ["POST", "PUT", "PATCH", "DELETE"].includes(method)
      ? { "X-CSRF-Token": getCsrfToken() }
      : {};
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders, ...(opts?.headers ?? {}) },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

type Strategy = "ring-all" | "round-robin";

interface AgentUser {
  _id: string;
  name?: string;
  username?: string;
  extension?: string;
}

interface RingGroup {
  id: string;
  _id: string;
  name: string;
  strategy: Strategy;
  description?: string;
  active: boolean;
  members: string[];
  memberUsers: AgentUser[];
}

const STRATEGY_LABELS: Record<Strategy, string> = {
  "ring-all":     "Ring All (simultaneous)",
  "round-robin":  "Round-Robin (sequential)",
};

function agentLabel(u: AgentUser) {
  return u.name || u.username || u._id;
}

function Badge({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 20,
      background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.3)",
      fontSize: 12, fontWeight: 600, color: "#93c5fd",
    }}>
      {label}
      {onRemove && (
        <button onClick={onRemove} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "#93c5fd" }}>
          <X size={11} />
        </button>
      )}
    </span>
  );
}

interface GroupModalProps {
  group: RingGroup | null;
  agents: AgentUser[];
  onClose: () => void;
  onSave: () => void;
}

function GroupModal({ group, agents, onClose, onSave }: GroupModalProps) {
  const [name, setName] = useState(group?.name ?? "");
  const [strategy, setStrategy] = useState<Strategy>(group?.strategy ?? "ring-all");
  const [description, setDescription] = useState(group?.description ?? "");
  const [memberIds, setMemberIds] = useState<string[]>(group?.members ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleMember = (uid: string) => {
    setMemberIds((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      if (group) {
        await adminFetch(`/ring-groups/${group.id}`, {
          method: "PUT",
          body: JSON.stringify({ name: name.trim(), strategy, description: description.trim(), members: memberIds }),
        });
      } else {
        await adminFetch("/ring-groups", {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), strategy, description: description.trim(), members: memberIds }),
        });
      }
      onSave();
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const selectedAgents = agents.filter((a) => memberIds.includes(a._id));
  const unselectedAgents = agents.filter((a) => !memberIds.includes(a._id));

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 14px", borderRadius: 10,
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
    color: "rgba(255,255,255,0.9)", fontSize: 14, outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000, display: "flex",
      alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.65)", padding: "20px",
    }}>
      <div style={{
        background: "rgba(20,20,28,0.98)", border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 18, padding: 28, width: "100%", maxWidth: 520,
        maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: 0 }}>
            {group ? "Edit Ring Group" : "New Ring Group"}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", display: "flex" }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>
              Group Name *
            </label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales Team" />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>
              Strategy
            </label>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as Strategy)}
            >
              {(Object.keys(STRATEGY_LABELS) as Strategy[]).map((s) => (
                <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 }}>
              Description
            </label>
            <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 8 }}>
              Members ({memberIds.length} selected)
            </label>
            {selectedAgents.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {selectedAgents.map((a) => (
                  <Badge key={a._id} label={agentLabel(a)} onRemove={() => toggleMember(a._id)} />
                ))}
              </div>
            )}
            <div style={{
              maxHeight: 180, overflowY: "auto",
              border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10,
              background: "rgba(255,255,255,0.03)",
            }}>
              {agents.length === 0 && (
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", padding: "12px 14px", margin: 0 }}>No agents available</p>
              )}
              {unselectedAgents.map((a) => (
                <button
                  key={a._id}
                  onClick={() => toggleMember(a._id)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 14px", background: "none", border: "none",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    cursor: "pointer", textAlign: "left",
                  }}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: "rgba(96,165,250,0.15)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700, color: "#93c5fd", flexShrink: 0,
                  }}>
                    {agentLabel(a).slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)", margin: 0 }}>{agentLabel(a)}</p>
                  </div>
                  <Plus size={14} style={{ color: "rgba(255,255,255,0.3)" }} />
                </button>
              ))}
              {unselectedAgents.length === 0 && agents.length > 0 && (
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", padding: "12px 14px", margin: 0 }}>All agents added</p>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 14, padding: "9px 14px", borderRadius: 9, background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.25)" }}>
            <p style={{ fontSize: 12, color: "#f87171", margin: 0 }}>{error}</p>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "11px 0", borderRadius: 12,
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)",
            color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 2, padding: "11px 0", borderRadius: 12,
            background: saving ? "rgba(96,165,250,0.3)" : "#3b82f6", border: "none",
            color: "#fff", fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            {saving && <RefreshCw size={14} className="animate-spin" />}
            {saving ? "Saving…" : (group ? "Save Changes" : "Create Group")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RingGroupsPage() {
  const [, setLocation] = useLocation();
  const [groups, setGroups] = useState<RingGroup[]>([]);
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalGroup, setModalGroup] = useState<RingGroup | null | false>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [gData, uData] = await Promise.allSettled([
        adminFetch("/ring-groups"),
        adminFetch("/admin/users?limit=500"),
      ]);
      if (gData.status === "fulfilled") setGroups(gData.value.ringGroups ?? []);
      else setError((gData.reason as Error).message);
      if (uData.status === "fulfilled") {
        const all = uData.value.users ?? [];
        setAgents(all.filter((u: any) => u.extension || u.role === "agent"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (g: RingGroup) => {
    if (!confirm(`Delete ring group "${g.name}"? DIDs routed to this group will stop working.`)) return;
    setDeletingId(g.id);
    try {
      await adminFetch(`/ring-groups/${g.id}`, { method: "DELETE" });
      setGroups((prev) => prev.filter((x) => x.id !== g.id));
    } catch (err: any) {
      alert(err.message ?? "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  const rowStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 12, padding: "14px 18px",
    display: "flex", alignItems: "center", gap: 14,
  };

  return (
    <div style={{ padding: "24px 20px", maxWidth: 860, margin: "0 auto" }}>
      {modalGroup !== false && (
        <GroupModal
          group={modalGroup}
          agents={agents}
          onClose={() => setModalGroup(false)}
          onSave={load}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => setLocation("/admin")}
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", display: "flex", padding: 0 }}
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,0.95)", margin: 0 }}>
              Ring Groups
            </h1>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "3px 0 0" }}>
              {groups.length} group{groups.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600,
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)",
              color: "rgba(255,255,255,0.6)", cursor: loading ? "wait" : "pointer",
              display: "flex", alignItems: "center", gap: 6, opacity: loading ? 0.6 : 1,
            }}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button
            onClick={() => setModalGroup(null)}
            style={{
              padding: "8px 16px", borderRadius: 10, fontSize: 12, fontWeight: 600,
              background: "#3b82f6", border: "none", color: "#fff", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <Plus size={13} />
            New Group
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.25)", marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: "#f87171", margin: 0 }}>{error}</p>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
          Loading…
        </div>
      ) : groups.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "60px 20px",
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 14,
        }}>
          <Users size={32} style={{ color: "rgba(255,255,255,0.15)", marginBottom: 12 }} />
          <p style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.5)", margin: "0 0 4px" }}>No ring groups yet</p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", margin: 0 }}>Create one to route DIDs to multiple agents.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groups.map((g) => (
            <div key={g.id} style={rowStyle}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: g.active ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.06)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <Users size={18} style={{ color: g.active ? "#93c5fd" : "rgba(255,255,255,0.3)" }} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: 0 }}>{g.name}</p>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                    background: g.strategy === "ring-all" ? "rgba(52,211,153,0.12)" : "rgba(245,158,11,0.12)",
                    color: g.strategy === "ring-all" ? "#34d399" : "#f59e0b",
                    border: `1px solid ${g.strategy === "ring-all" ? "rgba(52,211,153,0.25)" : "rgba(245,158,11,0.25)"}`,
                  }}>
                    {STRATEGY_LABELS[g.strategy] ?? g.strategy}
                  </span>
                  {!g.active && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
                      Inactive
                    </span>
                  )}
                </div>
                {g.description && (
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: "2px 0 0" }}>{g.description}</p>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                  {g.memberUsers.length === 0 ? (
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>No members</span>
                  ) : (
                    g.memberUsers.slice(0, 6).map((u) => (
                      <span key={u._id} style={{
                        fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
                        background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)",
                      }}>
                        {agentLabel(u)}
                      </span>
                    ))
                  )}
                  {g.memberUsers.length > 6 && (
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>+{g.memberUsers.length - 6} more</span>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => setModalGroup(g)}
                  style={{
                    padding: "7px 12px", borderRadius: 9, fontSize: 12, fontWeight: 600,
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)",
                    color: "rgba(255,255,255,0.6)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                  }}
                >
                  <Edit2 size={13} />
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(g)}
                  disabled={deletingId === g.id}
                  style={{
                    padding: "7px 12px", borderRadius: 9, fontSize: 12, fontWeight: 600,
                    background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.20)",
                    color: "#f87171", cursor: deletingId === g.id ? "wait" : "pointer",
                    display: "flex", alignItems: "center", gap: 5,
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
