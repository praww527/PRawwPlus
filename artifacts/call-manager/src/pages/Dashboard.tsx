import { Link } from "wouter";
import { useGetMe, useListCalls } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Phone, ArrowUpRight, Clock, Activity, AlertCircle } from "lucide-react";
import { formatCurrency, formatDuration, cn } from "@/lib/utils";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: user, isLoading: isLoadingUser } = useGetMe();
  const { data: callData, isLoading: isLoadingCalls } = useListCalls({ limit: 5 });

  if (isLoadingUser || !user) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48 glass rounded-lg" />
        <div className="grid md:grid-cols-3 gap-6">
          <Skeleton className="h-40 glass rounded-2xl" />
          <Skeleton className="h-40 glass rounded-2xl" />
          <Skeleton className="h-40 glass rounded-2xl" />
        </div>
      </div>
    );
  }

  const isLowCredit = user.creditBalance < 10;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Welcome back, {user.name || user.username}</h1>
          <p className="text-white/60 mt-1">Here's an overview of your call management workspace.</p>
        </div>
        <Button asChild size="lg">
          <Link href="/calls/new">
            <Phone className="mr-2 h-5 w-5" />
            New Call
          </Link>
        </Button>
      </div>

      {/* Stats Row */}
      <div className="grid md:grid-cols-3 gap-6">
        <Card className="relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardHeader className="pb-2">
            <CardDescription className="text-white/70 font-medium flex justify-between items-center">
              Credit Balance
              {isLowCredit && <AlertCircle className="h-4 w-4 text-amber-400" />}
            </CardDescription>
            <CardTitle className="text-4xl font-display mt-1">
              {formatCurrency(user.creditBalance)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLowCredit ? (
              <p className="text-amber-400 text-sm mt-2 flex items-center gap-1">
                Low balance! <Link href="/credits" className="underline font-semibold hover:text-amber-300">Top up now</Link>
              </p>
            ) : (
              <p className="text-white/50 text-sm mt-2">Looking good!</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-white/70 font-medium">Subscription</CardDescription>
            <CardTitle className="text-2xl mt-1 capitalize flex items-center gap-2">
              {user.subscriptionStatus}
              <Badge variant={user.subscriptionStatus === 'active' ? 'success' : 'warning'}>
                {user.subscriptionStatus === 'active' ? 'Pro Plan' : 'Free Tier'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-white/50 text-sm mt-2 flex items-center justify-between">
              {user.nextPaymentDate ? `Renews ${format(new Date(user.nextPaymentDate), 'MMM d, yyyy')}` : 'No active cycle'}
              <Link href="/subscription" className="text-primary hover:underline font-medium">Manage</Link>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-white/70 font-medium">Usage This Month</CardDescription>
            <CardTitle className="text-2xl mt-1">
              {user.totalCallsUsed} <span className="text-white/50 text-lg font-normal">calls</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-white/50 text-sm mt-2">
              Total spent: {formatCurrency(user.totalCreditUsed)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Calls */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Recent Activity
          </h2>
          <Button variant="link" asChild className="pr-0">
            <Link href="/calls">View all <ArrowUpRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>

        <Card>
          {isLoadingCalls ? (
            <div className="p-6 flex justify-center"><Activity className="h-6 w-6 animate-spin text-white/30" /></div>
          ) : callData?.calls.length === 0 ? (
            <div className="p-12 text-center text-white/50">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
                <Phone className="h-8 w-8 text-white/20" />
              </div>
              <p>No recent calls found. Start dialing!</p>
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {callData?.calls.map((call) => (
                <div key={call.id} className="p-4 md:p-6 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center border",
                      call.status === 'completed' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                      call.status === 'failed' ? "bg-red-500/10 border-red-500/20 text-red-400" :
                      "bg-primary/10 border-primary/20 text-primary"
                    )}>
                      <Phone className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-semibold text-white">{call.recipientNumber}</p>
                      <p className="text-xs text-white/50 flex items-center gap-1 mt-1">
                        <Clock className="h-3 w-3" />
                        {format(new Date(call.createdAt), 'MMM d, h:mm a')}
                      </p>
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <Badge variant={
                      call.status === 'completed' ? 'success' : 
                      call.status === 'failed' ? 'destructive' : 'default'
                    } className="mb-1 capitalize">
                      {call.status}
                    </Badge>
                    <div className="flex items-center gap-3 justify-end text-sm text-white/60">
                      <span>{formatDuration(call.duration)}</span>
                      <span className="font-medium text-white">{formatCurrency(call.cost)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
