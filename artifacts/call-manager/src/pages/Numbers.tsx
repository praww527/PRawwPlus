import { useState } from "react";
import { useListNumbers, useSelectNumber, useChangeNumber } from "@workspace/api-client-react";
import {
  Phone, Check, X, Loader2, ChevronRight, AlertCircle, Hash, Shuffle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

function PayFastRedirect({ data }: { data: any }) {
  if (!data) return null;
  return (
    <form method="POST" action={data.paymentUrl} target="_self" className="hidden" id="pf-form-numbers">
      {Object.entries(data.formFields as Record<string, string>).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </form>
  );
}

export default function Numbers() {
  const { data, isLoading, refetch } = useListNumbers();
  const { mutateAsync: selectNumber, isPending: selecting } = useSelectNumber();
  const { mutateAsync: changeNumber, isPending: changing } = useChangeNumber();
  const { toast } = useToast();
  const [pfData, setPfData] = useState<any>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [changeMode, setChangeMode] = useState<{ oldId: string; oldNumber: string } | null>(null);

  const numbers = data?.numbers ?? [];
  const myNumbers = data?.myNumbers ?? [];
  const maxNumbers = data?.maxNumbers ?? 1;
  const plan = data?.plan ?? "basic";
  const limitReached = myNumbers.length >= maxNumbers;

  const handleSelect = async (numberId: string) => {
    if (limitReached) {
      toast({ title: `Plan limit reached (${maxNumbers} number${maxNumbers > 1 ? "s" : ""})`, variant: "destructive" });
      return;
    }
    setActionId(numberId);
    try {
      await selectNumber({ data: { numberId } });
      toast({ title: "Number claimed!", description: "This number is now yours." });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to claim number", description: err?.message, variant: "destructive" });
    } finally {
      setActionId(null);
    }
  };

  const handleChangeRequest = async (newNumberId: string) => {
    if (!changeMode) return;
    setActionId(newNumberId);
    try {
      const res = await changeNumber({ data: { oldNumberId: changeMode.oldId, newNumberId } });
      setPfData(res);
      setTimeout(() => {
        (document.getElementById("pf-form-numbers") as HTMLFormElement)?.submit();
      }, 100);
    } catch (err: any) {
      toast({ title: "Failed to initiate number change", description: err?.message, variant: "destructive" });
    } finally {
      setActionId(null);
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
      <PayFastRedirect data={pfData} />

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

      {myNumbers.length > 0 && (
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
                    <p className="text-[10px] text-green-400 font-semibold">Owned</p>
                  </div>
                </div>
                <button
                  onClick={() => setChangeMode(changeMode?.oldId === n.id ? null : { oldId: n.id, oldNumber: n.number })}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border active:scale-95",
                    changeMode?.oldId === n.id
                      ? "bg-amber-500/20 border-amber-500/35 text-amber-400"
                      : "glass border-white/12 text-white/50 hover:text-white"
                  )}
                >
                  <Shuffle className="h-3 w-3" />
                  Change
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {changeMode && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>Select a free number below to replace <strong>{changeMode.oldNumber}</strong>. A R100 fee applies.</span>
          <button onClick={() => setChangeMode(null)} className="ml-auto shrink-0 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="glass rounded-2xl border border-white/10 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
          <Phone className="h-3.5 w-3.5 text-white/40" />
          <p className="text-sm font-semibold text-white">Available Numbers</p>
        </div>

        {numbers.length === 0 ? (
          <div className="px-4 py-8 text-center text-white/40 text-sm">
            <p>No numbers available right now.</p>
            <p className="text-xs mt-1 text-white/25">Numbers are sourced from Telnyx automatically.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/8">
            {numbers.map((n) => {
              const isOwned = n.status === "owned";
              const isTaken = n.status === "taken";
              const isFree = n.status === "free";
              const isActing = actionId === n.id;

              if (isOwned) return null;

              return (
                <div key={n.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
                      isFree ? "bg-white/6" : "bg-red-500/8"
                    )}>
                      <Phone className={cn("h-3 w-3", isFree ? "text-white/40" : "text-red-400/60")} />
                    </div>
                    <p className="font-mono text-sm text-white">{n.number}</p>
                  </div>

                  {isTaken && (
                    <span className="text-[11px] font-semibold text-red-400/70 px-2 py-0.5 rounded-full bg-red-500/8 border border-red-500/15">
                      Taken
                    </span>
                  )}

                  {isFree && (
                    <button
                      onClick={() => changeMode ? handleChangeRequest(n.id) : handleSelect(n.id)}
                      disabled={isActing || selecting || changing || (!changeMode && limitReached)}
                      className={cn(
                        "flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border active:scale-95",
                        limitReached && !changeMode
                          ? "glass border-white/8 text-white/20 cursor-not-allowed"
                          : changeMode
                          ? "bg-amber-500/18 border-amber-500/28 text-amber-400 hover:bg-amber-500/28"
                          : "bg-primary/14 border-primary/24 text-primary hover:bg-primary/24"
                      )}
                    >
                      {isActing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          {changeMode ? <Shuffle className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                          {changeMode ? "Pay R100" : "Select"}
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-white/25 text-center px-4">
        Numbers are synced from Telnyx. {plan === "basic" ? "Upgrade to Pro for 2 numbers." : "Pro plan: up to 2 numbers."}
      </p>
    </div>
  );
}
