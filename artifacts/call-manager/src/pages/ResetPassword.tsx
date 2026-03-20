import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Phone, Eye, EyeOff, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";

  const [form, setForm] = useState({ password: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (form.password !== form.confirmPassword) { setError("Passwords do not match"); return; }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: form.password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Reset failed"); return; }
      setDone(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="fixed inset-0 bg-gradient-to-br from-blue-950/60 via-background to-indigo-950/40 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        <div className="glass rounded-3xl p-8 border border-white/10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-56 h-56 bg-primary/8 rounded-full blur-[80px] pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
                <Phone className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-display font-bold text-white">CallManager</span>
            </div>

            {done ? (
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center mx-auto mb-5">
                  <CheckCircle className="h-7 w-7 text-green-400" />
                </div>
                <h2 className="text-xl font-display font-bold text-white mb-2">Password updated!</h2>
                <p className="text-white/55 text-sm mb-6">Your password has been reset. You can now log in.</p>
                <Button
                  className="w-full h-12 bg-primary hover:bg-primary/90"
                  onClick={() => setLocation("/login")}
                >
                  Go to Login
                </Button>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-display font-bold text-white mb-1">Reset password</h1>
                <p className="text-white/45 text-sm mb-8">Choose a new password for your account</p>

                {!token && (
                  <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm mb-5">
                    Invalid or expired reset link. Please request a new one.
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-1.5">
                    <Label className="text-white/70 text-sm">New Password</Label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="Min. 8 characters"
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        required
                        className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50 pr-11"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                      >
                        {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-white/70 text-sm">Confirm Password</Label>
                    <Input
                      type="password"
                      placeholder="Repeat your new password"
                      value={form.confirmPassword}
                      onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                      required
                      className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50"
                    />
                  </div>

                  {error && (
                    <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
                      {error}
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={loading || !token}
                    className="w-full h-12 text-base bg-primary hover:bg-primary/90"
                  >
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Reset Password"}
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
