import { useState } from "react";
import { useListCalls } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDuration, cn } from "@/lib/utils";
import { format } from "date-fns";
import { Phone, PhoneOutgoing, Clock, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function CallHistory() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useListCalls({ page, limit: 15 });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-display">Call History</h1>
          <p className="text-white/60 mt-1">A detailed log of all your outgoing calls.</p>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-white/50 bg-white/5 uppercase border-b border-white/10">
              <tr>
                <th className="px-6 py-4 font-semibold">Recipient</th>
                <th className="px-6 py-4 font-semibold">Date & Time</th>
                <th className="px-6 py-4 font-semibold">Duration</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4"><Skeleton className="h-5 w-32 bg-white/10" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-5 w-24 bg-white/10" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-5 w-16 bg-white/10" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-6 w-20 rounded-full bg-white/10" /></td>
                    <td className="px-6 py-4 text-right"><Skeleton className="h-5 w-16 bg-white/10 ml-auto" /></td>
                  </tr>
                ))
              ) : data?.calls.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-white/50">
                    <div className="flex flex-col items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3">
                        <FileText className="h-6 w-6 text-white/30" />
                      </div>
                      No call records found for this period.
                    </div>
                  </td>
                </tr>
              ) : (
                data?.calls.map((call) => (
                  <tr key={call.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="bg-white/5 p-2 rounded-lg text-white/70 group-hover:text-primary transition-colors">
                          <PhoneOutgoing className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-semibold font-mono tracking-wide">{call.recipientNumber}</p>
                          {call.notes && <p className="text-xs text-white/40 mt-0.5 truncate max-w-[150px]">{call.notes}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-white/70 whitespace-nowrap">
                      {format(new Date(call.createdAt), 'MMM d, yyyy')}
                      <span className="block text-xs text-white/40 mt-0.5">
                        {format(new Date(call.createdAt), 'h:mm a')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-white/70">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-white/40" />
                        {formatDuration(call.duration)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={
                        call.status === 'completed' ? 'success' : 
                        call.status === 'failed' ? 'destructive' : 'default'
                      } className="capitalize">
                        {call.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-white">
                      {formatCurrency(call.cost)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="p-4 border-t border-white/10 flex items-center justify-between bg-black/20">
            <p className="text-sm text-white/50">
              Showing page <span className="text-white font-medium">{data.page}</span> of <span className="text-white font-medium">{data.totalPages}</span>
            </p>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button 
                onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                disabled={page === data.totalPages}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
