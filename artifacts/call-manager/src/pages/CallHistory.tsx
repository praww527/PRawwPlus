import { useState } from "react";
import { useListCalls, useListMyNumbers } from "@workspace/api-client-react";
import { formatCurrency, formatDuration } from "@/lib/utils";
import { format } from "date-fns";
import {
  PhoneOutgoing, Clock, ChevronLeft, ChevronRight,
  PhoneMissed, PhoneOff, FileText, Phone,
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

export default function CallHistory() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useListCalls({ page, limit: 20 });
  const { data: numbersData } = useListMyNumbers();
  const { startOutgoing } = useCall();
  const { toast } = useToast();

  const primaryNumber = numbersData?.myNumbers?.[0] ?? null;

  const handleCallBack = (number: string) => {
    if (!primaryNumber) {
      toast({ title: "No number assigned", description: "Claim a number first.", variant: "destructive" });
      return;
    }
    startOutgoing({ number });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
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
      ) : data?.calls.length === 0 ? (
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
        <div className="section-card">
          {data?.calls.map((call, i, arr) => {
            const colors = statusColors(call.status);
            return (
              <div key={call.id}>
                <div style={{ padding: "11px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  {/* Status icon badge */}
                  <div style={{
                    width: 42, height: 42, borderRadius: 13,
                    background: colors.bg,
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <StatusIcon status={call.status} />
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontFamily: "monospace",
                      fontWeight: 600,
                      fontSize: 15,
                      color: "var(--text-1)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      margin: 0,
                    }}>
                      {call.recipientNumber}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                      <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                        {format(new Date(call.createdAt), "MMM d, h:mm a")}
                      </span>
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

                  {/* Cost + Call-back */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
                        {formatCurrency(call.cost)}
                      </p>
                      <p style={{
                        fontSize: 10, fontWeight: 600,
                        textTransform: "capitalize",
                        color: colors.label,
                        marginTop: 2,
                      }}>
                        {call.status}
                      </p>
                    </div>

                    {/* Glass call-back button */}
                    <button
                      className="btn-press"
                      onClick={() => handleCallBack(call.recipientNumber)}
                      style={{
                        width: 38, height: 38,
                        borderRadius: 13,
                        background: "rgba(48,209,88,0.12)",
                        border: "1px solid rgba(48,209,88,0.20)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <Phone style={{ width: 16, height: 16, color: "#30d158" }} />
                    </button>
                  </div>
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
                  background: "var(--glass-bg)",
                  border: "1px solid var(--glass-border)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
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
