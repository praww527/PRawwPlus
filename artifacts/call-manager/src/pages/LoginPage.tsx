import { useState } from "react";
import { useLocation } from "wouter";
import { Phone, Eye, EyeOff, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@workspace/replit-auth-web";

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
    setLoading(true);
    setError("");
    setUnverified(false);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === "email_not_verified") {
          setUnverified(true);
        } else {
          setError(data.error || "Login failed");
        }
        return;
      }

      refetch();
      setLocation("/");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    setResendLoading(true);
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });
      setResendDone(true);
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="fixed inset-0 bg-gradient-to-br from-blue-950/60 via-background to-indigo-950/40 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-2 text-white/40 hover:text-white/70 mb-8 transition-colors text-sm"
        >
          <ArrowLeft className="h-4 w-4" /> Back to home
        </button>

        <div className="glass rounded-3xl p-8 border border-white/10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-56 h-56 bg-primary/8 rounded-full blur-[80px] pointer-events-none" />

          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-lg shadow-primary/25">
                <Phone className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-display font-bold text-white">CallManager</span>
            </div>

            <h1 className="text-2xl font-display font-bold text-white mb-1">Welcome back</h1>
            <p className="text-white/45 text-sm mb-8">Sign in to your account</p>

            {unverified && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-4 mb-6">
                <p className="text-amber-400 text-sm font-medium mb-1">Email not verified</p>
                <p className="text-white/55 text-sm mb-3">Please verify your email before logging in.</p>
                {resendDone ? (
                  <p className="text-green-400 text-sm">Verification email resent! Check your inbox.</p>
                ) : (
                  <button
                    onClick={resendVerification}
                    disabled={resendLoading}
                    className="text-primary hover:text-primary/80 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {resendLoading ? "Sending…" : "Resend verification email"}
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label className="text-white/70 text-sm">Email Address</Label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50 focus:ring-primary/20"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-white/70 text-sm">Password</Label>
                  <button
                    type="button"
                    onClick={() => setLocation("/forgot-password")}
                    className="text-primary/70 hover:text-primary text-xs transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Your password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    required
                    className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50 focus:ring-primary/20 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 text-base bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign In"}
              </Button>
            </form>

            <p className="text-center text-sm text-white/40 mt-6">
              Don't have an account?{" "}
              <button onClick={() => setLocation("/signup")} className="text-primary hover:text-primary/80 font-medium transition-colors">
                Sign up free
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
