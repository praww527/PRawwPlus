import { Phone, PhoneOff } from "lucide-react";
import { useCall } from "@/context/CallContext";

function avatarInitials(info: { number: string; name?: string } | null) {
  if (!info) return "?";
  if (info.name) {
    const parts = info.name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return info.number.replace(/\D/g, "").slice(-2);
}

export default function IncomingCallScreen() {
  const { callInfo, acceptCall, declineCall } = useCall();

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center animate-in slide-in-from-bottom duration-400"
      style={{
        background: "linear-gradient(160deg,#0d1117 0%,#091628 55%,#050f20 100%)",
        paddingTop:    "env(safe-area-inset-top,44px)",
        paddingBottom: "env(safe-area-inset-bottom,34px)",
      }}
    >
      {/* ── Top info ── */}
      <div className="flex flex-col items-center mt-14 mb-6">
        <p className="text-white/45 text-sm tracking-widest uppercase font-medium mb-3">
          Incoming Call
        </p>
        <p className="text-white text-[32px] font-bold leading-tight">
          {callInfo?.name ?? callInfo?.number}
        </p>
        {callInfo?.name && (
          <p className="text-white/40 text-sm font-mono mt-1">{callInfo.number}</p>
        )}
      </div>

      {/* ── Avatar with pulsing rings ── */}
      <div className="flex-1 flex items-center justify-center">
        <div className="relative flex items-center justify-center">
          <div
            className="absolute rounded-full animate-ping opacity-20"
            style={{ width: 175, height: 175, background: "#34c759", animationDuration: "1.6s" }}
          />
          <div
            className="absolute rounded-full animate-ping opacity-12"
            style={{ width: 210, height: 210, background: "#34c759", animationDuration: "2s", animationDelay: "0.5s" }}
          />
          <div
            className="absolute rounded-full opacity-10"
            style={{ width: 240, height: 240, background: "#34c759", filter: "blur(22px)" }}
          />
          <div
            className="relative w-28 h-28 rounded-full flex items-center justify-center text-[30px] font-bold text-white select-none"
            style={{
              background: "linear-gradient(135deg,rgba(52,199,89,0.24),rgba(52,199,89,0.07))",
              border: "2px solid rgba(52,199,89,0.35)",
              boxShadow: "0 0 44px rgba(52,199,89,0.2)",
            }}
          >
            {avatarInitials(callInfo)}
          </div>
        </div>
      </div>

      {/* ── Decline + Accept ── */}
      <div className="flex items-center justify-center gap-20 mb-14">
        {/* Decline */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={declineCall}
            className="flex items-center justify-center rounded-full transition-all active:scale-90"
            style={{
              width: 82,
              height: 82,
              background: "#ff3b30",
              boxShadow: "0 6px 24px rgba(255,59,48,0.42)",
            }}
          >
            <PhoneOff className="text-white" style={{ width: 30, height: 30 }} />
          </button>
          <span className="text-white/45 text-xs font-medium">Decline</span>
        </div>

        {/* Accept */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={acceptCall}
            className="relative flex items-center justify-center rounded-full transition-all active:scale-90"
            style={{
              width: 82,
              height: 82,
              background: "#34c759",
              boxShadow: "0 6px 28px rgba(52,199,89,0.52)",
            }}
          >
            {/* pulsing glow */}
            <span
              className="absolute inset-0 rounded-full animate-ping"
              style={{ background: "rgba(52,199,89,0.35)" }}
            />
            <Phone className="text-white relative z-10" style={{ width: 30, height: 30 }} />
          </button>
          <span className="text-white/45 text-xs font-medium">Accept</span>
        </div>
      </div>
    </div>
  );
}
