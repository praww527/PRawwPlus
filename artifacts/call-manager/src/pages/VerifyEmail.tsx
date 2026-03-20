import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@workspace/replit-auth-web";

export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { refetch } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(search);
    const token = params.get("token");

    if (!token) {
      setStatus("error");
      setMessage("No verification token found in the link.");
      return;
    }

    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.message) {
          setStatus("success");
          setMessage(data.message);
          refetch();
        } else {
          setStatus("error");
          setMessage(data.error || "Verification failed");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Network error. Please try again.");
      });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="fixed inset-0 bg-gradient-to-br from-blue-950/60 via-background to-indigo-950/40 pointer-events-none" />
      <div className="relative z-10 glass rounded-3xl p-10 max-w-md w-full border border-white/10 text-center">
        {status === "loading" && (
          <>
            <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-5" />
            <h2 className="text-xl font-display font-bold text-white mb-2">Verifying your email…</h2>
            <p className="text-white/45 text-sm">Please wait a moment.</p>
          </>
        )}
        {status === "success" && (
          <>
            <div className="w-16 h-16 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="h-8 w-8 text-green-400" />
            </div>
            <h2 className="text-2xl font-display font-bold text-white mb-3">Email verified!</h2>
            <p className="text-white/55 mb-8">{message}</p>
            <Button
              className="w-full h-12 bg-primary hover:bg-primary/90"
              onClick={() => setLocation("/")}
            >
              Go to Dashboard
            </Button>
          </>
        )}
        {status === "error" && (
          <>
            <div className="w-16 h-16 rounded-full bg-red-500/15 border border-red-500/25 flex items-center justify-center mx-auto mb-6">
              <XCircle className="h-8 w-8 text-red-400" />
            </div>
            <h2 className="text-2xl font-display font-bold text-white mb-3">Verification failed</h2>
            <p className="text-white/55 mb-8">{message}</p>
            <Button
              variant="outline"
              className="w-full h-12 border-white/15 text-white/70 hover:text-white hover:bg-white/5"
              onClick={() => setLocation("/login")}
            >
              Back to Login
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
