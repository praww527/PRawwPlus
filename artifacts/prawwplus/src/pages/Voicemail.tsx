import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Voicemail, Play, Pause, Phone, Trash2, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface VoicemailMessage {
  id:        string;
  createdAt: string;
  size:      number;
  from?:     string;
  name?:     string;
  duration?: number;
  read:      boolean;
}

interface VoicemailResponse {
  mailbox: { extension: number; domain: string };
  messages: VoicemailMessage[];
}

type VMFilter = "all" | "unread" | "listened";

const FILTERS: { key: VMFilter; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "unread",   label: "Unread" },
  { key: "listened", label: "Listened" },
];

function formatDur(s?: number): string {
  if (!s || s <= 0) return "—";
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function initials(name?: string, number?: string): string {
  if (name) {
    const p = name.trim().split(/\s+/);
    return p.length > 1 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : p[0].slice(0, 2).toUpperCase();
  }
  if (number) return number.replace(/\D/g, "").slice(-2);
  return "VM";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const diffH = (Date.now() - d.getTime()) / 3_600_000;
  if (diffH < 1)  return "Just now";
  if (diffH < 24) return format(d, "h:mm a");
  if (diffH < 48) return "Yesterday";
  return format(d, "MMM d");
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res;
}

export default function VoicemailPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [messages, setMessages]   = useState<VoicemailMessage[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [playing, setPlaying]     = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [filter, setFilter]       = useState<VMFilter>("all");
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadVoicemail = async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const res  = await apiFetch("/voicemail");
      const data = (await res.json()) as VoicemailResponse;
      setMessages(data.messages ?? []);
    } catch (err: any) {
      if (!silent) toast({ title: "Could not load voicemail", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadVoicemail(); }, []);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => { Object.values(audioUrls).forEach(URL.revokeObjectURL); };
  }, [audioUrls]);

  const getAudioUrl = async (id: string): Promise<string | null> => {
    if (audioUrls[id]) return audioUrls[id];
    try {
      const res  = await fetch(`/api/voicemail/message?path=${encodeURIComponent(id)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      setAudioUrls((prev) => ({ ...prev, [id]: url }));
      return url;
    } catch (err: any) {
      toast({ title: "Cannot load audio", description: err.message, variant: "destructive" });
      return null;
    }
  };

  const markRead = async (id: string) => {
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, read: true } : m));
    try { await apiFetch("/voicemail/message/read", { method: "PATCH", body: JSON.stringify({ path: id }) }); }
    catch { /* best-effort */ }
  };

  const togglePlay = async (id: string) => {
    if (playing === id) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }

    await markRead(id);

    const url = await getAudioUrl(id);
    if (!url) return;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = url;
      audioRef.current.play().catch(() => {});
    }
    setPlaying(id);
  };

  const toggleExpand = async (id: string) => {
    setExpanded((e) => (e === id ? null : id));
    await markRead(id);
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch("/voicemail/message", { method: "DELETE", body: JSON.stringify({ path: id }) });
      setMessages((prev) => prev.filter((m) => m.id !== id));
      if (playing === id) { audioRef.current?.pause(); setPlaying(null); }
      if (expanded === id) setExpanded(null);
      if (audioUrls[id])  { URL.revokeObjectURL(audioUrls[id]); setAudioUrls((prev) => { const n = { ...prev }; delete n[id]; return n; }); }
      toast({ title: "Voicemail deleted" });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const unread = messages.filter((m) => !m.read).length;
  const filtered = messages.filter((m) => {
    if (filter === "unread")   return !m.read;
    if (filter === "listened") return m.read;
    return true;
  });

  return (
    <div className="page-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onEnded={() => setPlaying(null)}
        onError={() => { setPlaying(null); toast({ title: "Audio playback error", variant: "destructive" }); }}
        style={{ display: "none" }}
      />

      {/* Page title */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 4 }}>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)", margin: 0, letterSpacing: "-0.02em" }}>
            Voicemail
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 3 }}>
            {loading ? "Loading…" : unread > 0 ? `${unread} unread message${unread !== 1 ? "s" : ""}` : `${messages.length} message${messages.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          className="btn-press"
          onClick={() => loadVoicemail(true)}
          disabled={refreshing}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "9px 16px", borderRadius: 22,
            background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            color: "var(--text-2)", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          <RefreshCw style={{ width: 14, height: 14 }} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
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

      {/* Loading skeletons */}
      {loading ? (
        <div className="section-card">
          {[...Array(4)].map((_, i) => (
            <div key={i}>
              <div style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                <div className="skeleton" style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ height: 14, width: "50%", marginBottom: 7 }} />
                  <div className="skeleton" style={{ height: 11, width: "30%" }} />
                </div>
                <div className="skeleton" style={{ width: 34, height: 34, borderRadius: "50%" }} />
              </div>
              {i < 3 && <div className="row-sep" />}
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
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
          {filtered.map((entry, i, arr) => {
            const isExpanded = expanded === entry.id;
            const isPlaying  = playing  === entry.id;
            const displayName = entry.name ?? entry.from;

            return (
              <div key={entry.id} className="stagger-item">
                <div
                  style={{ padding: "11px 16px", cursor: "pointer", transition: "background 0.15s" }}
                  onClick={() => toggleExpand(entry.id)}
                  onPointerDown={(e) => { e.currentTarget.style.background = "var(--glass-bg-strong)"; }}
                  onPointerUp={(e)   => { e.currentTarget.style.background = "transparent"; }}
                  onPointerLeave={(e)=> { e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {/* Avatar */}
                    <div style={{
                      width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                      background: entry.read ? "var(--glass-bg)" : "rgba(26,140,255,0.15)",
                      border: entry.read ? "1px solid var(--glass-border)" : "1.5px solid rgba(26,140,255,0.35)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, fontWeight: 700,
                      color: entry.read ? "var(--text-2)" : "hsl(var(--primary))",
                      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                    }}>
                      {initials(entry.name, entry.from)}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <p style={{
                          fontSize: 15, fontWeight: entry.read ? 500 : 700,
                          color: "var(--text-1)", margin: 0,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {displayName ?? "Unknown caller"}
                        </p>
                        {!entry.read && (
                          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "hsl(var(--primary))", flexShrink: 0 }} />
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                        {entry.from && entry.name && (
                          <>
                            <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "monospace" }}>{entry.from}</span>
                            <span style={{ fontSize: 10, color: "var(--text-3)" }}>·</span>
                          </>
                        )}
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{formatDate(entry.createdAt)}</span>
                        <span style={{ fontSize: 10, color: "var(--text-3)" }}>·</span>
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{formatDur(entry.duration)}</span>
                      </div>
                    </div>

                    {/* Controls */}
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
                        ? <ChevronUp   style={{ width: 14, height: 14, color: "var(--text-3)", flexShrink: 0 }} />
                        : <ChevronDown style={{ width: 14, height: 14, color: "var(--text-3)", flexShrink: 0 }} />
                      }
                    </div>
                  </div>

                  {/* Expanded actions */}
                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--sep)" }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn-press"
                          onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                          style={{
                            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                            padding: "11px 0", borderRadius: 12,
                            background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.20)",
                            color: "#ff453a", fontSize: 13, fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          <Trash2 style={{ width: 14, height: 14 }} /> Delete
                        </button>
                        {entry.from && (
                          <button
                            className="btn-press"
                            onClick={(e) => { e.stopPropagation(); setLocation(`/dashboard?dial=${encodeURIComponent(entry.from!)}`); }}
                            style={{
                              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                              padding: "11px 0", borderRadius: 12,
                              background: "rgba(48,209,88,0.10)", border: "1px solid rgba(48,209,88,0.20)",
                              color: "#30d158", fontSize: 13, fontWeight: 600, cursor: "pointer",
                            }}
                          >
                            <Phone style={{ width: 14, height: 14 }} /> Call Back
                          </button>
                        )}
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
