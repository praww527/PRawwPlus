import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiFetch";
import {
  Users, Plus, X, Mail, Shield, Crown, UserMinus, LogOut,
  Building2, Loader2, Copy, Check, Clock,
} from "lucide-react";

interface OrgMember {
  id: string;
  name: string;
  email: string;
  username?: string;
  orgRole: "owner" | "admin" | "member";
  coins?: number;
  totalCallsUsed?: number;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

interface Org {
  _id: string;
  name: string;
  ownerId: string;
  coins?: number;
}

interface OrgState {
  org: Org | null;
  role: "owner" | "admin" | "member" | null;
  members: OrgMember[];
  pendingInvites: PendingInvite[];
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  owner: <Crown style={{ width: 12, height: 12 }} />,
  admin: <Shield style={{ width: 12, height: 12 }} />,
  member: null,
};

const ROLE_COLORS: Record<string, string> = {
  owner:  "rgba(255,214,10,0.15)",
  admin:  "rgba(10,132,255,0.15)",
  member: "rgba(99,99,102,0.15)",
};

const ROLE_TEXT: Record<string, string> = {
  owner:  "#ffd60a",
  admin:  "#0a84ff",
  member: "#aeaeb2",
};

function avatarGradient(name: string) {
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const colors = [
    ["#3b82f6","#1d4ed8"], ["#8b5cf6","#5b21b6"], ["#06b6d4","#0e7490"],
    ["#10b981","#047857"], ["#f59e0b","#b45309"], ["#ef4444","#b91c1c"],
    ["#ec4899","#9d174d"], ["#6366f1","#3730a3"],
  ];
  return colors[hash % colors.length];
}

export default function TeamPage() {
  const { toast } = useToast();
  const [state, setState] = useState<OrgState | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviting, setInviting] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiFetch("/api/org/me");
      if (r.ok) {
        const data = await r.json();
        setState(data);
      }
    } catch (e) {
      toast({ title: "Failed to load team", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createOrg = async () => {
    if (!orgName.trim()) return;
    setCreating(true);
    try {
      const r = await apiFetch("/api/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: orgName.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to create organisation");
      toast({ title: "Organisation created!" });
      setOrgName("");
      await load();
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const invite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const r = await apiFetch("/api/org/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to send invite");
      toast({ title: `Invite sent to ${inviteEmail.trim()}` });
      setInviteEmail("");
      setShowInviteForm(false);
      await load();
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setInviting(false);
    }
  };

  const removeMember = async (memberId: string, name: string) => {
    setRemovingId(memberId);
    try {
      const r = await apiFetch(`/api/org/members/${memberId}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to remove member");
      toast({ title: `${name} removed from team` });
      await load();
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setRemovingId(null);
    }
  };

  const leaveOrg = async () => {
    setLeaving(true);
    try {
      const r = await apiFetch("/api/org/leave", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to leave organisation");
      toast({ title: "You have left the organisation" });
      await load();
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setLeaving(false);
    }
  };

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/team/join?token=${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  if (loading) {
    return (
      <div className="page-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 10 }} />
          <div className="skeleton" style={{ width: 100, height: 22, borderRadius: 8 }} />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton" style={{ width: "100%", height: 64, borderRadius: 16 }} />
        ))}
      </div>
    );
  }

  if (!state?.org) {
    return (
      <div className="page-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 12,
            background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Building2 style={{ width: 18, height: 18, color: "#3b82f6" }} />
          </div>
          <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)" }}>
            Team
          </p>
        </div>

        <div style={{
          background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
          borderRadius: 20, padding: "28px 20px", textAlign: "center",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 20,
            background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.20)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Users style={{ width: 28, height: 28, color: "#3b82f6" }} />
          </div>
          <div>
            <p style={{ fontSize: 17, fontWeight: 700, color: "var(--text-1)", marginBottom: 6 }}>
              Create your organisation
            </p>
            <p style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.5 }}>
              Set up a team to invite colleagues and manage your business communications together.
            </p>
          </div>

          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
            <input
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createOrg()}
              placeholder="Company or team name"
              style={{
                width: "100%", padding: "12px 16px", borderRadius: 12, boxSizing: "border-box",
                background: "var(--input-bg)", border: "1px solid var(--glass-border)",
                color: "var(--text-1)", fontSize: 15, outline: "none",
              }}
            />
            <button
              onClick={createOrg}
              disabled={creating || !orgName.trim()}
              style={{
                width: "100%", padding: "13px", borderRadius: 12, fontWeight: 700,
                fontSize: 15, border: "none", cursor: creating ? "wait" : "pointer",
                background: orgName.trim() ? "#3b82f6" : "rgba(59,130,246,0.25)",
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                transition: "background 0.2s",
              }}
            >
              {creating ? <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} /> : <Plus style={{ width: 16, height: 16 }} />}
              {creating ? "Creating…" : "Create Organisation"}
            </button>
          </div>
        </div>

        <p style={{ fontSize: 12, color: "var(--text-4)", textAlign: "center", paddingBottom: 8 }}>
          Already have an invite?{" "}
          <a href="/team/join" style={{ color: "#3b82f6", textDecoration: "none" }}>Accept it here</a>
        </p>
      </div>
    );
  }

  const { org, role, members, pendingInvites } = state;
  const isOwnerOrAdmin = role === "owner" || role === "admin";
  return (
    <div className="page-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 12,
          background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.25)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Building2 style={{ width: 18, height: 18, color: "#3b82f6" }} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)" }}>
            {org.name}
          </p>
          <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
            {members.length} member{members.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          background: ROLE_COLORS[role ?? "member"],
          border: `1px solid ${ROLE_TEXT[role ?? "member"]}33`,
          borderRadius: 20, padding: "4px 10px",
          color: ROLE_TEXT[role ?? "member"], fontSize: 11, fontWeight: 700,
        }}>
          {ROLE_ICONS[role ?? "member"]}
          {role ? role.charAt(0).toUpperCase() + role.slice(1) : ""}
        </div>
      </div>

      {/* Invite button (owners/admins) */}
      {isOwnerOrAdmin && (
        <button
          onClick={() => setShowInviteForm(!showInviteForm)}
          style={{
            width: "100%", padding: "13px", borderRadius: 14, fontWeight: 700,
            fontSize: 14, border: "none", cursor: "pointer",
            background: showInviteForm ? "rgba(59,130,246,0.12)" : "#3b82f6",
            color: showInviteForm ? "#3b82f6" : "#fff",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: "background 0.2s",
          }}
        >
          {showInviteForm
            ? <><X style={{ width: 16, height: 16 }} /> Cancel</>
            : <><Mail style={{ width: 16, height: 16 }} /> Invite Team Member</>
          }
        </button>
      )}

      {/* Invite form */}
      {showInviteForm && (
        <div style={{
          background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
          borderRadius: 16, padding: "16px",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <input
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && invite()}
            placeholder="colleague@company.co.za"
            type="email"
            style={{
              width: "100%", padding: "11px 14px", borderRadius: 10, boxSizing: "border-box",
              background: "var(--input-bg)", border: "1px solid var(--glass-border)",
              color: "var(--text-1)", fontSize: 14, outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as any)}
              style={{
                flex: 1, padding: "10px 12px", borderRadius: 10,
                background: "var(--input-bg)", border: "1px solid var(--glass-border)",
                color: "var(--text-1)", fontSize: 13, outline: "none",
              }}
            >
              <option value="member">Member</option>
              {role === "owner" && <option value="admin">Admin</option>}
            </select>
            <button
              onClick={invite}
              disabled={inviting || !inviteEmail.trim()}
              style={{
                flex: 2, padding: "10px 16px", borderRadius: 10, fontWeight: 700,
                fontSize: 13, border: "none", cursor: inviting ? "wait" : "pointer",
                background: inviteEmail.trim() ? "#3b82f6" : "rgba(59,130,246,0.25)",
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              {inviting ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> : <Mail style={{ width: 14, height: 14 }} />}
              {inviting ? "Sending…" : "Send Invite"}
            </button>
          </div>
        </div>
      )}

      {/* Pending invites */}
      {isOwnerOrAdmin && pendingInvites.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.06em", textTransform: "uppercase", padding: "0 2px" }}>
            Pending Invites
          </p>
          {pendingInvites.map(inv => (
            <div key={inv.id} style={{
              background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
              borderRadius: 14, padding: "12px 14px",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                background: "rgba(255,159,10,0.12)", border: "1px solid rgba(255,159,10,0.20)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Clock style={{ width: 16, height: 16, color: "#ff9f0a" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {inv.email}
                </p>
                <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
                  {inv.role} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => copyInviteLink(inv.id)}
                title="Copy invite link"
                style={{
                  background: "none", border: "none", cursor: "pointer", padding: 6,
                  color: copied === inv.id ? "#30d158" : "var(--text-3)",
                  display: "flex", alignItems: "center",
                }}
              >
                {copied === inv.id
                  ? <Check style={{ width: 15, height: 15 }} />
                  : <Copy style={{ width: 15, height: 15 }} />
                }
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Members list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.06em", textTransform: "uppercase", padding: "0 2px" }}>
          Members
        </p>
        {members.map(member => {
          const [from, to] = avatarGradient(member.name || member.email);
          return (
            <div key={member.id} style={{
              background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
              borderRadius: 14, padding: "12px 14px",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                background: `linear-gradient(135deg, ${from}, ${to})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 15, fontWeight: 700, color: "#fff",
              }}>
                {(member.name || member.email).charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {member.name || member.username || member.email}
                </p>
                <p style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {member.email}
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: ROLE_COLORS[member.orgRole],
                  border: `1px solid ${ROLE_TEXT[member.orgRole]}33`,
                  borderRadius: 20, padding: "3px 8px",
                  color: ROLE_TEXT[member.orgRole], fontSize: 10, fontWeight: 700,
                }}>
                  {ROLE_ICONS[member.orgRole]}
                  {member.orgRole.charAt(0).toUpperCase() + member.orgRole.slice(1)}
                </div>
                {isOwnerOrAdmin && member.orgRole !== "owner" && (
                  <button
                    onClick={() => removeMember(member.id, member.name || member.email)}
                    disabled={removingId === member.id}
                    title="Remove from team"
                    style={{
                      background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.20)",
                      borderRadius: 8, padding: "5px 7px", cursor: "pointer", display: "flex", alignItems: "center",
                    }}
                  >
                    {removingId === member.id
                      ? <Loader2 style={{ width: 12, height: 12, color: "#ff453a", animation: "spin 1s linear infinite" }} />
                      : <UserMinus style={{ width: 12, height: 12, color: "#ff453a" }} />
                    }
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Leave org (non-owners) */}
      {role !== "owner" && (
        <button
          onClick={leaveOrg}
          disabled={leaving}
          style={{
            width: "100%", padding: "12px", borderRadius: 12, fontWeight: 700,
            fontSize: 13, cursor: leaving ? "wait" : "pointer", marginTop: 4,
            background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.18)",
            color: "#ff453a", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          {leaving
            ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
            : <LogOut style={{ width: 14, height: 14 }} />
          }
          {leaving ? "Leaving…" : "Leave Organisation"}
        </button>
      )}
    </div>
  );
}
