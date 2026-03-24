import { useState, useEffect, useRef } from "react";
import { PhoneOff, Mic, MicOff, Keyboard, Volume2, VolumeX } from "lucide-react";
import { useCall } from "@/context/CallContext";
import { useEndCall } from "@workspace/api-client-react";
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
  const { callInfo, callPhase, endCall, setMuted, setSpeaker } = useCall();
  const { mutateAsync: signalEndCall } = useEndCall();
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMutedState] = useState(false);
  const [speaker, setSpeakerState] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (callPhase === "connected") {
      startTimeRef.current = Date.now();
      intervalRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (callPhase === "calling") setElapsed(0);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [callPhase]);

  const handleMute = () => {
    const next = !muted;
    setMutedState(next);
    setMuted(next);
  };

  const handleSpeaker = () => {
    const next = !speaker;
    setSpeakerState(next);
    setSpeaker(next);
  };

  const handleEndCall = async () => {
    const durationSecs = callPhase === "connected"
      ? Math.floor((Date.now() - startTimeRef.current) / 1000)
      : 0;

    if (callInfo?.callId) {
      try {
        await signalEndCall({
          callId: callInfo.callId,
          data: { duration: durationSecs, status: "completed" },
        });
      } catch {}
    }
    endCall(durationSecs);
  };

  const statusLabel =
    callPhase === "calling" ? "Calling…" :
    callPhase === "ended"   ? "Call Ended" :
    null;

  const isInternal = callInfo?.callType === "internal";

  const controls = [
    {
      icon: muted ? MicOff : Mic,
      label: "Mute",
      active: muted,
      onPress: handleMute,
    },
    {
      icon: Keyboard,
      label: "Keypad",
      active: showKeypad,
      onPress: () => setShowKeypad((v) => !v),
    },
    {
      icon: speaker ? Volume2 : VolumeX,
      label: "Speaker",
      active: speaker,
      onPress: handleSpeaker,
    },
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
      <div className="flex flex-col items-center mt-14 mb-6">
        {statusLabel && (
          <p className={cn(
            "text-sm tracking-widest uppercase font-medium mb-3 transition-all",
            callPhase === "ended" ? "text-white/35" : "text-white/45"
          )}>
            {statusLabel}
          </p>
        )}

        <p className="text-white text-[32px] font-bold leading-tight">
          {callInfo?.name ?? callInfo?.number}
        </p>

        {callInfo?.name && (
          <p className="text-white/40 text-sm font-mono mt-1">{callInfo.number}</p>
        )}

        {isInternal && (
          <span style={{
            marginTop: 6,
            fontSize: 11,
            fontWeight: 600,
            color: "#30d158",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}>
            Internal · Free
          </span>
        )}

        <p className={cn(
          "text-sm tabular-nums mt-2 transition-colors",
          callPhase === "connected" ? "text-white/70" : "text-white/30"
        )}>
          {formatDuration(elapsed)}
        </p>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="relative flex items-center justify-center">
          {callPhase === "calling" && (
            <div
              className="absolute rounded-full animate-ping opacity-15"
              style={{ width: 170, height: 170, background: "#34c759" }}
            />
          )}
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

      <div className="flex gap-10 mb-8">
        {controls.map(({ icon: Icon, label, active, onPress }) => (
          <div key={label} className="flex flex-col items-center gap-2">
            <button
              onClick={callPhase === "connected" ? onPress : undefined}
              disabled={callPhase !== "connected"}
              className={cn(
                "w-[60px] h-[60px] rounded-full flex items-center justify-center transition-all",
                callPhase === "connected"
                  ? active
                    ? "bg-white/22 border border-white/28 active:scale-90"
                    : "bg-white/8 border border-white/12 active:scale-90"
                  : "bg-white/4 border border-white/6 opacity-40 cursor-not-allowed"
              )}
            >
              <Icon className="w-[22px] h-[22px] text-white" />
            </button>
            <span className="text-white/40 text-[11px] font-medium">{label}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center mb-8 gap-2">
        <button
          onClick={handleEndCall}
          disabled={callPhase === "ended"}
          className={cn(
            "flex items-center justify-center rounded-full transition-all",
            callPhase !== "ended" && "active:scale-90 hover:scale-105"
          )}
          style={{
            width: 82,
            height: 82,
            background: callPhase === "ended" ? "rgba(255,59,48,0.3)" : "#ff3b30",
            boxShadow: callPhase === "ended" ? "none" : "0 6px 28px rgba(255,59,48,0.45)",
          }}
        >
          <PhoneOff className="text-white" style={{ width: 30, height: 30 }} />
        </button>
        <span className="text-white/35 text-xs font-medium">
          {callPhase === "ended" ? "Call Ended" : "End Call"}
        </span>
      </div>
    </div>
  );
}
