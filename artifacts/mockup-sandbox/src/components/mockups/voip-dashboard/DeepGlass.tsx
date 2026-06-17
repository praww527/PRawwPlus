import { Phone, Clock, Voicemail, Users, Delete, PhoneCall, Mic, MicOff, Grid3x3 } from "lucide-react";

const dialKeys = [
  { digit: "1", sub: "" },
  { digit: "2", sub: "ABC" },
  { digit: "3", sub: "DEF" },
  { digit: "4", sub: "GHI" },
  { digit: "5", sub: "JKL" },
  { digit: "6", sub: "MNO" },
  { digit: "7", sub: "PQRS" },
  { digit: "8", sub: "TUV" },
  { digit: "9", sub: "WXYZ" },
  { digit: "*", sub: "" },
  { digit: "0", sub: "+" },
  { digit: "#", sub: "" },
];

export function DeepGlass() {
  return (
    <div style={{
      width: 390,
      height: 844,
      background: "linear-gradient(160deg, #050814 0%, #0a0f2e 35%, #060c22 65%, #030610 100%)",
      position: "relative",
      overflow: "hidden",
      fontFamily: "'Inter', -apple-system, sans-serif",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Deep ambient orbs */}
      <div style={{
        position: "absolute", top: -80, left: -60,
        width: 280, height: 280,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(79,70,229,0.28) 0%, transparent 70%)",
        filter: "blur(40px)", pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", top: 120, right: -80,
        width: 240, height: 240,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(59,130,246,0.22) 0%, transparent 70%)",
        filter: "blur(50px)", pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", bottom: 140, left: "20%",
        width: 200, height: 200,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)",
        filter: "blur(45px)", pointerEvents: "none",
      }} />

      {/* Status bar */}
      <div style={{ padding: "14px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ color: "rgba(255,255,255,0.9)", fontSize: 15, fontWeight: 600 }}>9:41</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ width: 16, height: 11, border: "1.5px solid rgba(255,255,255,0.7)", borderRadius: 2, position: "relative" }}>
            <div style={{ position: "absolute", left: 1, top: 1, right: 3, bottom: 1, background: "rgba(255,255,255,0.8)", borderRadius: 1 }} />
            <div style={{ position: "absolute", right: -4, top: 3, width: 2.5, height: 5, background: "rgba(255,255,255,0.5)", borderRadius: 1 }} />
          </div>
        </div>
      </div>

      {/* Top bar */}
      <div style={{ padding: "10px 20px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div style={{
          background: "rgba(255,255,255,0.06)",
          backdropFilter: "blur(24px) saturate(1.8)",
          WebkitBackdropFilter: "blur(24px) saturate(1.8)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12,
          padding: "7px 12px",
          boxShadow: "0 1px 0 rgba(255,255,255,0.08) inset, 0 4px 20px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", gap: 7,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#30d158", boxShadow: "0 0 6px rgba(48,209,88,0.6)" }} />
          <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 500 }}>+27 11 234 5678</span>
        </div>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: "linear-gradient(135deg, #6366f1, #4f46e5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 0 2px rgba(99,102,241,0.3), 0 4px 16px rgba(79,70,229,0.4)",
          fontSize: 14, fontWeight: 700, color: "#fff",
        }}>A</div>
      </div>

      {/* Number display */}
      <div style={{ padding: "4px 24px 8px", flexShrink: 0 }}>
        <div style={{
          background: "rgba(255,255,255,0.045)",
          backdropFilter: "blur(32px) saturate(2)",
          WebkitBackdropFilter: "blur(32px) saturate(2)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 20,
          padding: "18px 20px",
          boxShadow: "0 2px 0 rgba(255,255,255,0.06) inset, 0 8px 32px rgba(0,0,0,0.5), 0 1px 0 rgba(99,102,241,0.2) inset",
          display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 72,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Extension or number</div>
            <div style={{ color: "#fff", fontSize: 32, fontWeight: 300, letterSpacing: "0.04em", fontFamily: "'Outfit', sans-serif" }}>_</div>
          </div>
          <button style={{
            width: 38, height: 38, borderRadius: 10,
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", flexShrink: 0,
            boxShadow: "0 1px 0 rgba(255,255,255,0.1) inset",
          }}>
            <Delete size={16} color="rgba(255,255,255,0.5)" />
          </button>
        </div>
      </div>

      {/* Dialpad */}
      <div style={{ padding: "4px 28px", flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        {[0, 1, 2, 3].map(row => (
          <div key={row} style={{ display: "flex", gap: 8, flex: 1 }}>
            {dialKeys.slice(row * 3, row * 3 + 3).map(({ digit, sub }) => (
              <button key={digit} style={{
                flex: 1,
                borderRadius: 16,
                background: "rgba(255,255,255,0.06)",
                backdropFilter: "blur(20px) saturate(1.8)",
                WebkitBackdropFilter: "blur(20px) saturate(1.8)",
                border: "1px solid rgba(255,255,255,0.09)",
                boxShadow: "0 1px 0 rgba(255,255,255,0.1) inset, 0 4px 16px rgba(0,0,0,0.35), 0 0 0 0.5px rgba(99,102,241,0.1)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                cursor: "pointer", gap: 1, padding: "0 0 4px",
              }}>
                <span style={{ color: "#fff", fontSize: 24, fontWeight: 300, fontFamily: "'Outfit', sans-serif", lineHeight: 1.1 }}>{digit}</span>
                {sub && <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 8, fontWeight: 600, letterSpacing: "0.12em" }}>{sub}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Call button */}
      <div style={{ padding: "8px 28px 12px", display: "flex", justifyContent: "center", flexShrink: 0 }}>
        <button style={{
          width: 68, height: 68, borderRadius: "50%",
          background: "linear-gradient(145deg, #22c55e, #16a34a)",
          border: "none",
          boxShadow: "0 0 0 8px rgba(34,197,94,0.12), 0 0 0 16px rgba(34,197,94,0.06), 0 8px 32px rgba(34,197,94,0.4), 0 2px 0 rgba(255,255,255,0.25) inset",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer",
        }}>
          <PhoneCall size={26} color="#fff" strokeWidth={2} />
        </button>
      </div>

      {/* Bottom nav */}
      <div style={{
        margin: "0 16px 20px",
        height: 56,
        borderRadius: 999,
        background: "rgba(255,255,255,0.06)",
        backdropFilter: "blur(32px) saturate(1.8)",
        WebkitBackdropFilter: "blur(32px) saturate(1.8)",
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.1) inset, 0 -4px 24px rgba(0,0,0,0.4), 0 4px 24px rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center",
        flexShrink: 0, position: "relative",
      }}>
        {/* Active pill */}
        <div style={{
          position: "absolute", left: 10, width: 80, top: 6, bottom: 6,
          borderRadius: 999,
          background: "rgba(99,102,241,0.2)",
          border: "1px solid rgba(99,102,241,0.35)",
          boxShadow: "0 2px 12px rgba(99,102,241,0.2)",
        }} />
        {[
          { icon: Phone, label: "Dialpad", active: true },
          { icon: Clock, label: "Recents", active: false },
          { icon: Voicemail, label: "Voicemail", active: false },
          { icon: Users, label: "Contacts", active: false },
        ].map(({ icon: Icon, label, active }) => (
          <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
            <Icon size={18} color={active ? "#818cf8" : "rgba(255,255,255,0.3)"} strokeWidth={active ? 2.2 : 1.6} />
            <span style={{ fontSize: 9.5, fontWeight: active ? 700 : 500, color: active ? "#818cf8" : "rgba(255,255,255,0.3)" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
