import { useState, useRef } from "react";
import { useListCalls, useMakeCall, useGetMe } from "@workspace/api-client-react";
import { formatDuration } from "@/lib/utils";
import { format } from "date-fns";
import {
  PhoneOutgoing, Clock, ChevronLeft, ChevronRight,
  PhoneMissed, PhoneOff, FileText, Phone, Trash2, ChevronDown, ChevronUp,
} from "lucide-react";
import { useCall } from "@/context/CallContext";
import { useToast } from "@/hooks/use-toast";

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <PhoneOutgoing className="h-4 w-4" style={{ color: "#30d158" }} />;
  if (status === "failed")    return <PhoneOff      className="h-4 w-4" style={{ color: "#ff453a" }} />;
  return                             <PhoneMissed   className="h-4 w-4" style={{ color: "#ffd60a" }} />;
}

function statusColors(status: string) {
  if (status === "completed") return { bg: "rgba(48,209,88,0.13)",  label: "#30d158" };
  if (status === "failed")    return { bg: "rgba(255,69,58,0.13)",  label: "#ff453a" };
  return                             { bg: "rgba(255,214,10,0.13)", label: "#ffd60a" };
}

function isInternalNum(num: string): boolean {
  const d = num.replace(/\D/g, "");
  return d.length === 4;
}

