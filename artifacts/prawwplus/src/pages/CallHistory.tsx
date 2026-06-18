import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useListCalls, useMakeCall, getListCallsQueryKey } from "@workspace/api-client-react";
import { formatDuration } from "@/lib/utils";
import { format } from "date-fns";
import {
  PhoneOutgoing, ChevronLeft, ChevronRight,
  PhoneMissed, PhoneOff, Phone, Trash2, ChevronDown, ChevronUp,
  PhoneIncoming, Voicemail, WifiOff, PhoneCall, Search, X,
} from "lucide-react";
import { useCall } from "@/context/CallContext";
import { useToast } from "@/hooks/use-toast";
import { useEslOfflineRetry } from "@/hooks/useEslOfflineRetry";
import { EslOfflineBanner } from "@/components/EslOfflineBanner";

type FilterType = "all" | "missed" | "incoming" | "outgoing";

const FILTERS: { key: FilterType; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "missed",   label: "Missed" },
  { key: "incoming", label: "Incoming" },
  { key: "outgoing", label: "Outgoing" },
];

function resolveCallDisplay(call: any) {
  const { status, hangupCause, direction } = call;

  if (status === "completed") {
    if (hangupCause === "ATTENDED_TRANSFER") {
      return { color: "#8E8E93", bg: "rgba(142,142,147,0.14)", label: "Voicemail",    Icon: Voicemail };
    }
    if (hangupCause === "ALLOTTED_TIMEOUT") {
      return { color: "#FF9500", bg: "rgba(255,149,0,0.14)", label: "Low balance",    Icon: PhoneOff };
    }
    if (direction === "inbound") {
      return { color: "#30D158", bg: "rgba(48,209,88,0.14)", label: "Answered",       Icon: PhoneIncoming };
    }
    return { color: "#30D158", bg: "rgba(48,209,88,0.14)", label: "Completed",        Icon: PhoneOutgoing };
  }
  if (status === "missed")    return { color: "#FFD60A", bg: "rgba(255,214,10,0.14)", label: "Missed",     Icon: PhoneMissed };
  if (status === "cancelled") return { color: "#FF9500", bg: "rgba(255,149,0,0.14)", label: "Cancelled",   Icon: PhoneOff };
  if (status === "failed") {
    if (hangupCause === "UNREGISTERED" || hangupCause === "USER_NOT_REGISTERED" ||
        hangupCause === "SUBSCRIBER_ABSENT" || hangupCause === "DESTINATION_OUT_OF_ORDER") {
      return { color: "#FF453A", bg: "rgba(255,69,58,0.14)", label: "Unavailable",    Icon: WifiOff };
    }
    if (hangupCause === "NO_ROUTE_DESTINATION" || hangupCause === "UNALLOCATED_NUMBER") {
      return { color: "#FF453A", bg: "rgba(255,69,58,0.14)", label: "Doesn't exist",  Icon: WifiOff };
    }
    if (hangupCause === "USER_BUSY") {
      return { color: "#FF9500", bg: "rgba(255,149,0,0.14)",  label: "Busy",          Icon: PhoneCall };
    }
    return { color: "#FF453A", bg: "rgba(255,69,58,0.14)", label: "Failed",           Icon: PhoneOff };
  }
  return { color: "#FFD60A", bg: "rgba(255,214,10,0.14)", label: "Missed",            Icon: PhoneMissed };
}

function formatCallDate(dateStr: string | Date) {
  const d = new Date(dateStr);
  const diffH = (Date.now() - d.getTime()) / 3_600_000;
  if (diffH < 1)  return "Just now";
  if (diffH < 24) return format(d, "h:mm a");
  if (diffH < 48) return "Yesterday";
  return format(d, "MMM d");
}

