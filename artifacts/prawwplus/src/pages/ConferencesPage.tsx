import { useState, useEffect } from "react";
import { Video, RefreshCw, UserX, Users } from "lucide-react";
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
      const data = await apiFetch("/conference");
      setRooms(data.data ?? data.rooms ?? data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function kickParticipant(roomId: string, memberId: string) {
    try {
      await apiFetch(`/conference/${roomId}/kick`, { method: "POST", body: JSON.stringify({ memberId }) });
      toast({ title: "Participant removed" });
      load();
    } catch (e: any) {
      toast({ title: "Could not remove participant", description: e.message, variant: "destructive" });
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
        <div className="text-center py-16 text-white/40 text-sm">No conference rooms configured.</div>
      ) : (
        <div className="space-y-3">
          {rooms.map((room) => {
            const members = room.members ?? room.participants ?? [];
            const active = members.length > 0;
            return (
              <div key={room._id} style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${active ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.08)"}`, borderRadius: 16 }}
                className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white/90">{room.name}</p>
                      {active && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 font-medium">
                          LIVE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/40 mt-0.5">
                      Extension {room.extension ?? room.ext ?? "—"}
                      {room.profile ? ` · Profile: ${room.profile}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-white/40">
                    <Users size={13} />
                    <span>{members.length} participant{members.length !== 1 ? "s" : ""}</span>
                  </div>
                </div>

                {members.length > 0 && (
                  <div className="border-t border-white/5 pt-3 space-y-1.5">
                    {members.map((m: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-1 px-2 rounded-lg bg-white/3 text-xs">
                        <div>
                          <span className="text-white/80 font-medium">{m.name ?? m.callerIdName ?? `Participant ${i + 1}`}</span>
                          {m.callerIdNumber && <span className="text-white/40 ml-2">{m.callerIdNumber}</span>}
                          {m.muted && <span className="ml-2 text-amber-400">muted</span>}
                          {m.deaf && <span className="ml-2 text-red-400">deaf</span>}
                        </div>
                        <button onClick={() => kickParticipant(room._id, m.id ?? m.memberId ?? String(i))}
                          className="w-6 h-6 rounded bg-red-500/10 hover:bg-red-500/30 flex items-center justify-center transition-colors">
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
