import { useState } from "react";
import { useLocation } from "wouter";
import { Voicemail, Play, Pause, Phone, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";

interface VoicemailEntry {
  id: string;
  from: string;
  name?: string;
  duration: number;
  date: Date;
  listened: boolean;
  transcript?: string;
}

const SAMPLE_VOICEMAILS: VoicemailEntry[] = [
  {
    id: "1",
    from: "+27821234567",
    name: "Sarah Nkosi",
    duration: 43,
    date: new Date(Date.now() - 2 * 60 * 60 * 1000),
    listened: false,
    transcript: "Hi, it's Sarah. Just calling to confirm our meeting tomorrow at 10. Please call me back when you get a chance. Thanks!",
  },
  {
    id: "2",
    from: "+27110987654",
    name: "Thabo Dlamini",
    duration: 28,
    date: new Date(Date.now() - 5 * 60 * 60 * 1000),
    listened: false,
    transcript: "Hey, Thabo here. I tried your office number but no luck. Give me a call when you're free, it's about the contract.",
  },
  {
    id: "3",
    from: "+27731112233",
    name: "Lerato Mokoena",
    duration: 62,
    date: new Date(Date.now() - 24 * 60 * 60 * 1000),
    listened: true,
    transcript: "Good afternoon. This is Lerato from accounts. We need to discuss your invoice from last month. Please call us back on our main line at your earliest convenience.",
  },
  {
    id: "4",
    from: "+27849876543",
    duration: 15,
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    listened: true,
  },
  {
    id: "5",
    from: "+27721234000",
    name: "Zanele Khumalo",
    duration: 87,
    date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    listened: true,
    transcript: "Hi there! Zanele calling. Just wanted to catch up and see how the project is going. No rush at all — call when you get a chance. Chat soon!",
  },
];

function formatDur(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function initials(name?: string, number?: string) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return (number ?? "").replace(/\D/g, "").slice(-2);
}

function formatDate(date: Date) {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 1) return "Just now";
  if (diffH < 24) return format(date, "h:mm a");
  if (diffH < 48) return "Yesterday";
  return format(date, "MMM d");
}

