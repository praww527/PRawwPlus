import { useListMyNumbers, useRemoveNumber } from "@workspace/api-client-react";
import type { OwnedNumber } from "@workspace/api-client-react";
import {
  Phone, Loader2, Hash, Shuffle, Plus, Trash2, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export default function Numbers() {
  const { data, isLoading, refetch } = useListMyNumbers();
  const { mutateAsync: removeNumber, isPending: removing } = useRemoveNumber();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const myNumbers: OwnedNumber[] = data?.myNumbers ?? [];
  const maxNumbers: number = data?.maxNumbers ?? 1;
  const plan: string = data?.plan ?? "basic";
  const canAdd = myNumbers.length < maxNumbers;

  const handleRemove = async (id: string) => {
    try {
      await removeNumber({ id });
      toast({ title: "Number removed" });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to remove number", description: err?.message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse pt-2">
        <div className="h-8 rounded-xl glass" />
        <div className="h-24 rounded-2xl glass" />
        <div className="h-40 rounded-2xl glass" />
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-400 pb-2">
      <div className="flex items-center justify-between pt-1">
        <h1 className="text-xl font-bold text-white">Phone Numbers</h1>
        <span className={cn(
          "text-[11px] font-semibold px-2.5 py-1 rounded-full border",
          plan === "pro"
            ? "bg-violet-500/12 text-violet-400 border-violet-500/22"
            : "bg-primary/12 text-primary border-primary/22"
        )}>
          {plan.toUpperCase()} · {myNumbers.length}/{maxNumbers} used
        </span>
      </div>

      {myNumbers.length > 0 ? (
        <div className="glass rounded-2xl border border-white/10 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
            <Hash className="h-3.5 w-3.5 text-primary" />
            <p className="text-sm font-semibold text-white">Your Numbers</p>
          </div>
          <div className="divide-y divide-white/8">
            {myNumbers.map((n) => (
              <div key={n.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-green-500/12 flex items-center justify-center shrink-0">
                    <Phone className="h-3.5 w-3.5 text-green-400" />
                  </div>
                  <div>
                    <p className="font-mono text-sm font-semibold text-white">{n.number}</p>
                    <p className="text-[10px] text-green-400 font-semibold">Active</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setLocation(`/buy-number?mode=change&oldNumberId=${n.id}&oldNumber=${encodeURIComponent(n.number)}`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border active:scale-95 glass border-white/12 text-white/50 hover:text-white"
                  >
                    <Shuffle className="h-3 w-3" />
                    Change
                  </button>
                  <button
                    onClick={() => handleRemove(n.id)}
                    disabled={removing}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border active:scale-95 bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {removing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="glass rounded-2xl border border-white/10 px-4 py-10 text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto">
            <AlertCircle className="h-5 w-5 text-white/20" />
          </div>
          <p className="text-sm text-white/50">You have no phone numbers yet.</p>
          <p className="text-xs text-white/25">Buy a number to enable inbound and outbound calling.</p>
        </div>
      )}

      {canAdd && (
        <button
          onClick={() => setLocation("/buy-number")}
          className="w-full py-3 rounded-2xl glass border border-white/10 text-sm font-semibold text-white/60 hover:text-white hover:border-primary/30 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Buy a Number
        </button>
      )}

      <p className="text-[11px] text-white/25 text-center px-4">
        {plan === "basic" ? "Upgrade to Pro for 2 numbers." : "Pro plan: up to 2 numbers."}
      </p>
    </div>
  );
}
