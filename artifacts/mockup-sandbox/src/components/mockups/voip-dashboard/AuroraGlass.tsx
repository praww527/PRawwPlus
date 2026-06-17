import { Phone, Clock, Voicemail, Users, Delete, PhoneCall } from "lucide-react";

const dialKeys = [
  { digit: "1", sub: "" }, { digit: "2", sub: "ABC" }, { digit: "3", sub: "DEF" },
  { digit: "4", sub: "GHI" }, { digit: "5", sub: "JKL" }, { digit: "6", sub: "MNO" },
  { digit: "7", sub: "PQRS" }, { digit: "8", sub: "TUV" }, { digit: "9", sub: "WXYZ" },
  { digit: "*", sub: "" }, { digit: "0", sub: "+" }, { digit: "#", sub: "" },
];

export function AuroraGlass() {
  return (
    <div style={{
      width: 390,
      height: 844,
      background: "#07080f",
      position: "relative",
      overflow: "hidden",
      fontFamily: "'Inter', -apple-system, sans-serif",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Aurora background layers */}
      <div style={{
        position: "absolute", top: -120, left: -100,
        width: 380, height: 380,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(168,85,247,0.35) 0%, transparent 65%)",
        filter: "blur(50px)", pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", top: 60, right: -100,
        width: 320, height: 320,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(20,184,166,0.3) 0%, transparent 65%)",
        filter: "blur(55px)", pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", top: 260, left: "10%",
        width: 260, height: 200,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(236,72,153,0.2) 0%, transparent 65%)",
        filter: "blur(45px)", pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", bottom: 80, right: "5%",
        width: 220, height: 220,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(59,130,246,0.22) 0%, transparent 65%)",
        filter: "blur(40px)", pointerEvents: "none",
      }} />

      {/* Mesh grid overlay */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }} />

      {/* Status bar */}
      <div style={{ padding: "14px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ color: "rgba(255,255,255,0.9)", fontSize: 15, fontWeight: 600 }}>9:41</span>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <div style={{ width: 15, height: 10, border: "1.5px solid rgba(255,255,255,0.6)", borderRadius: 2, position: "relative" }}>
            <div style={{ position: "absolute", left: 1, top: 1, right: 3, bottom: 1, background: "linear-gradient(90deg, #a855f7, #14b8a6)", borderRadius: 1 }} />
          </div>
        </div>
      </div>

      {/* Top bar — aurora glass card */}
      <div style={{ padding: "10px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div style={{
          background: "linear-gradient(135deg, rgba(168,85,247,0.12) 0%, rgba(20,184,166,0.1) 100%)",
          backdropFilter: "blur(28px) saturate(2)",
          WebkitBackdropFilter: "blur(28px) saturate(2)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderTop: "1px solid rgba(255,255,255,0.22)",
          borderRadius: 14,
          padding: "8px 14px",
          boxShadow: "0 8px 32px rgba(168,85,247,0.15), 0 1px 0 rgba(255,255,255,0.12) inset",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: "linear-gradient(135deg, #30d158, #20c997)",
            boxShadow: "0 0 8px rgba(48,209,88,0.7)",
          }} />
          <span style={{ color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: 500 }}>+27 11 234 5678</span>
        </div>
        <div style={{
          width: 38, height: 38, borderRadius: "50%",
          background: "linear-gradient(135deg, #a855f7, #14b8a6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 0 2px rgba(168,85,247,0.3), 0 0 0 4px rgba(20,184,166,0.15), 0 4px 16px rgba(168,85,247,0.4)",
          fontSize: 14, fontWeight: 700, color: "#fff",
        }}>A</div>
      </div>

      {/* Number display */}
      <div style={{ padding: "4px 20px 8px", flexShrink: 0 }}>
        <div style={{
          background: "linear-gradient(135deg, rgba(168,85,247,0.08) 0%, rgba(20,184,166,0.06) 100%)",
          backdropFilter: "blur(32px) saturate(2.2)",
          WebkitBackdropFilter: "blur(32px) saturate(2.2)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderTop: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 22,
          padding: "18px 20px",
          boxShadow: "0 2px 0 rgba(255,255,255,0.08) inset, 0 16px 48px rgba(168,85,247,0.12), 0 4px 16px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 74,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{
              color: "transparent",
              backgroundImage: "linear-gradient(90deg, rgba(168,85,247,0.7), rgba(20,184,166,0.7))",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5,
            }}>Extension or number</div>
            <div style={{ color: "#fff", fontSize: 32, fontWeight: 300, letterSpacing: "0.04em", fontFamily: "'Outfit', sans-serif" }}>_</div>
          </div>
          <button style={{
            width: 38, height: 38, borderRadius: 11,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", flexShrink: 0,
          }}>
            <Delete size={16} color="rgba(255,255,255,0.45)" />
          </button>
        </div>
      </div>

      {/* Dialpad */}
      <div style={{ padding: "4px 24px", flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
        {[0, 1, 2, 3].map(row => (
          <div key={row} style={{ display: "flex", gap: 8, flex: 1 }}>
            {dialKeys.slice(row * 3, row * 3 + 3).map(({ digit, sub }) => (
              <button key={digit} style={{
                flex: 1,
                borderRadius: 18,
                background: "linear-gradient(160deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.04) 100%)",
                backdropFilter: "blur(24px) saturate(2)",
                WebkitBackdropFilter: "blur(24px) saturate(2)",
                border: "1px solid rgba(255,255,255,0.09)",
                borderTop: "1px solid rgba(255,255,255,0.15)",
                boxShadow: "0 1px 0 rgba(255,255,255,0.1) inset, 0 6px 20px rgba(0,0,0,0.3)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                cursor: "pointer", gap: 2, padding: "0 0 4px",
              }}>
                <span style={{ color: "#fff", fontSize: 24, fontWeight: 300, fontFamily: "'Outfit', sans-serif", lineHeight: 1.1 }}>{digit}</span>
                {sub && <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 8, fontWeight: 600, letterSpacing: "0.12em" }}>{sub}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Call button */}
      <div style={{ padding: "8px 24px 10px", display: "flex", justifyContent: "center", flexShrink: 0 }}>
        <button style={{
          width: 70, height: 70, borderRadius: "50%",
          background: "linear-gradient(145deg, #22c55e 0%, #059669 100%)",
          border: "1px solid rgba(255,255,255,0.2)",
          boxShadow: "0 0 0 8px rgba(34,197,94,0.1), 0 0 0 16px rgba(34,197,94,0.05), 0 8px 32px rgba(34,197,94,0.45), 0 2px 0 rgba(255,255,255,0.3) inset",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer",
        }}>
          <PhoneCall size={26} color="#fff" strokeWidth={2} />
        </button>
      </div>

      {/* Bottom nav */}
      <div style={{
        margin: "0 18px 20px",
        height: 58,
        borderRadius: 999,
        background: "linear-gradient(135deg, rgba(168,85,247,0.1) 0%, rgba(20,184,166,0.08) 100%)",
        backdropFilter: "blur(40px) saturate(2)",
        WebkitBackdropFilter: "blur(40px) saturate(2)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderTop: "1px solid rgba(255,255,255,0.18)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.1) inset, 0 8px 32px rgba(168,85,247,0.15), 0 -2px 16px rgba(0,0,0,0.3)",
        display: "flex", alignItems: "center",
        flexShrink: 0, position: "relative",
      }}>
        <div style={{
          position: "absolute", left: 10, width: 82, top: 6, bottom: 6,
          borderRadius: 999,
          background: "linear-gradient(135deg, rgba(168,85,247,0.25), rgba(20,184,166,0.2))",
          border: "1px solid rgba(255,255,255,0.15)",
          boxShadow: "0 2px 12px rgba(168,85,247,0.2)",
        }} />
        {[
          { icon: Phone, label: "Dialpad", active: true },
          { icon: Clock, label: "Recents", active: false },
          { icon: Voicemail, label: "Voicemail", active: false },
          { icon: Users, label: "Contacts", active: false },
        ].map(({ icon: Icon, label, active }) => (
          <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
            <Icon size={18} color={active ? "#c084fc" : "rgba(255,255,255,0.3)"} strokeWidth={active ? 2.2 : 1.6} />
            <span style={{ fontSize: 9.5, fontWeight: active ? 700 : 500, color: active ? "#c084fc" : "rgba(255,255,255,0.3)" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
