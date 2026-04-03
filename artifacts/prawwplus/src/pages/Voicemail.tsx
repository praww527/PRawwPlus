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

type VMFilter = "all" | "unread" | "listened";

const FILTERS: { key: VMFilter; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "unread",   label: "Unread" },
  { key: "listened", label: "Listened" },
];

const SAMPLE_VOICEMAILS: VoicemailEntry[] = [
  {
    id: "1", from: "+27821234567", name: "Sarah Nkosi", duration: 43,
    date: new Date(Date.now() - 2 * 60 * 60 * 1000), listened: false,
    transcript: "Hi, it's Sarah. Just calling to confirm our meeting tomorrow at 10. Please call me back when you get a chance. Thanks!",
  },
  {
    id: "2", from: "+27110987654", name: "Thabo Dlamini", duration: 28,
    date: new Date(Date.now() - 5 * 60 * 60 * 1000), listened: false,
    transcript: "Hey, Thabo here. I tried your office number but no luck. Give me a call when you're free, it's about the contract.",
  },
  {
    id: "3", from: "+27731112233", name: "Lerato Mokoena", duration: 62,
    date: new Date(Date.now() - 24 * 60 * 60 * 1000), listened: true,
    transcript: "Good afternoon. This is Lerato from accounts. We need to discuss your invoice from last month. Please call us back on our main line.",
  },
  {
    id: "4", from: "+27849876543", duration: 15,
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), listened: true,
  },
  {
    id: "5", from: "+27721234000", name: "Zanele Khumalo", duration: 87,
    date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), listened: true,
    transcript: "Hi there! Zanele calling. Just wanted to catch up and see how the project is going. Call when you get a chance. Chat soon!",
  },
];

