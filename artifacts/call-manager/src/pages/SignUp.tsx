import { useState } from "react";
import { useLocation } from "wouter";
import { Phone, Eye, EyeOff, ArrowLeft, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignUp() {
  const [, setLocation] = useLocation();
  const [form, setForm] = useState({ email: "", password: "", confirmPassword: "", name: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const validate = () => {
    if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      return "Please enter a valid email address";
    }
    if (form.password.length < 8) return "Password must be at least 8 characters";
    if (form.password !== form.confirmPassword) return "Passwords do not match";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: form.email, password: form.password, name: form.name }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Sign up failed"); return; }
      setSuccess(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div
        className="flex items-center justify-center bg-background overflow-y-auto"
        style={{ minHeight: "100dvh", padding: "max(env(safe-area-inset-top,16px),24px) 16px max(env(safe-area-inset-bottom,16px),24px)" }}
      >
        <div className="fixed inset-0 bg-gradient-to-br from-blue-950/60 via-background to-indigo-950/40 pointer-events-none" />
        <div className="relative z-10 glass rounded-3xl p-8 max-w-md w-full border border-white/10 text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="h-8 w-8 text-green-400" />
          </div>
          <h2 className="text-2xl font-display font-bold text-white mb-3">Check your email</h2>
          <p className="text-white/55 mb-2">We sent a verification link to</p>
          <p className="text-primary font-medium mb-6">{form.email}</p>
          <p className="text-white/40 text-sm mb-8">Click the link in the email to activate your account. Check your spam folder if you don't see it.</p>
          <Button
            variant="outline"
            className="w-full border-white/15 text-white/70 hover:text-white hover:bg-white/5"
            onClick={async () => {
              await fetch("/api/auth/resend-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: form.email }),
              });
            }}
          >
            Resend verification email
          </Button>
          <Button
            variant="ghost"
            className="w-full mt-3 text-white/40 hover:text-white"
            onClick={() => setLocation("/login")}
          >
            Back to Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center bg-background overflow-y-auto"
      style={{ minHeight: "100dvh", padding: "max(env(safe-area-inset-top,16px),24px) 16px max(env(safe-area-inset-bottom,16px),24px)" }}
    >
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

            <h1 className="text-2xl font-display font-bold text-white mb-1">Create your account</h1>
            <p className="text-white/45 text-sm mb-8">Start making affordable calls in minutes</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label className="text-white/70 text-sm">Full Name <span className="text-white/30">(optional)</span></Label>
                <Input
                  type="text"
                  placeholder="Your name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50 focus:ring-primary/20"
                />
              </div>

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
                <Label className="text-white/70 text-sm">Password</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Min. 8 characters"
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
                {form.password && (
                  <div className="flex gap-1 mt-1.5">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          form.password.length >= i * 3
                            ? form.password.length >= 12 ? "bg-green-400" : form.password.length >= 8 ? "bg-amber-400" : "bg-red-400"
                            : "bg-white/10"
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-white/70 text-sm">Confirm Password</Label>
                <div className="relative">
                  <Input
                    type={showConfirm ? "text" : "password"}
                    placeholder="Repeat your password"
                    value={form.confirmPassword}
                    onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                    required
                    className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50 focus:ring-primary/20 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                  >
                    {showConfirm ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                  </button>
                </div>
                {form.confirmPassword && form.password !== form.confirmPassword && (
                  <p className="text-red-400 text-xs mt-1">Passwords do not match</p>
                )}
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
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create Account"}
              </Button>
            </form>

            <p className="text-center text-sm text-white/40 mt-6">
              Already have an account?{" "}
              <button onClick={() => setLocation("/login")} className="text-primary hover:text-primary/80 font-medium transition-colors">
                Log in
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
