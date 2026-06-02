import { useState, useEffect } from "react";
import { Hash, RefreshCw, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { apiFetch } from "@/lib/apiFetch";

async function apiFetchJson(path: string, opts?: RequestInit) {
  const res = await apiFetch(`/api${path}`, { credentials: "include", ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

type Tab = "numbers" | "port";

function StatusBadge({ status }: { status: string }) {
  const s = (status ?? "").toLowerCase();
  if (s === "active" || s === "available") return <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">Active</span>;
  if (s === "pending") return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Pending</span>;
  if (s === "reserved") return <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400">Reserved</span>;
  if (s === "cancelled" || s === "failed") return <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">{status}</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/50">{status ?? "Unknown"}</span>;
}

function PortStatusIcon({ status }: { status: string }) {
  const s = (status ?? "").toLowerCase();
  if (s === "completed" || s === "active") return <CheckCircle size={14} className="text-green-400" />;
  if (s === "pending" || s === "submitted") return <Clock size={14} className="text-amber-400" />;
  if (s === "failed" || s === "rejected") return <XCircle size={14} className="text-red-400" />;
  return <AlertCircle size={14} className="text-white/30" />;
}

export default function NumbersPage() {
  const [tab, setTab] = useState<Tab>("numbers");
  const [numbers, setNumbers] = useState<any[]>([]);
  const [portReqs, setPortReqs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [numData, portData] = await Promise.allSettled([
        apiFetchJson("/numbers"),
        apiFetchJson("/portRequests"),
      ]);
      if (numData.status === "fulfilled") {
        setNumbers(numData.value.data ?? numData.value.numbers ?? numData.value ?? []);
      } else {
        setNumbers([]);
        const msg = numData.reason instanceof Error ? numData.reason.message : "Failed to load phone numbers";
        setError((prev) => prev ? `${prev}; ${msg}` : msg);
      }
      if (portData.status === "fulfilled") {
        setPortReqs(portData.value.data ?? portData.value.requests ?? portData.value ?? []);
      } else {
        setPortReqs([]);
        const msg = portData.reason instanceof Error ? portData.reason.message : "Failed to load port requests";
        setError((prev) => prev ? `${prev}; ${msg}` : msg);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "numbers", label: "Phone Numbers", count: numbers.length },
    { key: "port",    label: "Port Requests",  count: portReqs.length },
  ];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hash className="text-indigo-400" size={22} />
          <h1 className="text-xl font-bold text-white">Numbers</h1>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors">
          <RefreshCw size={13} />Refresh
        </button>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-white/5 w-fit">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`text-xs px-4 py-1.5 rounded-lg font-medium transition-colors ${tab === t.key ? "bg-indigo-600 text-white" : "text-white/50 hover:text-white/80"}`}>
            {t.label}{t.count !== undefined && t.count > 0 ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-white/40 text-sm">Loading…</div>
      ) : tab === "numbers" ? (
        numbers.length === 0 ? (
          <div className="text-center py-16 text-white/40 text-sm">No phone numbers found.</div>
        ) : (
          <div className="space-y-2">
            {numbers.map((n) => (
              <div key={n._id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }}
                className="flex items-center gap-3 p-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-600/20 flex items-center justify-center shrink-0">
                  <Hash size={15} className="text-indigo-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white/90 font-mono tracking-wide">{n.number ?? n.phoneNumber}</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {n.type ?? n.numberType ?? "DID"}
                    {n.assignedTo ? ` · ${n.assignedTo}` : " · Unassigned"}
                    {n.capability ? ` · ${Array.isArray(n.capability) ? n.capability.join(", ") : n.capability}` : ""}
                  </p>
                </div>
                <StatusBadge status={n.status ?? "active"} />
              </div>
            ))}
          </div>
        )
      ) : (
        portReqs.length === 0 ? (
          <div className="text-center py-16 text-white/40 text-sm">No port requests found.</div>
        ) : (
          <div className="space-y-2">
            {portReqs.map((p) => (
              <div key={p._id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }}
                className="flex items-center gap-3 p-3">
                <PortStatusIcon status={p.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white/90 font-mono">{p.number ?? p.phoneNumber}</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {p.carrier ? `From: ${p.carrier}` : ""}
                    {p.submittedAt ? ` · Submitted ${format(new Date(p.submittedAt), "MMM d, yyyy")}` : ""}
                    {p.portDate ? ` · Port date: ${format(new Date(p.portDate), "MMM d, yyyy")}` : ""}
                  </p>
                </div>
                <StatusBadge status={p.status ?? "pending"} />
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
