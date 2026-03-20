import { useState } from "react";
import { useListCalls } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDuration, cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  PhoneOutgoing, Clock, ChevronLeft, ChevronRight, PhoneMissed, PhoneOff, FileText
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <PhoneOutgoing className="h-4 w-4 text-emerald-400" />;
  if (status === "failed") return <PhoneOff className="h-4 w-4 text-red-400" />;
  return <PhoneMissed className="h-4 w-4 text-amber-400" />;
}

export default function CallHistory() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useListCalls({ page, limit: 20 });

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <div className="pt-2">
        <h1 className="text-2xl font-bold text-white">Call Logs</h1>
        <p className="text-sm text-white/40 mt-1">
          {data?.total ? `${data.total} total calls` : "Your outgoing call history"}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[72px] rounded-2xl glass animate-pulse" />
          ))}
        </div>
      ) : data?.calls.length === 0 ? (
        <div className="py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
            <FileText className="h-8 w-8 text-white/15" />
          </div>
          <p className="text-white/40 text-sm">No calls yet. Start dialing from the Dial Pad!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data?.calls.map((call) => (
            <div
              key={call.id}
              className="flex items-center gap-4 p-4 rounded-2xl glass border border-white/8 hover:border-white/15 transition-all"
            >
              {/* Icon */}
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border",
                call.status === "completed"
                  ? "bg-emerald-500/10 border-emerald-500/20"
                  : call.status === "failed"
                  ? "bg-red-500/10 border-red-500/20"
                  : "bg-amber-500/10 border-amber-500/20"
              )}>
                <StatusIcon status={call.status} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-mono font-semibold text-white text-sm">{call.recipientNumber}</p>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-white/40">
                  <span>{format(new Date(call.createdAt), "MMM d, h:mm a")}</span>
                  {call.duration > 0 && (
                    <>
                      <span>·</span>
                      <Clock className="h-3 w-3" />
                      <span>{formatDuration(call.duration)}</span>
                    </>
                  )}
                </div>
                {call.notes && (
                  <p className="text-xs text-white/30 mt-0.5 truncate">{call.notes}</p>
                )}
              </div>

              {/* Cost + Badge */}
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-white">{formatCurrency(call.cost)}</p>
                <Badge
                  variant={
                    call.status === "completed" ? "success" :
                    call.status === "failed" ? "destructive" : "default"
                  }
                  className="mt-1 text-[10px] capitalize"
                >
                  {call.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-white/40">
            Page {data.page} of {data.totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 rounded-xl glass border border-white/10 hover:border-white/20 disabled:opacity-30 transition-all"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page === data.totalPages}
              className="p-2 rounded-xl glass border border-white/10 hover:border-white/20 disabled:opacity-30 transition-all"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
