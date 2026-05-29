import { useState, useEffect } from "react";
import { BarChart2, Download, RefreshCw, ChevronLeft, ChevronRight, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { format, subDays } from "date-fns";
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

function fmtDuration(s: number) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

function fmtCoins(c: number) {
  if (c == null) return "—";
  return `${c.toFixed(2)} coins`;
}

export default function CdrPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const weekAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");

  const [from, setFrom] = useState(weekAgo);
  const [to, setTo]     = useState(today);
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<any[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();
  const limit = 25;

  async function load(p = page) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, page: String(p), limit: String(limit) });
      const data = await apiFetch(`/cdr?${params}`);
      setRecords(data.data ?? data.records ?? data.cdrs ?? []);
      setTotal(data.total ?? data.count ?? 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1); setPage(1); }, [from, to]);

  async function exportCsv() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/api/cdr/export?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cdr_${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  const pages = Math.ceil(total / limit);

  function changePage(p: number) {
    setPage(p);
    load(p);
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart2 className="text-indigo-400" size={22} />
          <h1 className="text-xl font-bold text-white">Call Detail Records</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-indigo-400" />
          <span className="text-white/30 text-xs">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-indigo-400" />
          <button onClick={() => load(page)} className="text-xs text-white/50 hover:text-white/80 transition-colors">
            <RefreshCw size={13} />
          </button>
          <button onClick={exportCsv} disabled={exporting}
            className="flex items-center gap-1.5 text-xs bg-indigo-600/80 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
            <Download size={12} />
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      )}

      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16 }} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {["Date & Time","Direction","From","To","Duration","Status","Cost"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-white/40 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-white/30">Loading…</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-white/30">No records for this period.</td></tr>
              ) : records.map((r, i) => (
                <tr key={r._id ?? i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                  className="hover:bg-white/2 transition-colors">
                  <td className="px-4 py-2.5 text-white/60">
                    {r.startTime ? format(new Date(r.startTime), "MMM d, h:mm a") : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.direction === "inbound"
                      ? <PhoneIncoming size={12} className="text-green-400" />
                      : <PhoneOutgoing size={12} className="text-indigo-400" />}
                  </td>
                  <td className="px-4 py-2.5 text-white/70 font-mono">{r.fromNumber ?? r.from ?? "—"}</td>
                  <td className="px-4 py-2.5 text-white/70 font-mono">{r.toNumber ?? r.to ?? "—"}</td>
                  <td className="px-4 py-2.5 text-white/60">{fmtDuration(r.billsec ?? r.duration ?? 0)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                      r.status === "completed" ? "bg-green-500/15 text-green-400" :
                      r.status === "missed"    ? "bg-amber-500/15 text-amber-400" :
                      r.status === "failed"    ? "bg-red-500/15 text-red-400" :
                      "bg-white/5 text-white/40"
                    }`}>{r.status ?? "—"}</span>
                  </td>
                  <td className="px-4 py-2.5 text-white/40">{fmtCoins(r.cost ?? r.coins)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
            <span className="text-xs text-white/40">{total} record{total !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => changePage(page - 1)} disabled={page <= 1}
                className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center disabled:opacity-30 transition-colors">
                <ChevronLeft size={13} className="text-white/60" />
              </button>
              <span className="text-xs text-white/40">{page} / {pages}</span>
              <button onClick={() => changePage(page + 1)} disabled={page >= pages}
                className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center disabled:opacity-30 transition-colors">
                <ChevronRight size={13} className="text-white/60" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
