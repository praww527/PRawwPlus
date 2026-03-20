import { useListPayments } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { Receipt, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function PaymentHistory() {
  const { data, isLoading } = useListPayments();

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold font-display">Billing & Payments</h1>
        <p className="text-white/60 mt-1">View your subscription and top-up payment history.</p>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-white/50 bg-white/5 uppercase border-b border-white/10">
              <tr>
                <th className="px-6 py-4 font-semibold">Transaction ID</th>
                <th className="px-6 py-4 font-semibold">Date</th>
                <th className="px-6 py-4 font-semibold">Type</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4"><Skeleton className="h-5 w-24 bg-white/10" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-5 w-32 bg-white/10" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-5 w-20 bg-white/10" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-6 w-20 rounded-full bg-white/10" /></td>
                    <td className="px-6 py-4 text-right"><Skeleton className="h-5 w-16 bg-white/10 ml-auto" /></td>
                  </tr>
                ))
              ) : data?.payments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-white/50">
                    <div className="flex flex-col items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3">
                        <Receipt className="h-6 w-6 text-white/30" />
                      </div>
                      No payments found.
                    </div>
                  </td>
                </tr>
              ) : (
                data?.payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-mono text-xs text-white/60">{payment.id.split('-')[0]}...</span>
                      {payment.payfastPaymentId && (
                        <span className="block text-xs text-white/40 mt-1">PF: {payment.payfastPaymentId}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-white/70 whitespace-nowrap">
                      {format(new Date(payment.createdAt), 'MMM d, yyyy h:mm a')}
                    </td>
                    <td className="px-6 py-4">
                      <span className="capitalize text-white/80 font-medium">
                        {payment.paymentType}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={
                        payment.status === 'completed' ? 'success' : 
                        payment.status === 'failed' ? 'destructive' : 'warning'
                      } className="capitalize flex inline-flex items-center gap-1 w-fit">
                        {payment.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                        {payment.status === 'failed' && <XCircle className="w-3 h-3" />}
                        {payment.status === 'pending' && <Clock className="w-3 h-3" />}
                        {payment.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-white">
                      {formatCurrency(payment.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
