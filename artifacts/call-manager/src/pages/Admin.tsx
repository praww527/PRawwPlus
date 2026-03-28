import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminGetStats,
  useAdminListUsers,
  useAdminAdjustCredit,
  getAdminListUsersQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, cn } from "@/lib/utils";
import { format } from "date-fns";
import { Users, PhoneCall, TrendingUp, DollarSign, Edit3, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

function AdminStats() {
  const { data: stats, isLoading } = useAdminGetStats();

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-3 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl glass animate-pulse" />
        ))}
      </div>
    );
  }

  const cards = [
    { title: "Total Users", value: stats.totalUsers, icon: Users, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
    { title: "Active Subs", value: stats.activeSubscriptions, icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
    { title: "Revenue", value: formatCurrency(stats.totalRevenue), icon: DollarSign, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
    { title: "Total Calls", value: stats.totalCalls, icon: PhoneCall, color: "text-primary", bg: "bg-primary/10 border-primary/20" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 mb-6">
      {cards.map((c, i) => (
        <div key={i} className="glass rounded-2xl p-4 border border-white/10">
          <div className={cn("w-9 h-9 rounded-full flex items-center justify-center mb-3 border", c.bg)}>
            <c.icon className={cn("w-4 h-4", c.color)} />
          </div>
          <p className="text-xl font-bold text-white">{c.value}</p>
          <p className="text-xs text-white/40 mt-0.5">{c.title}</p>
        </div>
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
        data: { delta: parseFloat(adjustAmount), reason: adjustReason || "Admin adjustment" },
      });
      toast({ title: "Credit adjusted successfully" });
      queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
      setSelectedUser(null);
      setAdjustAmount("");
      setAdjustReason("");
    } catch (error: any) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <div className="pt-1 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-red-500/12 border border-red-500/20 flex items-center justify-center">
          <ShieldAlert className="w-5 h-5 text-red-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Administration</h1>
          <p className="text-xs text-white/40">Platform overview and user management</p>
        </div>
      </div>

      <AdminStats />

      {/* User Directory */}
      <div className="glass rounded-3xl border border-white/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/8">
          <p className="text-sm font-semibold text-white">User Directory</p>
          <p className="text-xs text-white/40 mt-0.5">Manage balances and subscriptions</p>
        </div>

        {isLoadingUsers ? (
          <div className="p-4 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 rounded-2xl glass animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-white/6">
            {usersData?.users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-5 py-3.5">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-white/8 border border-white/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-white/60">
                    {(u.name || u.username || "?").slice(0, 2).toUpperCase()}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">
                    {u.name || u.username}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge
                      variant={u.subscriptionStatus === "active" ? "success" : "outline"}
                      className="text-[9px] py-0 px-1.5"
                    >
                      {u.subscriptionStatus}
                    </Badge>
                    <span className="text-xs text-white/40 font-mono">
                      {formatCurrency(u.coins)}
                    </span>
                  </div>
                </div>

                {/* Action */}
                <button
                  onClick={() => setSelectedUser(u)}
                  className="w-9 h-9 rounded-full glass border border-white/10 hover:border-primary/30 flex items-center justify-center text-white/40 hover:text-primary transition-all active:scale-90"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Adjust Credit Modal */}
      <Modal
        isOpen={!!selectedUser}
        onClose={() => setSelectedUser(null)}
        title="Adjust User Credit"
        description={`Modify balance for ${selectedUser?.name || selectedUser?.username}`}
      >
        <form onSubmit={handleAdjustSubmit} className="space-y-4 mt-4">
          <div className="p-3 glass border border-white/10 rounded-2xl flex justify-between items-center">
            <span className="text-sm text-white/60">Current Balance</span>
            <span className="font-mono font-bold">{formatCurrency(selectedUser?.creditBalance || 0)}</span>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-white/80">Amount (ZAR)</label>
            <Input
              type="number"
              step="0.01"
              placeholder="e.g. 50 or -20"
              value={adjustAmount}
              onChange={(e) => setAdjustAmount(e.target.value)}
              required
            />
            <p className="text-xs text-white/35">Negative values deduct credit</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-white/80">Reason</label>
            <Input
              type="text"
              placeholder="e.g. Refund for dropped call"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
            />
          </div>
          <div className="pt-2 flex gap-3">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setSelectedUser(null)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isAdjusting}>
              {isAdjusting ? "Applying…" : "Apply"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
