import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useMakeCall, useGetMe } from "@workspace/api-client-react";
import { Delete, PhoneCall, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const DIAL_KEYS = [
  { key: "1", sub: "" },
  { key: "2", sub: "ABC" },
  { key: "3", sub: "DEF" },
  { key: "4", sub: "GHI" },
  { key: "5", sub: "JKL" },
  { key: "6", sub: "MNO" },
  { key: "7", sub: "PQRS" },
  { key: "8", sub: "TUV" },
  { key: "9", sub: "WXYZ" },
  { key: "*", sub: "" },
  { key: "0", sub: "+" },
  { key: "#", sub: "" },
];

export default function DialPad() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { data: user } = useGetMe();
  const { mutateAsync: initiateCall, isPending } = useMakeCall();
  const [number, setNumber] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(search);
    const dial = params.get("dial");
    if (dial) setNumber(dial);
  }, [search]);

  const press = (key: string) => {
    if (key === "0" && number.length === 0) {
      setNumber((n) => n + "+");
    } else {
      setNumber((n) => (n.length < 20 ? n + key : n));
    }
  };

  const del = () => setNumber((n) => n.slice(0, -1));
  const longPressZero = () => setNumber((n) => (n.endsWith("+") ? n : n + "+"));

  const handleCall = async () => {
    if (!number || number.length < 5) {
      toast({ title: "Enter a phone number", variant: "destructive" });
      return;
    }
    try {
      await initiateCall({ data: { recipientNumber: number } });
      toast({ title: "Call initiated", description: `Dialing ${number}…` });
      setLocation("/calls");
    } catch (err: any) {
      toast({
        title: "Call failed",
        description: err?.message || "Check your balance and subscription.",
        variant: "destructive",
      });
    }
  };

  const creditBalance = user?.creditBalance ?? 0;
  const isActive = user?.subscriptionStatus === "active";
  const canCall = creditBalance > 0 && isActive;

  return (
    <div className="flex flex-col items-center gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Number Display */}
      <div className="w-full flex items-center justify-between px-4 min-h-[56px] mt-4">
        <div className="flex-1" />
        <p className={cn(
          "flex-1 text-center font-mono font-semibold tracking-wider transition-all",
          number.length > 12 ? "text-xl" : number.length > 8 ? "text-2xl" : "text-3xl",
          number ? "text-white" : "text-white/20"
        )}>
          {number || "Enter number"}
        </p>
        <div className="flex-1 flex justify-end">
          {number && (
            <button
              onClick={del}
              className="p-2 rounded-full text-white/50 hover:text-white hover:bg-white/5 transition-all active:scale-95"
            >
              <Delete className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* No credit warning */}
      {!canCall && user && (
        <div className="w-full flex items-center gap-2 px-4 py-3 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            {!isActive
              ? "Subscribe to make calls — R100/month"
              : "Your credit is exhausted. Top up to continue."}
          </span>
        </div>
      )}

      {/* Dial Grid */}
      <div className="w-full grid grid-cols-3 gap-3">
        {DIAL_KEYS.map(({ key, sub }) => (
          <button
            key={key}
            onClick={() => press(key)}
            onDoubleClick={key === "0" ? longPressZero : undefined}
            className="group relative flex flex-col items-center justify-center aspect-square rounded-full glass border border-white/10 hover:border-primary/30 hover:bg-white/10 active:scale-95 transition-all duration-100 select-none cursor-pointer"
          >
            <span className="text-xl font-semibold text-white group-hover:text-primary transition-colors">
              {key}
            </span>
            {sub && (
              <span className="text-[9px] font-bold tracking-[0.2em] text-white/30 mt-0.5">
                {sub}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Call Button */}
      <button
        onClick={handleCall}
        disabled={isPending || !number}
        className={cn(
          "relative w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all duration-200 active:scale-95 mb-2",
          canCall && number
            ? "bg-gradient-to-br from-green-500 to-emerald-600 shadow-green-500/40 hover:shadow-green-500/60 hover:scale-105"
            : "bg-white/10 border border-white/10 cursor-not-allowed opacity-60"
        )}
      >
        {isPending ? (
          <Loader2 className="h-8 w-8 text-white animate-spin" />
        ) : (
          <PhoneCall className="h-8 w-8 text-white" />
        )}
        {canCall && number && (
          <span className="absolute inset-0 rounded-full bg-green-400/20 animate-ping" />
        )}
      </button>
    </div>
  );
}
