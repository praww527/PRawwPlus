import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import logoImg from "/logo.png";
import { useAuth } from "@workspace/auth-web";

const EMAIL_LINK_TTL = 180;

const iosInput: React.CSSProperties = {
  width: "100%",
  padding: "13px 16px",
  borderRadius: 10,
  background: "rgba(118,118,128,0.24)",
  border: "none",
  color: "#FFFFFF",
  fontSize: 17,
  outline: "none",
  fontFamily: "-apple-system, 'SF Pro Text', 'Inter', sans-serif",
  WebkitAppearance: "none",
  appearance: "none",
};

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { refetch } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unverified, setUnverified] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [resendCountdown, setResendCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (resendCountdown === null || resendCountdown <= 0) return;
    const id = setTimeout(() => setResendCountdown((c) => (c !== null && c > 0 ? c - 1 : 0)), 1000);
    return () => clearTimeout(id);
  }, [resendCountdown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(""); setUnverified(false);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "email_not_verified") { setUnverified(true); }
        else if (data.error === "account_locked") { setError("Your account has been locked. Please contact support to unlock it."); }
        else { setError(data.message || data.error || "Login failed"); }
        return;
      }
      refetch(); setLocation("/");
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  };

  const resendVerification = async () => {
    setResendLoading(true); setResendDone(false);
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });
      setResendDone(true);
      setResendCountdown(EMAIL_LINK_TTL);
    } finally { setResendLoading(false); }
  };

  return (
    <div style={{
      minHeight: "100dvh",
      background: "#000000",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px 16px",
      fontFamily: "-apple-system, 'SF Pro Text', 'Inter', sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 390 }}>

        {/* Logo + Title */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            width: 80, height: 80, borderRadius: 20,
            background: "rgba(118,118,128,0.24)",
            margin: "0 auto 16px",
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden",
          }}>
            <img src={logoImg} alt="PRaww+" style={{ width: 64, height: 64, objectFit: "contain" }} />
          </div>
          <h1 style={{
            fontSize: 34, fontWeight: 700, color: "#FFFFFF",
            margin: 0, letterSpacing: "-0.4px",
            fontFamily: "-apple-system, 'SF Pro Display', sans-serif",
          }}>
            PRaww+
          </h1>
          <p style={{ fontSize: 15, color: "rgba(235,235,245,0.6)", marginTop: 4 }}>
            Business VoIP · South Africa
          </p>
        </div>

        {/* Email unverified banner */}
        {unverified && (
          <div style={{
            marginBottom: 16, padding: "14px 16px",
            borderRadius: 12, background: "rgba(255,214,10,0.12)",
            border: "1px solid rgba(255,214,10,0.3)",
          }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#FFD60A", marginBottom: 4 }}>Email not verified</p>
            <p style={{ fontSize: 13, color: "rgba(235,235,245,0.65)", marginBottom: 8 }}>
              Please verify your email before logging in.
            </p>
            {resendDone && resendCountdown !== null && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 10px", borderRadius: 8, marginBottom: 8,
                background: resendCountdown === 0
                  ? "rgba(255,69,58,0.12)"
                  : resendCountdown <= 30
                    ? "rgba(255,149,0,0.12)"
                    : "rgba(48,209,88,0.12)",
              }}>
                {resendCountdown === 0 ? (
                  <p style={{ fontSize: 12, color: "#FF453A", fontWeight: 600 }}>Link expired — resend a new one</p>
                ) : (
                  <>
                    <p style={{ fontSize: 12, color: resendCountdown <= 30 ? "#FF9500" : "#30D158" }}>Link sent! Expires in</p>
                    <p style={{
                      fontSize: 13, fontWeight: 700, fontFamily: "monospace",
                      color: resendCountdown <= 30 ? "#FF453A" : "#30D158",
                    }}>
                      {Math.floor(resendCountdown / 60)}:{String(resendCountdown % 60).padStart(2, "0")}
                    </p>
                  </>
                )}
              </div>
            )}
            <button
              onClick={resendVerification}
              disabled={resendLoading}
              style={{
                fontSize: 13, color: "#007AFF", fontWeight: 600,
                background: "none", border: "none", cursor: resendLoading ? "default" : "pointer",
                padding: 0, opacity: resendLoading ? 0.6 : 1,
              }}
            >
              {resendLoading ? "Sending…" : resendDone ? "Resend again" : "Resend verification email"}
            </button>
          </div>
        )}

        {/* Form card */}
        <div style={{
          background: "rgba(28,28,30,1)",
          borderRadius: 16,
          overflow: "hidden",
          marginBottom: 16,
        }}>
          <form onSubmit={handleSubmit}>
            {/* Email field */}
            <div style={{ padding: "14px 16px 0" }}>
              <label style={{
                display: "block", fontSize: 12, fontWeight: 600,
                color: "rgba(235,235,245,0.6)", textTransform: "uppercase",
                letterSpacing: "0.05em", marginBottom: 6,
              }}>
                Email
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
                style={iosInput}
              />
            </div>

            {/* Separator */}
            <div style={{ height: "0.5px", background: "rgba(84,84,88,0.65)", margin: "14px 16px 0" }} />

            {/* Password field */}
            <div style={{ padding: "14px 16px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{
                  fontSize: 12, fontWeight: 600,
                  color: "rgba(235,235,245,0.6)", textTransform: "uppercase", letterSpacing: "0.05em",
                }}>
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setLocation("/forgot-password")}
                  style={{
                    fontSize: 13, color: "#007AFF", fontWeight: 500,
                    background: "none", border: "none", cursor: "pointer",
                  }}
                >
                  Forgot?
                </button>
              </div>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Your password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  style={{ ...iosInput, paddingRight: 48 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  style={{
                    position: "absolute", right: 14, top: "50%",
                    transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer",
                    display: "flex", alignItems: "center",
                  }}
                >
                  {showPassword
                    ? <EyeOff style={{ width: 18, height: 18, color: "rgba(235,235,245,0.4)" }} />
                    : <Eye style={{ width: 18, height: 18, color: "rgba(235,235,245,0.4)" }} />
                  }
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                margin: "12px 16px 0",
                padding: "11px 14px", borderRadius: 10,
                background: "rgba(255,69,58,0.12)",
                border: "0.5px solid rgba(255,69,58,0.3)",
              }}>
                <p style={{ fontSize: 13, color: "#FF453A", margin: 0 }}>{error}</p>
              </div>
            )}

            {/* Sign In button */}
            <div style={{ padding: "20px 16px 16px" }}>
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "15px 0",
                  borderRadius: 12,
                  background: "#007AFF",
                  border: "none",
                  color: "#FFFFFF",
                  fontSize: 17,
                  fontWeight: 600,
                  cursor: loading ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  opacity: loading ? 0.75 : 1,
                  fontFamily: "inherit",
                  transition: "opacity 0.2s",
                  boxShadow: "0 2px 20px rgba(0,122,255,0.4)",
                }}
                onPointerDown={(e) => { if (!loading) e.currentTarget.style.opacity = "0.8"; }}
                onPointerUp={(e) => { e.currentTarget.style.opacity = "1"; }}
                onPointerLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
              >
                {loading
                  ? <><Loader2 style={{ width: 18, height: 18 }} className="animate-spin" /> Signing in…</>
                  : "Sign In"
                }
              </button>
            </div>
          </form>
        </div>

        {/* Sign up link */}
        <p style={{ textAlign: "center", fontSize: 15, color: "rgba(235,235,245,0.55)" }}>
          Don't have an account?{" "}
          <button
            onClick={() => setLocation("/signup")}
            style={{
              color: "#007AFF", fontWeight: 600,
              background: "none", border: "none", cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Sign up free
          </button>
        </p>

      </div>
    </div>
  );
}
