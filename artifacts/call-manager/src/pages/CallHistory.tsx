import { useState } from "react";
import { useListCalls } from "@workspace/api-client-react";
import { formatCurrency, formatDuration, cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  PhoneOutgoing, Clock, ChevronLeft, ChevronRight,
  PhoneMissed, PhoneOff, FileText,
} from "lucide-react";

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <PhoneOutgoing className="h-4 w-4" style={{ color: "#30d158" }} />;
  if (status === "failed")    return <PhoneOff      className="h-4 w-4" style={{ color: "#ff453a" }} />;
  return                             <PhoneMissed   className="h-4 w-4" style={{ color: "#ffd60a" }} />;
}

function statusColor(status: string) {
  if (status === "completed") return { bg: "rgba(48,209,88,0.14)",  icon: "rgba(48,209,88,0.9)" };
  if (status === "failed")    return { bg: "rgba(255,69,58,0.14)",  icon: "rgba(255,69,58,0.9)" };
  return                             { bg: "rgba(255,214,10,0.14)", icon: "rgba(255,214,10,0.9)" };
}

export default function CallHistory() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useListCalls({ page, limit: 20 });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div style={{ paddingTop: 4 }}>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-1)" }}>Recents</h1>
        {data?.total ? (
          <p className="text-sm mt-0.5" style={{ color: "var(--text-3)" }}>{data.total} calls</p>
        ) : null}
      </div>

      {isLoading ? (
        <div className="section-card">
          {[...Array(6)].map((_, i) => (
            <div key={i}>
              <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--surface-2)" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: 14, width: "60%", borderRadius: 6, background: "var(--surface-2)", marginBottom: 6 }} />
                  <div style={{ height: 11, width: "40%", borderRadius: 6, background: "var(--surface-2)" }} />
                </div>
              </div>
              {i < 5 && <div className="row-sep" />}
            </div>
          ))}
        </div>
      ) : data?.calls.length === 0 ? (
        <div style={{ padding: "64px 0", textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: 20,
            background: "var(--surface-1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
          }}>
            <FileText style={{ width: 28, height: 28, color: "var(--text-3)" }} />
          </div>
          <p style={{ color: "var(--text-2)", fontSize: 15 }}>No calls yet. Start dialing!</p>
        </div>
      ) : (
        <div className="section-card">
          {data?.calls.map((call, i, arr) => {
            const colors = statusColor(call.status);
            return (
              <div key={call.id}>
                <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  {/* Icon */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: colors.bg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <StatusIcon status={call.status} />
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontWeight: 600,
                      fontSize: 15,
                      color: "var(--text-1)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {call.recipientNumber}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                        {format(new Date(call.createdAt), "MMM d, h:mm a")}
                      </span>
                      {call.duration > 0 && (
                        <>
                          <span style={{ color: "var(--text-3)", fontSize: 11 }}>·</span>
                          <Clock style={{ width: 11, height: 11, color: "var(--text-3)" }} />
                          <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                            {formatDuration(call.duration)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Cost */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
                      {formatCurrency(call.cost)}
                    </p>
                    <p style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "capitalize",
                      color: call.status === "completed" ? "#30d158" : call.status === "failed" ? "#ff453a" : "#ffd60a",
                      marginTop: 2,
                    }}>
                      {call.status}
                    </p>
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
                onClick={onClick}
                disabled={disabled}
                style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: "var(--surface-1)",
                  border: "1px solid var(--sep)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: disabled ? "var(--text-3)" : "var(--text-1)",
                  cursor: disabled ? "default" : "pointer",
                  opacity: disabled ? 0.4 : 1,
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
