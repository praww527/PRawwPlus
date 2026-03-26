import { useState } from "react";
import { useLocation } from "wouter";
import { Phone, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@workspace/auth-web";

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(""); setUnverified(false);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) { data.error === "email_not_verified" ? setUnverified(true) : setError(data.error || "Login failed"); return; }
      refetch(); setLocation("/");
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  };

  const resendVerification = async () => {
    setResendLoading(true);
    try { await fetch("/api/auth/resend-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.email }) }); setResendDone(true); }
    finally { setResendLoading(false); }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "14px 16px", borderRadius: 12,
    background: "var(--surface-2)", border: "1px solid var(--sep)",
    color: "var(--text-1)", fontSize: 16, outline: "none",
    fontFamily: "inherit",
  };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--surface-0)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: "hsl(var(--primary))",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 12px",
          }}>
            <Phone style={{ width: 26, height: 26, color: "#fff" }} />
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)", margin: 0 }}>PRaww+</h1>
          <p style={{ fontSize: 15, color: "var(--text-2)", marginTop: 4 }}>Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="section-card" style={{ padding: "0 0 4px" }}>
          {unverified && (
            <div style={{ margin: "0 0 2px", padding: "14px 20px", background: "rgba(255,214,10,0.08)", borderBottom: "1px solid var(--sep)" }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#ffd60a", marginBottom: 4 }}>Email not verified</p>
              <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 8 }}>Please verify your email before logging in.</p>
              {resendDone
                ? <p style={{ fontSize: 13, color: "#30d158" }}>Verification email resent!</p>
                : <button onClick={resendVerification} disabled={resendLoading} style={{ fontSize: 13, color: "hsl(var(--primary))", fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    {resendLoading ? "Sending…" : "Resend verification email"}
                  </button>}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div style={{ padding: "16px 20px 0" }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>Email</label>
              <input
                type="email" placeholder="you@example.com"
                value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required style={inputStyle}
              />
            </div>

            {/* Password */}
            <div style={{ padding: "14px 20px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Password</label>
                <button type="button" onClick={() => setLocation("/forgot-password")} style={{ fontSize: 13, color: "hsl(var(--primary))", fontWeight: 500, background: "none", border: "none", cursor: "pointer" }}>
                  Forgot?
                </button>
              </div>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"} placeholder="Your password"
                  value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required style={{ ...inputStyle, paddingRight: 48 }}
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer" }}>
                  {showPassword ? <EyeOff style={{ width: 18, height: 18, color: "var(--text-3)" }} /> : <Eye style={{ width: 18, height: 18, color: "var(--text-3)" }} />}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ margin: "12px 20px 0", padding: "12px 14px", borderRadius: 10, background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.20)" }}>
                <p style={{ fontSize: 13, color: "#ff453a" }}>{error}</p>
              </div>
            )}

            <div style={{ padding: "20px 20px 16px" }}>
              <button type="submit" disabled={loading} style={{
                width: "100%", padding: "14px 0", borderRadius: 12,
                background: "hsl(var(--primary))", border: "none",
                color: "#fff", fontSize: 16, fontWeight: 600,
                cursor: loading ? "default" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                opacity: loading ? 0.8 : 1,
              }}>
                {loading ? <><Loader2 style={{ width: 18, height: 18 }} className="animate-spin" /> Signing in…</> : "Sign In"}
              </button>
            </div>
          </form>
        </div>

        <p style={{ textAlign: "center", fontSize: 14, color: "var(--text-2)", marginTop: 20 }}>
          Don't have an account?{" "}
          <button onClick={() => setLocation("/signup")} style={{ color: "hsl(var(--primary))", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>
            Sign up free
          </button>
        </p>
      </div>
    </div>
  );
}
