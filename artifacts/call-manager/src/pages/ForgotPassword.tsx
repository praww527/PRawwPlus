import { useState } from "react";
import { useLocation } from "wouter";
import { Phone, ArrowLeft, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { setError("Please enter your email"); return; }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to send reset email"); return; }
      setSent(true);
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
        <button
          onClick={() => setLocation("/login")}
          className="flex items-center gap-2 text-white/40 hover:text-white/70 mb-8 transition-colors text-sm"
        >
          <ArrowLeft className="h-4 w-4" /> Back to login
        </button>

        <div className="glass rounded-3xl p-8 border border-white/10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-56 h-56 bg-primary/8 rounded-full blur-[80px] pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
                <Phone className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-display font-bold text-white">CallManager</span>
            </div>

            {sent ? (
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center mx-auto mb-5">
                  <CheckCircle className="h-7 w-7 text-green-400" />
                </div>
                <h2 className="text-xl font-display font-bold text-white mb-2">Check your email</h2>
                <p className="text-white/55 text-sm mb-6">
                  If an account exists for <span className="text-primary">{email}</span>, we've sent a password reset link.
                </p>
                <Button
                  variant="ghost"
                  className="text-white/40 hover:text-white"
                  onClick={() => setLocation("/login")}
                >
                  Back to Login
                </Button>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-display font-bold text-white mb-1">Forgot password?</h1>
                <p className="text-white/45 text-sm mb-8">Enter your email and we'll send you a reset link</p>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-1.5">
                    <Label className="text-white/70 text-sm">Email Address</Label>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
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
                    disabled={loading}
                    className="w-full h-12 text-base bg-primary hover:bg-primary/90"
                  >
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send Reset Link"}
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
