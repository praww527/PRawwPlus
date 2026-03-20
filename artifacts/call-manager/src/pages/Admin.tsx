import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAdminGetStats, useAdminListUsers, useAdminAdjustCredit, getAdminListUsersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDuration, cn } from "@/lib/utils";
import { format } from "date-fns";
import { Users, PhoneCall, TrendingUp, DollarSign, Edit3, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

function AdminStats() {
  const { data: stats, isLoading } = useAdminGetStats();

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 glass rounded-2xl" />)}
      </div>
    );
  }

  const cards = [
    { title: "Total Users", value: stats.totalUsers, icon: Users, color: "text-blue-400" },
    { title: "Active Subs", value: stats.activeSubscriptions, icon: TrendingUp, color: "text-emerald-400" },
    { title: "Revenue", value: formatCurrency(stats.totalRevenue), icon: DollarSign, color: "text-amber-400" },
    { title: "Calls Today", value: stats.callsToday, icon: PhoneCall, color: "text-primary" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {cards.map((c, i) => (
        <Card key={i} className="border-white/5 bg-white/5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-white/60">{c.title}</span>
              <c.icon className={cn("w-5 h-5", c.color)} />
            </div>
            <div className="text-3xl font-display font-bold">{c.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Admin() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: usersData, isLoading: isLoadingUsers } = useAdminListUsers({ limit: 50 });
  const { mutateAsync: adjustCredit, isPending: isAdjusting } = useAdminAdjustCredit();

  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !adjustAmount) return;

    try {
      await adjustCredit({
        userId: selectedUser.id,
        data: {
          amount: parseFloat(adjustAmount),
          reason: adjustReason || "Admin manual adjustment"
        }
      });
      
      toast({ title: "Credit Adjusted", description: "Successfully updated user balance." });
      queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
      setSelectedUser(null);
      setAdjustAmount("");
      setAdjustReason("");
    } catch (error: any) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-3">
        <ShieldAlert className="w-8 h-8 text-red-400" />
        <div>
          <h1 className="text-3xl font-bold font-display">System Administration</h1>
          <p className="text-white/60 mt-1">Platform overview and user management.</p>
        </div>
      </div>

      <AdminStats />

      <Card>
        <CardHeader>
          <CardTitle>User Directory</CardTitle>
          <CardDescription>Manage all registered users and their balances.</CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-white/50 bg-white/5 uppercase border-b border-white/10">
              <tr>
                <th className="px-6 py-4 font-semibold">User</th>
                <th className="px-6 py-4 font-semibold">Plan</th>
                <th className="px-6 py-4 font-semibold text-right">Balance</th>
                <th className="px-6 py-4 font-semibold text-right">Calls Used</th>
                <th className="px-6 py-4 font-semibold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoadingUsers ? (
                <tr><td colSpan={5} className="p-8 text-center"><Skeleton className="h-8 w-full bg-white/5" /></td></tr>
              ) : (
                usersData?.users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <td className="px-6 py-4">
                      <p className="font-semibold text-white">{u.name || u.username}</p>
                      <p className="text-xs text-white/50 mt-0.5">{u.id.split('-')[0]}</p>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={u.subscriptionStatus === 'active' ? 'success' : 'outline'}>
                        {u.subscriptionStatus}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-medium">
                      {formatCurrency(u.creditBalance)}
                    </td>
                    <td className="px-6 py-4 text-right text-white/70">
                      {u.totalCallsUsed}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Button 
                        variant="secondary" 
                        size="sm" 
                        className="gap-2"
                        onClick={() => setSelectedUser(u)}
                      >
                        <Edit3 className="w-3.5 h-3.5" /> Adjust Credit
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal 
        isOpen={!!selectedUser} 
        onClose={() => setSelectedUser(null)}
        title="Adjust User Credit"
        description={`Modify balance for ${selectedUser?.name || selectedUser?.username}`}
      >
        <form onSubmit={handleAdjustSubmit} className="space-y-4 mt-4">
          <div className="p-3 bg-white/5 border border-white/10 rounded-xl flex justify-between items-center mb-6">
            <span className="text-sm text-white/60">Current Balance:</span>
            <span className="font-mono font-bold text-lg">{formatCurrency(selectedUser?.creditBalance || 0)}</span>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Adjustment Amount (ZAR)</label>
            <Input 
              type="number" 
              step="0.01" 
              placeholder="e.g. 50 (add) or -20 (deduct)"
              value={adjustAmount}
              onChange={e => setAdjustAmount(e.target.value)}
              required
            />
            <p className="text-xs text-white/40">Use negative numbers to deduct credits.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Reason (Log entry)</label>
            <Input 
              type="text" 
              placeholder="e.g. Refund for dropped call"
              value={adjustReason}
              onChange={e => setAdjustReason(e.target.value)}
              required
            />
          </div>

          <div className="pt-4 flex gap-3">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setSelectedUser(null)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isAdjusting}>
              {isAdjusting ? "Applying..." : "Apply Adjustment"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