export default function CallHistory() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const { data, isLoading } = useListCalls({ page, limit: 20 });
  const { mutateAsync: initiateCall } = useMakeCall();
  const { toast } = useToast();
  const { startOutgoing, updateCallId, updateCallType, makeVertoCall, endCall, isVertoConnected } = useCall();
  const { eslOfflinePending, eslRetryNumberRef, handleEslOfflineError, stopEslRetry } = useEslOfflineRetry();
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { mutate: deleteCallMutation } = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/calls/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() }); },
  });

  const handleCallBack = async (number: string) => {
    if (!isVertoConnected) {
      toast({ title: "Not connected", description: "VoIP connection is not ready.", variant: "destructive" });
      return;
    }
    const fsCallId = crypto.randomUUID();
    startOutgoing({ number });
    try {
      const record = await initiateCall({ data: { recipientNumber: number, fsCallId } });
      stopEslRetry();
      if (record?.id) updateCallId(record.id);
      if (record?.type) updateCallType(record.type);
      const dialTarget = record?.type === "internal" ? String(record.extension) : number;
      if (record?.type === "internal" && (record as any).calleeNotified) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2500));
      }
      const vertoCallId = await makeVertoCall(dialTarget, fsCallId);
      if (!vertoCallId) throw new Error("Could not connect to the call server.");
    } catch (err: any) {
      endCall();
      if (handleEslOfflineError(err, number, () => handleCallBack(number))) return;
      toast({ title: "Call failed", description: err?.message ?? "Could not place the call.", variant: "destructive" });
    }
  };

  const handleDelete = (id: string) => {
    setDeletedIds((prev) => new Set([...prev, id]));
    if (expandedId === id) setExpandedId(null);
    deleteCallMutation(id);
  };

  const allCalls = (data?.calls ?? []).filter((c: any) => !deletedIds.has(c.id));

  const searchedCalls = search
    ? allCalls.filter((c: any) => {
        const q = search.toLowerCase();
        const num = (c.recipientNumber ?? c.callerNumber ?? c.number ?? "").toLowerCase();
        return num.includes(q);
      })
    : allCalls;

  const filteredCalls = searchedCalls.filter((c: any) => {
    if (filter === "all")      return true;
    if (filter === "missed")   return c.status !== "completed";
    if (filter === "incoming") return (c.direction ?? "").toLowerCase().includes("in");
    if (filter === "outgoing") return (c.direction ?? "").toLowerCase().includes("out");
    return true;
  });

  const skeletonRows = [...Array(6)];

  return (
    <div
      className="page-in"
      style={{
        display: "flex", flexDirection: "column", gap: 14,
        fontFamily: "-apple-system, 'SF Pro Text', 'Inter', sans-serif",
      }}
    >
      {/* ESL offline auto-retry banner */}
      {eslOfflinePending && (
        <EslOfflineBanner number={eslRetryNumberRef.current} onCancel={stopEslRetry} />
      )}

      {/* iOS 17 large title */}
      <div style={{ paddingTop: 4 }}>
        <h1 style={{
          fontSize: 34, fontWeight: 700,
          color: "var(--text-1)", margin: 0, letterSpacing: "-0.5px",
          fontFamily: "-apple-system, 'SF Pro Display', sans-serif",
        }}>
          Recents
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>
          {data?.total ? `${data.total} calls` : "Your recent calls"}
        </p>
      </div>

      {/* iOS-style search bar */}
      <div style={{ position: "relative" }}>
        <Search style={{
          position: "absolute", left: 12, top: "50%",
          transform: "translateY(-50%)",
          width: 14, height: 14, color: "rgba(235,235,245,0.45)",
          pointerEvents: "none",
        }} />
        <input
          type="text"
          placeholder="Search by number…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{
            width: "100%",
            padding: "9px 36px 9px 34px",
            borderRadius: 12,
            background: "rgba(118,118,128,0.24)",
            border: "none",
            fontSize: 15, color: "var(--text-1)", outline: "none",
            fontFamily: "inherit", boxSizing: "border-box",
          }}
        />
        {search && (
          <button
            onClick={() => { setSearch(""); setPage(1); }}
            style={{
              position: "absolute", right: 10, top: "50%",
              transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer",
              padding: 2, display: "flex", alignItems: "center",
            }}
          >
            <X style={{ width: 14, height: 14, color: "rgba(235,235,245,0.45)" }} />
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="chip-row">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`chip${filter === f.key ? " chip-active" : ""}`}
            onClick={() => { setFilter(f.key); setPage(1); }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="section-card">
          {skeletonRows.map((_, i) => (
            <div key={i} className="stagger-item">
              <div style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                <div className="skeleton" style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ height: 13, width: "55%", marginBottom: 7 }} />
                  <div className="skeleton" style={{ height: 10, width: "35%" }} />
                </div>
                <div className="skeleton" style={{ width: 60, height: 22, borderRadius: 10 }} />
              </div>
              {i < skeletonRows.length - 1 && <div className="row-sep" />}
            </div>
          ))}
        </div>
      ) : filteredCalls.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center" }}>
          <div className="float-card" style={{
            width: 72, height: 72, borderRadius: 24,
            background: "rgba(118,118,128,0.18)",
            border: "0.5px solid rgba(84,84,88,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
          }}>
            <PhoneMissed style={{ width: 30, height: 30, color: "rgba(235,235,245,0.35)" }} />
          </div>
          <p style={{ color: "var(--text-2)", fontSize: 15, marginBottom: 4 }}>
            {filter === "all" ? "No recent calls" : `No ${filter} calls`}
          </p>
          <p style={{ color: "var(--text-3)", fontSize: 13 }}>
            {filter !== "all" ? "Try a different filter" : "Your call history will appear here"}
          </p>
        </div>
      ) : (
        <div className="section-card">
          {filteredCalls.map((c: any, i: number, arr: any[]) => {
            const isExpanded = expandedId === c.id;
            const { color, bg, label, Icon } = resolveCallDisplay(c);
            const dateStr = c.startedAt ?? c.createdAt ?? c.date;
            const isInboundCall = (c.direction ?? "").toLowerCase().includes("in");
            const rawNum = isInboundCall
              ? (c.callerNumber ?? c.recipientNumber ?? c.number)
              : (c.recipientNumber ?? c.callerNumber ?? c.number);
            const displayNum = rawNum && !/^[1-9]\d{3}$/.test(String(rawNum).trim()) ? rawNum : "Unknown";

            return (
              <div key={c.id} className="stagger-item">
                <div
                  style={{ padding: "12px 16px", cursor: "pointer", transition: "background 0.12s" }}
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  onPointerDown={(e) => { e.currentTarget.style.background = "var(--glass-bg-strong)"; }}
                  onPointerUp={(e)   => { e.currentTarget.style.background = "transparent"; }}
                  onPointerLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {/* Call icon circle */}
                    <div style={{
                      width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                      background: bg,
                      border: `1.5px solid ${color}44`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon style={{ width: 16, height: 16, color }} />
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: 16, fontWeight: 600, color: "var(--text-1)",
                        margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {displayNum}
                      </p>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                          {dateStr ? formatCallDate(dateStr) : ""}
                        </span>
                        {c.duration != null && c.duration > 0 && (
                          <>
                            <span style={{ fontSize: 10, color: "var(--text-3)" }}>·</span>
                            <span style={{ fontSize: 12, color: "var(--text-3)" }}>{formatDuration(c.duration)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Status badge + chevron */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 8,
                        background: bg, color, whiteSpace: "nowrap",
                      }}>
                        {label}
                      </span>
                      {isExpanded
                        ? <ChevronUp   style={{ width: 14, height: 14, color: "var(--text-3)", flexShrink: 0 }} />
                        : <ChevronDown style={{ width: 14, height: 14, color: "var(--text-3)", flexShrink: 0 }} />
                      }
                    </div>
                  </div>

                  {/* Expanded actions */}
                  {isExpanded && (
                    <div style={{
                      marginTop: 12, paddingTop: 12,
                      borderTop: "0.5px solid rgba(84,84,88,0.65)",
                    }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn-press"
                          onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                          style={{
                            flex: 1, display: "flex", alignItems: "center",
                            justifyContent: "center", gap: 6,
                            padding: "10px 0", borderRadius: 12,
                            background: "rgba(255,59,48,0.12)",
                            border: "0.5px solid rgba(255,59,48,0.28)",
                            color: "#FF3B30", fontSize: 13, fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          <Trash2 style={{ width: 14, height: 14 }} /> Delete
                        </button>
                        <button
                          className="btn-press"
                          onClick={(e) => { e.stopPropagation(); handleCallBack(rawNum ?? ""); }}
                          style={{
                            flex: 1, display: "flex", alignItems: "center",
                            justifyContent: "center", gap: 6,
                            padding: "10px 0", borderRadius: 12,
                            background: "rgba(48,209,88,0.12)",
                            border: "0.5px solid rgba(48,209,88,0.28)",
                            color: "#30D158", fontSize: 13, fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          <Phone style={{ width: 14, height: 14 }} /> Call Back
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {i < arr.length - 1 && (
                  <div style={{
                    height: "0.5px",
                    background: "rgba(84,84,88,0.65)",
                    marginLeft: 72,
                  }} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
          <p style={{ fontSize: 12, color: "var(--text-3)" }}>
            Page {data.page} of {data.totalPages}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { icon: ChevronLeft,  disabled: page === 1,               onClick: () => setPage((p) => Math.max(1, p - 1)) },
              { icon: ChevronRight, disabled: page === data.totalPages, onClick: () => setPage((p) => Math.min(data.totalPages, p + 1)) },
            ].map(({ icon: Icon, disabled, onClick }, i) => (
              <button
                key={i}
                className="btn-press"
                onClick={onClick}
                disabled={disabled}
                style={{
                  width: 38, height: 38, borderRadius: 12,
                  background: "rgba(118,118,128,0.24)",
                  border: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: disabled ? "rgba(235,235,245,0.25)" : "var(--text-1)",
                  cursor: disabled ? "default" : "pointer",
                  opacity: disabled ? 0.35 : 1,
                }}
              >
                <Icon style={{ width: 16, height: 16 }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
