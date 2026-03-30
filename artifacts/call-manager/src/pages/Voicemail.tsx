import { Voicemail } from "lucide-react";

export default function VoicemailPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ paddingTop: 4 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)", margin: 0 }}>
          Voicemail
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>Your messages</p>
      </div>

      <div style={{ padding: "60px 0", textAlign: "center" }}>
        <div style={{
          width: 72, height: 72, borderRadius: 24,
          background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 16px",
        }}>
          <Voicemail style={{ width: 30, height: 30, color: "var(--text-3)" }} />
        </div>
        <p style={{ color: "var(--text-2)", fontSize: 15 }}>No voicemails yet</p>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 6 }}>
          Missed calls will leave a voicemail here
        </p>
      </div>
    </div>
  );
}
