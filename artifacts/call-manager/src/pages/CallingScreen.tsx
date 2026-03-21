import { useState, useEffect } from "react";
import { PhoneOff, Mic, MicOff, Keyboard, Volume2, VolumeX } from "lucide-react";
import { useCall } from "@/context/CallContext";
import { cn } from "@/lib/utils";

function formatDuration(secs: number) {
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function avatarInitials(info: { number: string; name?: string } | null) {
  if (!info) return "?";
  if (info.name) {
    const parts = info.name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return info.number.replace(/\D/g, "").slice(-2);
}

export default function CallingScreen() {
  const { callInfo, endCall } = useCall();
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const controls = [
    { icon: muted ? MicOff : Mic,        label: "Mute",    active: muted,      onPress: () => setMuted((v) => !v) },
    { icon: Keyboard,                     label: "Keypad",  active: showKeypad, onPress: () => setShowKeypad((v) => !v) },
    { icon: speaker ? Volume2 : VolumeX, label: "Speaker", active: speaker,    onPress: () => setSpeaker((v) => !v) },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center animate-in fade-in duration-300"
      style={{
        background: "linear-gradient(160deg,#0d1117 0%,#091628 55%,#050f20 100%)",
        paddingTop:    "env(safe-area-inset-top,44px)",
        paddingBottom: "env(safe-area-inset-bottom,34px)",
      }}
    >
      {/* ── Top info ── */}
      <div className="flex flex-col items-center mt-14 mb-6">
        <p className="text-white/45 text-sm tracking-widest uppercase font-medium mb-3">
          Calling…
        </p>
        <p className="text-white text-[32px] font-bold leading-tight">
          {callInfo?.name ?? callInfo?.number}
        </p>
        {callInfo?.name && (
          <p className="text-white/40 text-sm font-mono mt-1">{callInfo.number}</p>
        )}
        <p className="text-white/55 text-sm tabular-nums mt-2">{formatDuration(elapsed)}</p>
      </div>

      {/* ── Avatar ── */}
      <div className="flex-1 flex items-center justify-center">
        <div className="relative flex items-center justify-center">
          {/* pulse rings */}
          <div
            className="absolute rounded-full animate-ping opacity-15"
            style={{ width: 170, height: 170, background: "#34c759" }}
          />
          <div
            className="absolute rounded-full opacity-10"
            style={{ width: 200, height: 200, background: "#34c759", filter: "blur(20px)" }}
          />
          <div
            className="relative w-28 h-28 rounded-full flex items-center justify-center text-[30px] font-bold text-white select-none"
            style={{
              background: "linear-gradient(135deg,rgba(52,199,89,0.28),rgba(52,199,89,0.08))",
              border: "2px solid rgba(52,199,89,0.38)",
              boxShadow: "0 0 40px rgba(52,199,89,0.22)",
            }}
          >
            {avatarInitials(callInfo)}
          </div>
        </div>
      </div>

      {/* ── Secondary controls ── */}
      <div className="flex gap-10 mb-8">
        {controls.map(({ icon: Icon, label, active, onPress }) => (
          <div key={label} className="flex flex-col items-center gap-2">
            <button
              onClick={onPress}
              className={cn(
                "w-[60px] h-[60px] rounded-full flex items-center justify-center transition-all active:scale-90",
                active
                  ? "bg-white/22 border border-white/28"
                  : "bg-white/8 border border-white/12"
              )}
            >
              <Icon className="w-[22px] h-[22px] text-white" />
            </button>
            <span className="text-white/45 text-[11px] font-medium">{label}</span>
          </div>
        ))}
      </div>

      {/* ── End call ── */}
      <div className="flex flex-col items-center mb-8 gap-2">
        <button
          onClick={endCall}
          className="flex items-center justify-center rounded-full transition-all active:scale-90 hover:scale-105"
          style={{
            width: 82,
            height: 82,
            background: "#ff3b30",
            boxShadow: "0 6px 28px rgba(255,59,48,0.45)",
          }}
        >
          <PhoneOff className="text-white" style={{ width: 30, height: 30 }} />
        </button>
        <span className="text-white/35 text-xs font-medium">End Call</span>
      </div>
    </div>
  );
}
