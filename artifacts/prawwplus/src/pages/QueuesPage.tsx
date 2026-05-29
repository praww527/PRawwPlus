import { useState, useEffect } from "react";
import { Users, RefreshCw, Clock, PhoneCall } from "lucide-react";

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

const STRATEGY_LABELS: Record<string, string> = {
  "round-robin": "Round Robin",
  "longest-idle-agent": "Longest Idle",
  "agent-with-fewest-calls": "Fewest Calls",
  "ring-all": "Ring All",
};

export default function QueuesPage() {
  const [queues, setQueues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/queues");
      setQueues(data.data ?? data.queues ?? data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="text-indigo-400" size={22} />
          <h1 className="text-xl font-bold text-white">Call Queues</h1>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors">
          <RefreshCw size={13} />Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-white/40 text-sm">Loading queues…</div>
      ) : queues.length === 0 ? (
        <div className="text-center py-16 text-white/40 text-sm">No call queues configured.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {queues.map((q) => {
            const members = q.members ?? q.agents ?? [];
            const online = members.filter((m: any) => m.state === "Waiting" || m.status === "available").length;
            const waiting = q.callsWaiting ?? q.calls_waiting ?? 0;
            const avgWait = q.avgWaitTime ?? q.avg_wait ?? null;

            return (
              <div key={q._id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}
                className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white/90">{q.name}</p>
                    <p className="text-xs text-white/40 mt-0.5">
                      {STRATEGY_LABELS[q.strategy] ?? q.strategy ?? "Default strategy"}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${waiting > 0 ? "bg-amber-500/20 text-amber-400" : "bg-white/5 text-white/40"}`}>
                    {waiting} waiting
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Users size={12} className="text-indigo-400" />
                    <span className="text-white/60">{online}/{members.length} agents online</span>
                  </div>
                  {avgWait != null && (
                    <div className="flex items-center gap-1.5">
                      <Clock size={12} className="text-white/40" />
                      <span className="text-white/40">~{avgWait}s avg wait</span>
                    </div>
                  )}
                  {q.maxWaitTime != null && (
                    <div className="flex items-center gap-1.5">
                      <PhoneCall size={12} className="text-white/40" />
                      <span className="text-white/40">max {q.maxWaitTime}s</span>
                    </div>
                  )}
                </div>

                {members.length > 0 && (
                  <div className="border-t border-white/5 pt-2 flex flex-wrap gap-1.5">
                    {members.map((m: any, i: number) => (
                      <span key={i}
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          m.state === "Waiting" || m.status === "available"
                            ? "bg-green-500/15 text-green-400"
                            : "bg-white/5 text-white/40"
                        }`}>
                        {m.extension ?? m.name ?? m.memberId ?? `Agent ${i + 1}`}
                      </span>
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