export default function CallHistory() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useListCalls({ page, limit: 20 });
  const { data: user } = useGetMe();
  const { mutateAsync: initiateCall } = useMakeCall();
  const { toast } = useToast();
  const { startOutgoing, updateCallId, makeVertoCall, endCall, isVertoConnected } = useCall();
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleCallBack = async (number: string) => {
    const callType: "internal" | "external" = isInternalNum(number) ? "internal" : "external";
    const isInternal = callType === "internal";
    const coins = user?.coins ?? 0;
    const isActive = user?.subscriptionStatus === "active";

    if (!isVertoConnected) {
      toast({ title: "Not connected", description: "VoIP connection is not ready.", variant: "destructive" });
      return;
    }

    if (!isInternal && (!isActive || coins <= 0)) {
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
    setSwipedId(null);
    if (expandedId === id) setExpandedId(null);
  };

  const calls = (data?.calls ?? []).filter((c) => !deletedIds.has(c.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ paddingTop: 4 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--text-1)", fontFamily: "var(--font-display)", margin: 0 }}>
          Recents
        </h1>
        {data?.total ? (
          <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>{data.total} calls</p>
        ) : null}
      </div>

      {isLoading ? (
        <div className="section-card">
          {[...Array(6)].map((_, i) => (
            <div key={i}>
              <div style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "var(--glass-bg)", border: "1px solid var(--glass-border)", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: 14, width: "60%", borderRadius: 6, background: "var(--glass-bg)", marginBottom: 6 }} />
                  <div style={{ height: 11, width: "40%", borderRadius: 6, background: "var(--glass-bg)" }} />
                </div>
              </div>
              {i < 5 && <div className="row-sep" />}
            </div>
          ))}
        </div>
      ) : calls.length === 0 ? (
        <div style={{ padding: "64px 0", textAlign: "center" }}>
          <div style={{
            width: 72, height: 72, borderRadius: 24,
            background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
          }}>
            <FileText style={{ width: 30, height: 30, color: "var(--text-3)" }} />
          </div>
          <p style={{ color: "var(--text-2)", fontSize: 15 }}>No calls yet. Start dialing!</p>
        </div>
      ) : (
        <div className="section-card" style={{ overflow: "hidden" }}>
          {calls.map((call, i, arr) => {
            const colors = statusColors(call.status);
            const internal = call.callType === "internal";
            const isSwiped = swipedId === call.id;
            const isExpanded = expandedId === call.id;

            return (
              <div key={call.id} style={{ position: "relative", overflow: "hidden" }}>
                {/* Delete reveal */}
                <div style={{
                  position: "absolute", right: 0, top: 0, bottom: 0, width: 80,
                  background: "#ff453a",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  zIndex: 0,
                }}>
                  <button
                    onClick={() => handleDelete(call.id)}
                    style={{ width: "100%", height: "100%", background: "none", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                  >
                    <Trash2 style={{ width: 20, height: 20, color: "#fff" }} />
                  </button>
                </div>

                {/* Row content */}
                <div
                  style={{
                    position: "relative", zIndex: 1,
                    transform: isSwiped ? "translateX(-80px)" : "translateX(0)",
                    transition: "transform 0.25s ease",
                    background: "var(--surface-1, var(--surface-0))",
                  }}
                  onPointerDown={(e) => {
                    const startX = e.clientX;
                    const onMove = (ev: PointerEvent) => {
                      const dx = ev.clientX - startX;
                      if (dx < -24) setSwipedId(call.id);
                      else if (dx > 24) setSwipedId(null);
                    };
                    const onUp = () => {
                      document.removeEventListener("pointermove", onMove);
                      document.removeEventListener("pointerup", onUp);
                    };
                    document.addEventListener("pointermove", onMove);
                    document.addEventListener("pointerup", onUp);
                  }}
                >
                  <div style={{ padding: "11px 16px" }}>
                    {/* Main row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{
                        width: 42, height: 42, borderRadius: 13,
                        background: colors.bg,
                        border: "1px solid rgba(255,255,255,0.06)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}>
                        <StatusIcon status={call.status} />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontFamily: "monospace", fontWeight: 600, fontSize: 15,
                          color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: "nowrap", margin: 0,
                        }}>
                          {call.recipientNumber}
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                            {format(new Date(call.createdAt), "MMM d, h:mm a")}
                          </span>
                          {internal && (
                            <>
                              <span style={{ color: "var(--sep-strong)", fontSize: 11 }}>·</span>
                              <span style={{ fontSize: 11, color: "#30d158", fontWeight: 600 }}>EXT</span>
                            </>
                          )}
                          {call.duration > 0 && (
                            <>
                              <span style={{ color: "var(--sep-strong)", fontSize: 11 }}>·</span>
                              <Clock style={{ width: 11, height: 11, color: "var(--text-3)" }} />
                              <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                                {formatDuration(call.duration)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        {/* Expand toggle */}
                        <button
                          className="btn-press"
                          onClick={() => setExpandedId((id) => id === call.id ? null : call.id)}
                          style={{
                            width: 32, height: 32, borderRadius: 10,
                            background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer",
                          }}
                        >
                          {isExpanded
                            ? <ChevronUp style={{ width: 14, height: 14, color: "var(--text-2)" }} />
                            : <ChevronDown style={{ width: 14, height: 14, color: "var(--text-2)" }} />
                          }
                        </button>

                        <button
                          className="btn-press"
                          onClick={() => handleCallBack(call.recipientNumber)}
                          style={{
                            width: 38, height: 38, borderRadius: 13,
                            background: "rgba(48,209,88,0.12)",
                            border: "1px solid rgba(48,209,88,0.20)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer", flexShrink: 0,
                          }}
                        >
                          <Phone style={{ width: 16, height: 16, color: "#30d158" }} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{
                        marginTop: 12, paddingTop: 12,
                        borderTop: "1px solid var(--sep)",
                        display: "flex", flexDirection: "column", gap: 6,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 12, color: "var(--text-3)" }}>Status</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: colors.label, textTransform: "capitalize" }}>
                            {call.status}
                          </span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 12, color: "var(--text-3)" }}>Type</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
                            {internal ? "Extension" : "External"}
                          </span>
                        </div>
                        {call.duration > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 12, color: "var(--text-3)" }}>Duration</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
                              {formatDuration(call.duration)}
                            </span>
                          </div>
                        )}
                        {call.failReason && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 12, color: "var(--text-3)" }}>Reason</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#ff453a" }}>{call.failReason}</span>
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 12, color: "var(--text-3)" }}>Date</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
                            {format(new Date(call.createdAt), "MMM d yyyy, h:mm a")}
                          </span>
                        </div>

                        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                          <button
                            onClick={() => handleDelete(call.id)}
                            style={{
                              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                              padding: "9px 0", borderRadius: 10,
                              background: "rgba(255,69,58,0.1)", border: "1px solid rgba(255,69,58,0.2)",
                              color: "#ff453a", fontSize: 12, fontWeight: 600, cursor: "pointer",
                            }}
                          >
                            <Trash2 style={{ width: 13, height: 13 }} /> Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {i < arr.length - 1 && <div className="row-sep" />}
              </div>
            );
          })}
        </div>
      )}

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
