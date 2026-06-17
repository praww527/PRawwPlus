import { Phone, Clock, Voicemail, Users, Delete, PhoneCall, Wifi, Signal } from "lucide-react";

const dialKeys = [
  { digit: "1", sub: "" }, { digit: "2", sub: "ABC" }, { digit: "3", sub: "DEF" },
  { digit: "4", sub: "GHI" }, { digit: "5", sub: "JKL" }, { digit: "6", sub: "MNO" },
  { digit: "7", sub: "PQRS" }, { digit: "8", sub: "TUV" }, { digit: "9", sub: "WXYZ" },
  { digit: "*", sub: "" }, { digit: "0", sub: "+" }, { digit: "#", sub: "" },
];

export function PureLiquid() {
  return (
    <div style={{
      width: 390,
      height: 844,
      background: "#000000",
      position: "relative",
      overflow: "hidden",
      fontFamily: "'Inter', -apple-system, sans-serif",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Extremely subtle deep glow — barely perceptible */}
      <div style={{
        position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)",
        width: 300, height: 200,
        borderRadius: "50%",
        background: "radial-gradient(ellipse, rgba(59,130,246,0.12) 0%, transparent 70%)",
        filter: "blur(60px)", pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", bottom: 100, left: "50%", transform: "translateX(-50%)",
        width: 280, height: 180,
        borderRadius: "50%",
        background: "radial-gradient(ellipse, rgba(99,102,241,0.1) 0%, transparent 70%)",
        filter: "blur(50px)", pointerEvents: "none",
      }} />

      {/* Status bar */}
      <div style={{ padding: "14px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ color: "rgba(255,255,255,0.9)", fontSize: 15, fontWeight: 600 }}>9:41</span>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <Signal size={14} color="rgba(255,255,255,0.8)" />
          <Wifi size={14} color="rgba(255,255,255,0.8)" />
          <div style={{ width: 24, height: 12, border: "1.5px solid rgba(255,255,255,0.5)", borderRadius: 3, position: "relative", display: "flex", alignItems: "center", padding: "0 1px" }}>
            <div style={{ width: "70%", height: "60%", background: "#fff", borderRadius: 1 }} />
            <div style={{ position: "absolute", right: -4, top: "25%", width: 2, height: "50%", background: "rgba(255,255,255,0.4)", borderRadius: 1 }} />
          </div>
        </div>
      </div>

      {/* Top bar — razor thin glass */}
      <div style={{ padding: "10px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div style={{
          background: "rgba(255,255,255,0.055)",
          backdropFilter: "blur(40px) saturate(2.5)",
          WebkitBackdropFilter: "blur(40px) saturate(2.5)",
          border: "0.5px solid rgba(255,255,255,0.15)",
          borderRadius: 12,
          padding: "8px 14px",
          boxShadow: "0 0.5px 0 rgba(255,255,255,0.2) inset, 0 4px 24px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <div style={{
            width: 5.5, height: 5.5, borderRadius: "50%",
            background: "#30d158",
            boxShadow: "0 0 0 2px rgba(48,209,88,0.2), 0 0 8px rgba(48,209,88,0.5)",
          }} />
          <span style={{ color: "rgba(255,255,255,0.88)", fontSize: 13, fontWeight: 500, letterSpacing: "-0.01em" }}>+27 11 234 5678</span>
        </div>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: "linear-gradient(145deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "0.5px solid rgba(255,255,255,0.2)",
          boxShadow: "0 0.5px 0 rgba(255,255,255,0.3) inset, 0 4px 16px rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.9)",
        }}>A</div>
      </div>

      {/* Number display — pure crystal */}
      <div style={{ padding: "4px 20px 8px", flexShrink: 0 }}>
        <div style={{
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(48px) saturate(3)",
          WebkitBackdropFilter: "blur(48px) saturate(3)",
          border: "0.5px solid rgba(255,255,255,0.12)",
          borderTop: "0.5px solid rgba(255,255,255,0.22)",
          borderRadius: 22,
          padding: "20px 20px 18px",
          boxShadow: "0 0.5px 0 rgba(255,255,255,0.15) inset, 0 0 0 0.5px rgba(0,0,0,0.8), 0 8px 40px rgba(0,0,0,0.7)",
          display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 76,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Extension or number</div>
            <div style={{ color: "#fff", fontSize: 34, fontWeight: 200, letterSpacing: "0.06em", fontFamily: "'SF Pro Display', 'Helvetica Neue', sans-serif" }}>_</div>
          </div>
          <button style={{
            width: 36, height: 36, borderRadius: 10,
            background: "rgba(255,255,255,0.05)",
            border: "0.5px solid rgba(255,255,255,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", flexShrink: 0,
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}>
            <Delete size={15} color="rgba(255,255,255,0.4)" />
          </button>
        </div>
      </div>

      {/* Dialpad — ultra minimal */}
      <div style={{ padding: "4px 28px", flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
        {[0, 1, 2, 3].map(row => (
          <div key={row} style={{ display: "flex", gap: 9, flex: 1 }}>
            {dialKeys.slice(row * 3, row * 3 + 3).map(({ digit, sub }) => (
              <button key={digit} style={{
                flex: 1,
                borderRadius: 18,
                background: "rgba(255,255,255,0.055)",
                backdropFilter: "blur(40px) saturate(2.5)",
                WebkitBackdropFilter: "blur(40px) saturate(2.5)",
                border: "0.5px solid rgba(255,255,255,0.12)",
                borderTop: "0.5px solid rgba(255,255,255,0.2)",
                boxShadow: "0 0.5px 0 rgba(255,255,255,0.18) inset, 0 4px 20px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(0,0,0,0.6)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                cursor: "pointer", gap: 2, padding: "0 0 4px",
              }}>
                <span style={{
                  color: "#fff", fontSize: 26, fontWeight: 200,
                  fontFamily: "'SF Pro Display', 'Helvetica Neue', sans-serif",
                  lineHeight: 1.1, letterSpacing: "-0.02em",
                }}>{digit}</span>
                {sub && <span style={{ color: "rgba(255,255,255,0.22)", fontSize: 8, fontWeight: 600, letterSpacing: "0.14em" }}>{sub}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Call button — glowing emerald sphere */}
      <div style={{ padding: "8px 28px 10px", display: "flex", justifyContent: "center", flexShrink: 0 }}>
        <button style={{
          width: 72, height: 72, borderRadius: "50%",
          background: "radial-gradient(circle at 40% 35%, rgba(255,255,255,0.35) 0%, rgba(34,197,94,0.9) 40%, rgba(22,163,74,1) 100%)",
          border: "0.5px solid rgba(255,255,255,0.25)",
          boxShadow: "0 0 0 10px rgba(34,197,94,0.08), 0 0 0 20px rgba(34,197,94,0.04), 0 12px 40px rgba(34,197,94,0.5), 0 0.5px 0 rgba(255,255,255,0.5) inset",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer",
        }}>
          <PhoneCall size={26} color="#fff" strokeWidth={1.8} />
        </button>
      </div>

      {/* Bottom nav — Pure liquid capsule */}
      <div style={{
        margin: "0 20px 22px",
        height: 58,
        borderRadius: 999,
        background: "rgba(255,255,255,0.05)",
        backdropFilter: "blur(48px) saturate(3)",
        WebkitBackdropFilter: "blur(48px) saturate(3)",
        border: "0.5px solid rgba(255,255,255,0.12)",
        borderTop: "0.5px solid rgba(255,255,255,0.22)",
        boxShadow: "0 0.5px 0 rgba(255,255,255,0.18) inset, 0 0 0 0.5px rgba(0,0,0,0.7), 0 -4px 20px rgba(0,0,0,0.5), 0 4px 20px rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center",
        flexShrink: 0, position: "relative",
      }}>
        <div style={{
          position: "absolute", left: 8, width: 84, top: 6, bottom: 6,
          borderRadius: 999,
          background: "rgba(59,130,246,0.18)",
          border: "0.5px solid rgba(59,130,246,0.3)",
          boxShadow: "0 0 12px rgba(59,130,246,0.15), 0 0.5px 0 rgba(255,255,255,0.2) inset",
        }} />
        {[
          { icon: Phone, label: "Dialpad", active: true },
          { icon: Clock, label: "Recents", active: false },
          { icon: Voicemail, label: "Voicemail", active: false },
          { icon: Users, label: "Contacts", active: false },
        ].map(({ icon: Icon, label, active }) => (
          <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
            <Icon size={18} color={active ? "#60a5fa" : "rgba(255,255,255,0.28)"} strokeWidth={active ? 2 : 1.5} />
            <span style={{ fontSize: 9.5, fontWeight: active ? 600 : 400, color: active ? "#60a5fa" : "rgba(255,255,255,0.28)", letterSpacing: "0.01em" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
