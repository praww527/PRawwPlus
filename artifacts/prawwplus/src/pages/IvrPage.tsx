import { useState, useEffect } from "react";
import { PhoneForwarded, Plus, Trash2, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
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

const ACTION_LABELS: Record<string, string> = {
  extension: "Transfer to Extension",
  voicemail: "Send to Voicemail",
  queue:     "Send to Queue",
  ivr:       "Go to IVR Menu",
  hangup:    "Hang Up",
};

export default function IvrPage() {
  const [menus, setMenus] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const { toast } = useToast();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/ivr");
      setMenus(data.data ?? data.menus ?? data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createMenu() {
    if (!newName.trim()) return;
    try {
      const data = await apiFetch("/ivr", { method: "POST", body: JSON.stringify({ name: newName.trim() }) });
      setMenus((m) => [...m, data.data ?? data]);
      setNewName("");
      setCreating(false);
      toast({ title: "IVR menu created" });
    } catch (e: any) {
      toast({ title: "Failed to create IVR menu", description: e.message, variant: "destructive" });
    }
  }

  async function deleteMenu(id: string) {
    if (!confirm("Delete this IVR menu?")) return;
    try {
      await apiFetch(`/ivr/${id}`, { method: "DELETE" });
      setMenus((m) => m.filter((x) => x._id !== id));
      toast({ title: "IVR menu deleted" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PhoneForwarded className="text-indigo-400" size={22} />
          <h1 className="text-xl font-bold text-white">IVR Menus</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors">
            <RefreshCw size={13} />
          </button>
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors">
            <Plus size={13} />New Menu
          </button>
        </div>
      </div>

      {creating && (
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14 }} className="p-4 flex gap-2">
          <input
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-indigo-400"
            placeholder="Menu name (e.g. Main Menu)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createMenu()}
            autoFocus
          />
          <button onClick={createMenu} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors">Create</button>
          <button onClick={() => setCreating(false)} className="text-xs text-white/40 hover:text-white/70 px-2">Cancel</button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-white/40 text-sm">Loading IVR menus…</div>
      ) : menus.length === 0 ? (
        <div className="text-center py-16 text-white/40 text-sm">No IVR menus configured. Create your first menu above.</div>
      ) : (
        <div className="space-y-2">
          {menus.map((menu) => (
            <div key={menu._id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14 }}>
              <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => setExpanded(expanded === menu._id ? null : menu._id)}>
                {expanded === menu._id ? <ChevronDown size={16} className="text-white/40" /> : <ChevronRight size={16} className="text-white/40" />}
                <div className="flex-1">
                  <p className="text-sm font-semibold text-white/90">{menu.name}</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {(menu.entries?.length ?? 0)} key{(menu.entries?.length ?? 0) !== 1 ? "s" : ""} configured
                    {menu.greeting ? " · Custom greeting" : ""}
                  </p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteMenu(menu._id); }}
                  className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 flex items-center justify-center transition-colors">
                  <Trash2 size={13} className="text-white/30 hover:text-red-400" />
                </button>
              </div>

              {expanded === menu._id && (menu.entries?.length ?? 0) > 0 && (
                <div className="border-t border-white/5 px-4 pb-4 pt-2 space-y-1.5">
                  {(menu.entries ?? []).map((e: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 text-xs py-1.5 px-2 rounded-lg bg-white/3">
                      <span className="w-8 h-8 rounded-lg bg-indigo-600/30 flex items-center justify-center font-bold text-indigo-300 shrink-0">
                        {e.key ?? i}
                      </span>
                      <span className="text-white/60">{ACTION_LABELS[e.action] ?? e.action ?? "Action"}</span>
                      {e.destination && <span className="text-white/40">→ {e.destination}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
