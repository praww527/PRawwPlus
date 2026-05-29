import { useState, useEffect, useRef } from "react";
import { Download, Trash2, Play, Pause, Mic, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

function getCsrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function apiFetch(path: string, opts?: RequestInit) {
  const method = (opts?.method ?? "GET").toUpperCase();
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(["POST","PUT","PATCH","DELETE"].includes(method) ? { "X-CSRF-Token": getCsrf() } : {}),
      ...(opts?.headers ?? {}),
    },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fmtSize(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/recordings");
      setRecordings(data.recordings ?? data.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function togglePlay(rec: any) {
    if (playingId === rec._id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(`/api/recordings/${rec._id}/download`);
    audio.onended = () => setPlayingId(null);
    audio.play().catch(() => toast({ title: "Playback failed", variant: "destructive" }));
    audioRef.current = audio;
    setPlayingId(rec._id);
  }

  async function deleteRec(id: string) {
    if (!confirm("Delete this recording?")) return;
    try {
      await apiFetch(`/recordings/${id}`, { method: "DELETE" });
      setRecordings((r) => r.filter((x) => x._id !== id));
      toast({ title: "Recording deleted" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="text-indigo-400" size={22} />
          <h1 className="text-xl font-bold text-white">Recordings</h1>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors">
          <RefreshCw size={13} />Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-white/40 text-sm">Loading recordings…</div>
      ) : recordings.length === 0 ? (
        <div className="text-center py-16 text-white/40 text-sm">No recordings found.</div>
      ) : (
        <div className="space-y-2">
          {recordings.map((rec) => (
            <div key={rec._id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14 }}
              className="flex items-center gap-3 p-3">
              <button onClick={() => togglePlay(rec)}
                className="w-9 h-9 rounded-full bg-indigo-600/80 hover:bg-indigo-500 flex items-center justify-center shrink-0 transition-colors">
                {playingId === rec._id ? <Pause size={16} className="text-white" /> : <Play size={16} className="text-white ml-0.5" />}
              </button>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/90 truncate">
                  {rec.fromNumber ?? rec.from ?? "Unknown"} → {rec.toNumber ?? rec.to ?? "Unknown"}
                </p>
                <p className="text-xs text-white/40 mt-0.5">
                  {rec.startTime ? format(new Date(rec.startTime), "MMM d, yyyy · h:mm a") : "—"}
                  {rec.duration != null ? ` · ${fmtDuration(rec.duration)}` : ""}
                  {rec.filesize != null ? ` · ${fmtSize(rec.filesize)}` : ""}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <a href={`/api/recordings/${rec._id}/download`}
                  className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                  download title="Download">
                  <Download size={14} className="text-white/60" />
                </a>
                <button onClick={() => deleteRec(rec._id)}
                  className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 flex items-center justify-center transition-colors"
                  title="Delete">
                  <Trash2 size={14} className="text-white/40 hover:text-red-400" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