function formatDur(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function initials(name?: string, number?: string) {
  if (name) {
    const p = name.trim().split(/\s+/);
    return p.length > 1 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : p[0].slice(0, 2).toUpperCase();
  }
  return (number ?? "").replace(/\D/g, "").slice(-2);
}

function formatDate(date: Date) {
  const diffH = (Date.now() - date.getTime()) / 3_600_000;
  if (diffH < 1)  return "Just now";
  if (diffH < 24) return format(date, "h:mm a");
  if (diffH < 48) return "Yesterday";
  return format(date, "MMM d");
}

export default function VoicemailPage() {
  const [, setLocation] = useLocation();
  const [entries, setEntries] = useState<VoicemailEntry[]>(SAMPLE_VOICEMAILS);
  const [playing, setPlaying] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<VMFilter>("all");

  const unread = entries.filter((e) => !e.listened).length;

  const filteredEntries = entries.filter((e) => {
    if (filter === "unread")   return !e.listened;
    if (filter === "listened") return e.listened;
    return true;
  });

  const togglePlay = (id: string) => {
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, listened: true } : e));
    setPlaying((p) => (p === id ? null : id));
  };

  const toggleExpand = (id: string) => {
    setExpanded((e) => (e === id ? null : id));
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, listened: true } : e));
  };

  const deleteEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (playing === id) setPlaying(null);
    if (expanded === id) setExpanded(null);
  };

  return (
    <div className="page-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Page title */}
      <div style={{ paddingTop: 4 }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)", margin: 0, letterSpacing: "-0.02em" }}>
          Voicemail
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 3 }}>
          {unread > 0 ? `${unread} unread message${unread !== 1 ? "s" : ""}` : `${entries.length} messages`}
        </p>
      </div>

      {/* Filter chips */}
      <div className="chip-row">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`chip${filter === f.key ? " chip-active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key === "unread" && unread > 0 && (
              <span style={{
                marginLeft: 4, minWidth: 16, height: 16, borderRadius: 8, padding: "0 4px",
                background: filter === "unread" ? "rgba(255,255,255,0.30)" : "rgba(255,69,58,0.80)",
                color: "#fff", fontSize: 10, fontWeight: 700,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
                {unread}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {filteredEntries.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center" }}>
          <div className="float-card" style={{
            width: 72, height: 72, borderRadius: 24,
            background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
            backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
            boxShadow: "0 4px 24px var(--glass-shadow), 0 1px 0 var(--glass-highlight) inset",
          }}>
            <Voicemail style={{ width: 30, height: 30, color: "var(--text-3)" }} />
          </div>
          <p style={{ color: "var(--text-2)", fontSize: 15, marginBottom: 6 }}>
            {filter === "all" ? "No voicemails" : `No ${filter} voicemails`}
          </p>
          {filter !== "all" && (
            <button className="btn-press" onClick={() => setFilter("all")} style={{
              marginTop: 10, padding: "9px 22px", borderRadius: 20,
              background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
              color: "var(--text-2)", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>
              Show all
            </button>
          )}
        </div>
      ) : (
        <div className="section-card">
          {filteredEntries.map((entry, i, arr) => {
            const isExpanded = expanded === entry.id;
            const isPlaying = playing === entry.id;

            return (
              <div key={entry.id} className="stagger-item">
                <div
                  style={{ padding: "11px 16px", cursor: "pointer", transition: "background 0.15s" }}
                  onClick={() => toggleExpand(entry.id)}
                  onPointerDown={(e) => { e.currentTarget.style.background = "var(--glass-bg-strong)"; }}
                  onPointerUp={(e) => { e.currentTarget.style.background = "transparent"; }}
                  onPointerLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {/* Avatar */}
                    <div style={{
                      width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                      background: entry.listened ? "var(--glass-bg)" : "rgba(26,140,255,0.15)",
                      border: entry.listened ? "1px solid var(--glass-border)" : "1.5px solid rgba(26,140,255,0.35)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, fontWeight: 700,
                      color: entry.listened ? "var(--text-2)" : "hsl(var(--primary))",
                      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                    }}>
                      {initials(entry.name, entry.from)}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <p style={{
                          fontSize: 15, fontWeight: entry.listened ? 500 : 700,
                          color: "var(--text-1)", margin: 0,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {entry.name ?? entry.from}
                        </p>
                        {!entry.listened && (
                          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "hsl(var(--primary))", flexShrink: 0 }} />
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{formatDate(entry.date)}</span>
                        <span style={{ fontSize: 10, color: "var(--text-3)" }}>·</span>
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{formatDur(entry.duration)}</span>
                      </div>
                    </div>

                    {/* Play button + chevron */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        className="btn-press"
                        onClick={(e) => { e.stopPropagation(); togglePlay(entry.id); }}
                        style={{
                          width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                          background: "rgba(26,140,255,0.15)", border: "1px solid rgba(26,140,255,0.30)",
                          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                        }}
                      >
                        {isPlaying
                          ? <Pause style={{ width: 14, height: 14, color: "hsl(var(--primary))" }} />
                          : <Play  style={{ width: 14, height: 14, color: "hsl(var(--primary))", marginLeft: 1 }} />
                        }
                      </button>
                      {isExpanded
                        ? <ChevronUp  style={{ width: 14, height: 14, color: "var(--text-3)", flexShrink: 0 }} />
                        : <ChevronDown style={{ width: 14, height: 14, color: "var(--text-3)", flexShrink: 0 }} />
                      }
                    </div>
                  </div>

                  {/* Expanded transcript + actions */}
                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--sep)" }}>
                      {entry.transcript && (
                        <p style={{
                          fontSize: 13, color: "var(--text-2)", lineHeight: 1.55,
                          marginBottom: 14, fontStyle: "italic",
                        }}>
                          "{entry.transcript}"
                        </p>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn-press"
                          onClick={(e) => { e.stopPropagation(); deleteEntry(entry.id); }}
                          style={{
                            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                            padding: "10px 0", borderRadius: 12,
                            background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.20)",
                            color: "#ff453a", fontSize: 13, fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          <Trash2 style={{ width: 14, height: 14 }} /> Delete
                        </button>
                        <button
                          className="btn-press"
                          onClick={(e) => { e.stopPropagation(); setLocation(`/dashboard?dial=${encodeURIComponent(entry.from)}`); }}
                          style={{
                            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                            padding: "10px 0", borderRadius: 12,
                            background: "rgba(48,209,88,0.10)", border: "1px solid rgba(48,209,88,0.20)",
                            color: "#30d158", fontSize: 13, fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          <Phone style={{ width: 14, height: 14 }} /> Call Back
                        </button>
                      </div>
                    </div>
                  )}
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
