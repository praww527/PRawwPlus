import { useEffect } from "react";
import { Phone, PhoneOff } from "lucide-react";
import { useCall } from "@/context/CallContext";
import { phoneAudio } from "@/lib/phoneAudio";

function avatarInitials(info: { number: string; name?: string } | null) {
  if (!info) return "?";
  if (info.name) {
    const parts = info.name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  const digits = info.number.replace(/\D/g, "");
  return digits ? digits.slice(-2) : "?";
}

export default function IncomingCallScreen() {
  const { callInfo, acceptCall, declineCall } = useCall();

  useEffect(() => {
    phoneAudio.startRingtone();
    return () => { phoneAudio.stopAll(); };
  }, []);

  const handleAccept = () => {
    // Don't call stopAll() here — unmount cleanup handles it.
    // Stopping immediately can break AudioContext if it was still resuming.
    acceptCall();
  };

  const handleDecline = () => {
    declineCall();
  };

  const isInternal = callInfo?.callType === "internal";
  const displayName   = callInfo?.name ?? (callInfo?.number || "PRaww+ User");
  const displayNumber = callInfo?.name ? (callInfo?.number || null) : null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "#000000",
        display: "flex", flexDirection: "column",
        alignItems: "center",
        paddingTop: "env(safe-area-inset-top, 44px)",
        paddingBottom: "env(safe-area-inset-bottom, 34px)",
        fontFamily: "-apple-system, 'SF Pro Text', 'Inter', sans-serif",
        animation: "fadeSlideUp 0.35s cubic-bezier(0.25,0.46,0.45,0.94) both",
      }}
    >
      {/* Top info */}
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        marginTop: 56, marginBottom: 24, gap: 6,
      }}>
        <p style={{
          fontSize: 13, fontWeight: 500, letterSpacing: "0.01em",
          color: "rgba(235,235,245,0.55)", margin: 0,
        }}>
          Incoming Call
        </p>
        <h1 style={{
          fontSize: displayName.length > 22 ? 26 : 34,
          fontWeight: 700, color: "#FFFFFF",
          margin: 0, lineHeight: 1.1, textAlign: "center",
          letterSpacing: "-0.5px",
          fontFamily: "-apple-system, 'SF Pro Display', sans-serif",
        }}>
          {displayName}
        </h1>
        {displayNumber && (
          <p style={{ fontSize: 15, color: "rgba(235,235,245,0.45)", margin: 0 }}>
            {displayNumber}
          </p>
        )}
        {isInternal && (
          <span style={{
            fontSize: 11, fontWeight: 600, color: "#30D158",
            letterSpacing: "0.05em", textTransform: "uppercase",
          }}>
            Internal · Free
          </span>
        )}
      </div>

      {/* Avatar with pulsing rings */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* Outer slow pulse */}
          <div
            className="absolute rounded-full animate-ping"
            style={{
              width: 220, height: 220,
              background: "#30D158", opacity: 0.07,
              animationDuration: "2.2s",
            }}
          />
          {/* Inner faster pulse */}
          <div
            className="absolute rounded-full animate-ping"
            style={{
              width: 175, height: 175,
              background: "#30D158", opacity: 0.13,
              animationDuration: "1.6s",
            }}
          />
          {/* Soft glow */}
          <div style={{
            position: "absolute",
            width: 240, height: 240, borderRadius: "50%",
            background: "#30D158", opacity: 0.06,
            filter: "blur(24px)",
          }} />

          {/* Avatar circle */}
          <div style={{
            position: "relative",
            width: 112, height: 112, borderRadius: "50%",
            background: "rgba(118,118,128,0.24)",
            border: "2px solid rgba(48,209,88,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 32, fontWeight: 700, color: "#FFFFFF",
            boxShadow: "0 0 40px rgba(48,209,88,0.18)",
          }}>
            {avatarInitials(callInfo)}
          </div>
        </div>
      </div>

      {/* Decline + Accept */}
      <div style={{
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        gap: 80, marginBottom: 56,
      }}>
        {/* Decline */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <button
            onClick={handleDecline}
            style={{
              width: 80, height: 80, borderRadius: "50%",
              background: "#FF3B30", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
              boxShadow: "0 4px 20px rgba(255,59,48,0.42)",
              WebkitTapHighlightColor: "transparent",
            }}
            onPointerDown={(e) => { e.currentTarget.style.transform = "scale(0.92)"; }}
            onPointerUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
            onPointerLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            <PhoneOff style={{ width: 30, height: 30, color: "white" }} />
          </button>
          <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(235,235,245,0.45)" }}>Decline</span>
        </div>

        {/* Accept */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative" }}>
            <span
              className="absolute inset-0 rounded-full animate-ping"
              style={{ background: "rgba(48,209,88,0.4)" }}
            />
            <button
              onClick={handleAccept}
              style={{
                position: "relative",
                width: 80, height: 80, borderRadius: "50%",
                background: "#30D158", border: "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 4px 24px rgba(48,209,88,0.50)",
                WebkitTapHighlightColor: "transparent",
              }}
              onPointerDown={(e) => { e.currentTarget.style.transform = "scale(0.92)"; }}
              onPointerUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
              onPointerLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
            >
              <Phone style={{ width: 30, height: 30, color: "white" }} />
            </button>
          </div>
          <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(235,235,245,0.45)" }}>Accept</span>
        </div>
      </div>
    </div>
  );
}
