import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/apiFetch";
import { useAuth } from "@workspace/auth-web";
import { Building2, Loader2, CheckCircle2, AlertCircle, Shield, Users } from "lucide-react";

interface InviteDetails {
  valid: boolean;
  orgName: string;
  role: string;
  email: string;
}

export default function JoinTeamPage() {
  const [, navigate] = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  useEffect(() => {
    if (!token) {
      setFetchError("No invite token found. Check your invitation link.");
      return;
    }
    apiFetch(`/api/org/invite/${token}`)
      .then(async r => {
        if (r.ok) {
          setInvite(await r.json());
        } else {
          const d = await r.json().catch(() => ({}));
          setFetchError(d.error ?? "Invite not found or has expired.");
        }
      })
      .catch(() => setFetchError("Could not reach the server. Please try again."));
  }, [token]);

  const accept = async () => {
    setAccepting(true);
    setAcceptError(null);
    try {
      const r = await apiFetch("/api/org/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to accept invite");
      setAccepted(true);
      setTimeout(() => navigate("/team"), 2000);
    } catch (e: any) {
      setAcceptError(e.message);
    } finally {
      setAccepting(false);
    }
  };

  const goLogin = () => {
    sessionStorage.setItem("pendingInviteToken", token);
    navigate(`/login?redirect=/team/join?token=${encodeURIComponent(token)}`);
  };

  const goSignup = () => {
    sessionStorage.setItem("pendingInviteToken", token);
    navigate(`/signup?redirect=/team/join?token=${encodeURIComponent(token)}`);
  };

  return (
    <div style={{
      minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px 20px", boxSizing: "border-box",
      background: "var(--bg)",
    }}>
      <div style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Logo / Brand */}
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{
            width: 60, height: 60, borderRadius: 20, margin: "0 auto 12px",
            background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Building2 style={{ width: 28, height: 28, color: "#3b82f6" }} />
          </div>
          <p style={{ fontSize: 24, fontWeight: 800, color: "var(--text-1)", fontFamily: "var(--font-display)" }}>
            PRaww+
          </p>
          <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 4 }}>Team Invitation</p>
        </div>

        {/* Loading */}
        {!fetchError && !invite && (
          <div style={{
            background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
            borderRadius: 20, padding: "32px 20px", textAlign: "center",
          }}>
            <Loader2 style={{ width: 32, height: 32, color: "#3b82f6", margin: "0 auto 12px", animation: "spin 1s linear infinite" }} />
            <p style={{ color: "var(--text-2)", fontSize: 14 }}>Loading invitation…</p>
          </div>
        )}

        {/* Error */}
        {fetchError && (
          <div style={{
            background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.20)",
            borderRadius: 20, padding: "28px 20px", textAlign: "center",
          }}>
            <AlertCircle style={{ width: 36, height: 36, color: "#ff453a", margin: "0 auto 12px" }} />
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginBottom: 6 }}>Invalid Invitation</p>
            <p style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.5 }}>{fetchError}</p>
            <button
              onClick={() => navigate("/login")}
              style={{
                marginTop: 20, padding: "11px 28px", borderRadius: 12, fontWeight: 700,
                fontSize: 13, border: "none", cursor: "pointer",
                background: "#3b82f6", color: "#fff",
              }}
            >
              Go to Login
            </button>
          </div>
        )}

        {/* Success */}
        {accepted && (
          <div style={{
            background: "rgba(48,209,88,0.08)", border: "1px solid rgba(48,209,88,0.20)",
            borderRadius: 20, padding: "32px 20px", textAlign: "center",
          }}>
            <CheckCircle2 style={{ width: 44, height: 44, color: "#30d158", margin: "0 auto 12px" }} />
            <p style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)", marginBottom: 6 }}>
              Welcome to the team!
            </p>
            <p style={{ fontSize: 13, color: "var(--text-3)" }}>Redirecting to your team page…</p>
          </div>
        )}

        {/* Invite card */}
        {invite && !accepted && (
          <div style={{
            background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
            borderRadius: 20, padding: "24px 20px",
            display: "flex", flexDirection: "column", gap: 20,
          }}>
            {/* Org info */}
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 56, height: 56, borderRadius: 18, margin: "0 auto 12px",
                background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.20)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Users style={{ width: 24, height: 24, color: "#3b82f6" }} />
              </div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
                You've been invited to join
              </p>
              <p style={{ fontSize: 22, fontWeight: 800, color: "var(--text-1)", fontFamily: "var(--font-display)" }}>
                {invite.orgName}
              </p>
            </div>

            {/* Role badge */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                background: invite.role === "admin" ? "rgba(10,132,255,0.12)" : "rgba(99,99,102,0.12)",
                border: `1px solid ${invite.role === "admin" ? "rgba(10,132,255,0.25)" : "rgba(99,99,102,0.25)"}`,
                borderRadius: 20, padding: "6px 14px",
                color: invite.role === "admin" ? "#0a84ff" : "#aeaeb2",
                fontSize: 12, fontWeight: 700,
              }}>
                <Shield style={{ width: 13, height: 13 }} />
                {invite.role.charAt(0).toUpperCase() + invite.role.slice(1)} access
              </div>
            </div>

            {/* Invite address */}
            <div style={{
              background: "var(--input-bg)", border: "1px solid var(--glass-border)",
              borderRadius: 10, padding: "10px 14px", textAlign: "center",
            }}>
              <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 2 }}>Sent to</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>{invite.email}</p>
            </div>

            {/* Error */}
            {acceptError && (
              <div style={{
                background: "rgba(255,69,58,0.08)", border: "1px solid rgba(255,69,58,0.20)",
                borderRadius: 10, padding: "10px 14px", textAlign: "center",
              }}>
                <p style={{ fontSize: 13, color: "#ff453a" }}>{acceptError}</p>
              </div>
            )}

            {/* Actions */}
            {authLoading ? (
              <Loader2 style={{ width: 20, height: 20, color: "#3b82f6", margin: "0 auto", animation: "spin 1s linear infinite" }} />
            ) : isAuthenticated ? (
              <button
                onClick={accept}
                disabled={accepting}
                style={{
                  width: "100%", padding: "14px", borderRadius: 14, fontWeight: 700,
                  fontSize: 15, border: "none", cursor: accepting ? "wait" : "pointer",
                  background: "#3b82f6", color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {accepting && <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} />}
                {accepting ? "Joining…" : `Join ${invite.orgName}`}
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ textAlign: "center", fontSize: 12, color: "var(--text-3)" }}>
                  Sign in to accept this invitation
                </p>
                <button
                  onClick={goLogin}
                  style={{
                    width: "100%", padding: "13px", borderRadius: 12, fontWeight: 700,
                    fontSize: 14, border: "none", cursor: "pointer",
                    background: "#3b82f6", color: "#fff",
                  }}
                >
                  Log In to Accept
                </button>
                <button
                  onClick={goSignup}
                  style={{
                    width: "100%", padding: "13px", borderRadius: 12, fontWeight: 700,
                    fontSize: 14, cursor: "pointer",
                    background: "none", border: "1px solid var(--glass-border)",
                    color: "var(--text-2)",
                  }}
                >
                  Create Account
                </button>
              </div>
            )}
          </div>
        )}

        <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-4)" }}>
          This invitation expires in 7 days.
        </p>
      </div>
    </div>
  );
}
