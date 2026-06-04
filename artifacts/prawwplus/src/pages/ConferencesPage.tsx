import { useState, useEffect } from "react";
import { Video, RefreshCw, UserX, Users, Lock, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
    },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export default function ConferencesPage() {
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/conference/rooms");
      setRooms(Array.isArray(data.rooms) ? data.rooms : []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function kickParticipant(roomId: string, memberId: string) {
    try {
      await apiFetch(`/conference/${roomId}/member/${memberId}`, { method: "DELETE" });
      toast({ title: "Participant removed" });
      load();
    } catch (e: any) {
      toast({ title: "Could not remove participant", description: e.message, variant: "destructive" });
    }
  }

  async function endRoom(roomId: string) {
    try {
      await apiFetch(`/conference/${roomId}`, { method: "DELETE" });
      toast({ title: "Conference ended" });
      load();
    } catch (e: any) {
      toast({ title: "Could not end conference", description: e.message, variant: "destructive" });
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Video className="text-indigo-400" size={22} />
          <h1 className="text-xl font-bold text-white">Conference Rooms</h1>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors">
          <RefreshCw size={13} />Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-white/40 text-sm">Loading conference rooms…</div>
      ) : rooms.length === 0 ? (
        <div className="rounded-2xl border border-white/8 bg-white/3 p-12 text-center">
          <Phone className="mx-auto mb-3 text-white/20" size={32} />
          <p className="text-white/40 text-sm">No active conference rooms.</p>
          <p className="text-white/25 text-xs mt-1">Start a conference from the Dialpad to see it here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rooms.map((room) => {
            const members: any[] = room.members ?? [];
            return (
              <div
                key={room.roomId}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${members.length > 0 ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.08)"}`,
                  borderRadius: 16,
                }}
                className="p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white/90 font-mono">{room.roomId}</p>
                      {room.isLocked && (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">
                          <Lock size={10} /> Locked
                        </span>
                      )}
                      {members.length > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 font-medium">
                          LIVE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/40 mt-0.5">
                      Created {room.createdAt ? new Date(room.createdAt).toLocaleTimeString() : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-white/40">
                      <Users size={13} />
                      <span>{room.memberCount ?? members.length} participant{(room.memberCount ?? members.length) !== 1 ? "s" : ""}</span>
                    </div>
                    <button
                      onClick={() => endRoom(room.roomId)}
                      className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/25 text-red-400 transition-colors"
                    >
                      End
                    </button>
                  </div>
                </div>

                {members.length > 0 && (
                  <div className="border-t border-white/5 pt-3 space-y-1.5">
                    {members.map((m: any, i: number) => (
                      <div key={m.uuid ?? i} className="flex items-center justify-between py-1 px-2 rounded-lg bg-white/3 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-white/80 font-medium">{m.caller ?? `Participant ${i + 1}`}</span>
                          {m.flags?.includes("mute") && <span className="text-amber-400">muted</span>}
                        </div>
                        <button
                          onClick={() => kickParticipant(room.roomId, m.memberId)}
                          className="w-6 h-6 rounded bg-red-500/10 hover:bg-red-500/30 flex items-center justify-center transition-colors"
                        >
                          <UserX size={11} className="text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