export default function VoicemailPage() {
  const [entries, setEntries] = useState<VoicemailEntry[]>(SAMPLE_VOICEMAILS);
  const [playing, setPlaying] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [swipedId, setSwipedId] = useState<string | null>(null);

  const unread = entries.filter((e) => !e.listened).length;

  const togglePlay = (id: string) => {
    setEntries((prev) =>
      prev.map((e) => e.id === id ? { ...e, listened: true } : e)
    );
    setPlaying((p) => (p === id ? null : id));
  };

  const toggleExpand = (id: string) => {
    setExpanded((e) => (e === id ? null : id));
    setEntries((prev) =>
      prev.map((e) => e.id === id ? { ...e, listened: true } : e)
    );
  };

  const deleteEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (playing === id) setPlaying(null);
    if (expanded === id) setExpanded(null);
    setSwipedId(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ paddingTop: 4 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)", margin: 0 }}>
          Voicemail
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>
          {unread > 0 ? `${unread} new message${unread !== 1 ? "s" : ""}` : `${entries.length} message${entries.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      {entries.length === 0 ? (
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
          <p style={{ color: "var(--text-2)", fontSize: 15 }}>No voicemails</p>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 6 }}>Missed calls will leave a voicemail here</p>
        </div>
      ) : (
        <div className="section-card" style={{ overflow: "hidden" }}>
          {entries.map((entry, i, arr) => {
            const isPlaying = playing === entry.id;
            const isExpanded = expanded === entry.id;
            const isSwiped = swipedId === entry.id;

            return (
              <div key={entry.id} style={{ position: "relative", overflow: "hidden" }}>
                {/* Delete reveal */}
                <div style={{
                  position: "absolute", right: 0, top: 0, bottom: 0,
                  width: 80,
                  background: "#ff453a",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  zIndex: 0,
                }}>
                  <button
                    onClick={() => deleteEntry(entry.id)}
                    style={{
                      width: "100%", height: "100%",
                      background: "none", border: "none",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer",
                    }}
                  >
                    <Trash2 style={{ width: 20, height: 20, color: "#fff" }} />
                  </button>
                </div>

                {/* Row content */}
                <div
                  style={{
                    position: "relative",
                    zIndex: 1,
                    transform: isSwiped ? "translateX(-80px)" : "translateX(0)",
                    transition: "transform 0.25s ease",
                    background: "var(--surface-1, var(--surface-0))",
                  }}
                  onPointerDown={(e) => {
                    const startX = e.clientX;
                    const el = e.currentTarget;
                    const onMove = (ev: PointerEvent) => {
                      const dx = ev.clientX - startX;
                      if (dx < -20) setSwipedId(entry.id);
                      else if (dx > 20) setSwipedId(null);
                    };
                    const onUp = () => {
                      document.removeEventListener("pointermove", onMove);
                      document.removeEventListener("pointerup", onUp);
                    };
                    document.addEventListener("pointermove", onMove);
                    document.addEventListener("pointerup", onUp);
                  }}
                >
                  <div style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {/* Avatar */}
                      <div style={{
                        width: 44, height: 44, borderRadius: "50%",
                        background: entry.listened ? "var(--glass-bg)" : "rgba(59,130,246,0.15)",
                        border: `1px solid ${entry.listened ? "var(--glass-border)" : "rgba(59,130,246,0.3)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, fontWeight: 700,
                        color: entry.listened ? "var(--text-2)" : "#3b82f6",
                        flexShrink: 0,
                      }}>
                        {initials(entry.name, entry.from)}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <p style={{
                            fontSize: 15,
                            fontWeight: entry.listened ? 500 : 700,
                            color: "var(--text-1)",
                            margin: 0,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {entry.name ?? entry.from}
                          </p>
                          {!entry.listened && (
                            <div style={{
                              width: 7, height: 7, borderRadius: "50%",
                              background: "#3b82f6", flexShrink: 0,
                            }} />
                          )}
                        </div>
                        <p style={{ fontSize: 12, color: "var(--text-3)", margin: "2px 0 0", fontFamily: "monospace" }}>
                          {entry.name ? entry.from : ""} · {formatDate(entry.date)} · {formatDur(entry.duration)}
                        </p>
                      </div>

                      {/* Actions */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <button
                          onClick={() => togglePlay(entry.id)}
                          style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: isPlaying ? "rgba(59,130,246,0.18)" : "var(--glass-bg)",
                            border: `1px solid ${isPlaying ? "rgba(59,130,246,0.35)" : "var(--glass-border)"}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer",
                          }}
                        >
                          {isPlaying
                            ? <Pause style={{ width: 16, height: 16, color: "#3b82f6" }} />
                            : <Play style={{ width: 16, height: 16, color: "var(--text-2)" }} />
                          }
                        </button>
                        <button
                          onClick={() => toggleExpand(entry.id)}
                          style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: "var(--glass-bg)",
                            border: "1px solid var(--glass-border)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer",
                          }}
                        >
                          {isExpanded
                            ? <ChevronUp style={{ width: 16, height: 16, color: "var(--text-2)" }} />
                            : <ChevronDown style={{ width: 16, height: 16, color: "var(--text-2)" }} />
                          }
                        </button>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--sep)" }}>
                        {/* Playback bar */}
                        <div style={{
                          height: 4, borderRadius: 2,
                          background: "var(--glass-bg)",
                          marginBottom: 12, overflow: "hidden",
                        }}>
                          <div style={{
                            height: "100%", width: isPlaying ? "40%" : "0%",
                            background: "#3b82f6", borderRadius: 2,
                            transition: "width 2s linear",
                          }} />
                        </div>

                        {entry.transcript && (
                          <p style={{
                            fontSize: 13, color: "var(--text-2)",
                            lineHeight: 1.5, marginBottom: 14,
                            fontStyle: "italic",
                          }}>
                            "{entry.transcript}"
                          </p>
                        )}

                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => deleteEntry(entry.id)}
                            style={{
                              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                              padding: "10px 0", borderRadius: 12,
                              background: "rgba(255,69,58,0.1)",
                              border: "1px solid rgba(255,69,58,0.2)",
                              color: "#ff453a", fontSize: 13, fontWeight: 600, cursor: "pointer",
                            }}
                          >
                            <Trash2 style={{ width: 14, height: 14 }} />
                            Delete
                          </button>
                          <button
                            onClick={() => {}}
                            style={{
                              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                              padding: "10px 0", borderRadius: 12,
                              background: "rgba(48,209,88,0.1)",
                              border: "1px solid rgba(48,209,88,0.2)",
                              color: "#30d158", fontSize: 13, fontWeight: 600, cursor: "pointer",
                            }}
                          >
                            <Phone style={{ width: 14, height: 14 }} />
                            Call Back
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {i < arr.length - 1 && <div className="row-sep" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
