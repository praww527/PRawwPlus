import { useState } from "react";
import { useListCalls, useMakeCall, useGetMe } from "@workspace/api-client-react";
import { formatDuration } from "@/lib/utils";
import { format } from "date-fns";
import {
  PhoneOutgoing, ChevronLeft, ChevronRight,
  PhoneMissed, PhoneOff, Phone, Trash2, ChevronDown, ChevronUp,
  PhoneIncoming, Voicemail, WifiOff, PhoneCall,
} from "lucide-react";
import { useCall } from "@/context/CallContext";
import { useToast } from "@/hooks/use-toast";

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
      return { color: "#636366", bg: "rgba(99,99,102,0.14)", label: "Voicemail",   Icon: Voicemail };
    }
    if (hangupCause === "ALLOTTED_TIMEOUT") {
      return { color: "#ff9f0a", bg: "rgba(255,159,10,0.14)", label: "Low balance", Icon: PhoneOff };
    }
    if (direction === "inbound") {
      return { color: "#30d158", bg: "rgba(48,209,88,0.14)", label: "Answered",    Icon: PhoneIncoming };
    }
    return { color: "#30d158", bg: "rgba(48,209,88,0.14)", label: "Completed",     Icon: PhoneOutgoing };
  }
  if (status === "missed")    return { color: "#ffd60a", bg: "rgba(255,214,10,0.14)", label: "Missed",     Icon: PhoneMissed };
  if (status === "cancelled") return { color: "#ff9f0a", bg: "rgba(255,159,10,0.14)", label: "Cancelled",  Icon: PhoneOff };
  if (status === "failed") {
    if (hangupCause === "UNREGISTERED" || hangupCause === "USER_NOT_REGISTERED" ||
        hangupCause === "SUBSCRIBER_ABSENT" || hangupCause === "DESTINATION_OUT_OF_ORDER") {
      return { color: "#ff453a", bg: "rgba(255,69,58,0.14)", label: "Unavailable",         Icon: WifiOff };
    }
    if (hangupCause === "NO_ROUTE_DESTINATION" || hangupCause === "UNALLOCATED_NUMBER") {
      return { color: "#ff453a", bg: "rgba(255,69,58,0.14)", label: "Doesn't exist",        Icon: WifiOff };
    }
    if (hangupCause === "USER_BUSY") {
      return { color: "#ff9f0a", bg: "rgba(255,159,10,0.14)", label: "Busy",                Icon: PhoneCall };
    }
    return { color: "#ff453a", bg: "rgba(255,69,58,0.14)", label: "Failed",                 Icon: PhoneOff };
  }
  return { color: "#ffd60a", bg: "rgba(255,214,10,0.14)", label: "Missed", Icon: PhoneMissed };
}

function isInternalNum(num: string): boolean {
  return num.replace(/\D/g, "").length === 4;
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
  const { data, isLoading } = useListCalls({ page, limit: 20 });
  const { data: user } = useGetMe();
  const { mutateAsync: initiateCall } = useMakeCall();
  const { toast } = useToast();
  const { startOutgoing, updateCallId, makeVertoCall, endCall, isVertoConnected } = useCall();
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleCallBack = async (number: string) => {
    const callType: "internal" | "external" = isInternalNum(number) ? "internal" : "external";
    const coins = user?.coins ?? 0;
    const isActive = user?.subscriptionStatus === "active";

    if (!isVertoConnected) {
      toast({ title: "Not connected", description: "VoIP connection is not ready.", variant: "destructive" });
      return;
    }
    if (callType === "external" && (!isActive || coins <= 0)) {
      toast({ title: "Cannot call back", description: !isActive ? "Subscribe to make external calls" : "Top up your balance", variant: "destructive" });
      return;
    }

    const fsCallId = crypto.randomUUID();
    startOutgoing({ number, callType });
    try {
      const record = await initiateCall({ data: { recipientNumber: number, fsCallId } });
      if (record?.id) updateCallId(record.id);
      const vertoCallId = await makeVertoCall(number, fsCallId);
      if (!vertoCallId) throw new Error("Could not connect to the call server.");
    } catch (err: any) {
      endCall();
      toast({ title: "Call failed", description: err?.message ?? "Could not place the call.", variant: "destructive" });
    }
  };

  const handleDelete = (id: string) => {
    setDeletedIds((prev) => new Set([...prev, id]));
    if (expandedId === id) setExpandedId(null);
  };

  const allCalls = (data?.calls ?? []).filter((c: any) => !deletedIds.has(c.id));

  const filteredCalls = allCalls.filter((c: any) => {
    if (filter === "all")      return true;
    if (filter === "missed")   return c.status !== "completed";
    if (filter === "incoming") return (c.direction ?? "").toLowerCase().includes("in");
    if (filter === "outgoing") return (c.direction ?? "").toLowerCase().includes("out");
    return true;
  });

  const skeletonRows = [...Array(6)];

  return (
    <div className="page-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Page title */}
      <div style={{ paddingTop: 4 }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)", margin: 0, letterSpacing: "-0.02em" }}>
          Recents
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 3 }}>
          {data?.total ? `${data.total} calls` : "Your recent calls"}
        </p>
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
            background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
            backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
            boxShadow: "0 4px 24px var(--glass-shadow), 0 1px 0 var(--glass-highlight) inset",
          }}>
            <PhoneMissed style={{ width: 30, height: 30, color: "var(--text-3)" }} />
          </div>
          <p style={{ color: "var(--text-2)", fontSize: 15, marginBottom: 6 }}>
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
            const displayNum = c.recipientNumber ?? c.callerNumber ?? c.number ?? "Unknown";

            return (
              <div key={c.id} className="stagger-item">
                <div
                  style={{ padding: "11px 16px", cursor: "pointer", transition: "background 0.15s" }}
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  onPointerDown={(e) => { e.currentTarget.style.background = "var(--glass-bg-strong)"; }}
                  onPointerUp={(e) => { e.currentTarget.style.background = "transparent"; }}
                  onPointerLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {/* Avatar circle */}
                    <div style={{
                      width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                      background: bg, border: `1.5px solid ${color}44`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon className="h-4 w-4" style={{ color }} />
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                        ? <ChevronUp  style={{ width: 14, height: 14, color: "var(--text-3)", flexShrink: 0 }} />
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
                          onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
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
                          onClick={(e) => { e.stopPropagation(); handleCallBack(displayNum); }}
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

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
          <p style={{ fontSize: 12, color: "var(--text-3)" }}>Page {data.page} of {data.totalPages}</p>
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
                  background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                  backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: disabled ? "var(--text-3)" : "var(--text-1)",
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
