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
    if (dial) setNumber(decodeURIComponent(dial));
  }, [search]);

  const press = (key: string) => {
    if (key === "0" && number.length === 0) {
      setNumber("+");
    } else {
      setNumber((n) => (n.length < 20 ? n + key : n));
    }
  };

  const del = () => setNumber((n) => n.slice(0, -1));
  const longPressZero = () => setNumber((n) => (n.endsWith("+") ? n : n + "+"));

  const handleCall = async () => {
    if (!number || number.length < 5) {
      toast({ title: "Enter a valid phone number", variant: "destructive" });
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
    <div className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500 h-full">

      {/* Number Display */}
      <div className="w-full flex items-center justify-between px-2 mt-6 mb-4 min-h-[60px]">
        <div className="w-10" />
        <p
          className={cn(
            "flex-1 text-center font-mono font-bold tracking-wider transition-all select-none",
            number.length > 14
              ? "text-xl"
              : number.length > 10
              ? "text-2xl"
              : number.length > 6
              ? "text-3xl"
              : "text-4xl",
            number ? "text-white" : "text-white/20"
          )}
        >
          {number || "Enter number"}
        </p>
        <div className="w-10 flex justify-center">
          {number && (
            <button
              onClick={del}
              className="w-10 h-10 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/8 transition-all active:scale-90"
            >
              <Delete className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Warning banner */}
      {!canCall && user && (
        <div className="w-full flex items-center gap-2.5 px-4 py-3 mb-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="leading-snug">
            {!isActive
              ? "Subscribe to make calls — R100/month"
              : "Credit exhausted. Top up on Profile page."}
          </span>
        </div>
      )}

      {/* Dial Grid */}
      <div className="w-full grid grid-cols-3 gap-3 mb-6">
        {DIAL_KEYS.map(({ key, sub }) => (
          <button
            key={key}
            onClick={() => press(key)}
            onDoubleClick={key === "0" ? longPressZero : undefined}
            className={cn(
              "group relative flex flex-col items-center justify-center rounded-full select-none cursor-pointer",
              "glass border border-white/10 hover:border-primary/30 hover:bg-white/10",
              "active:scale-90 transition-all duration-100",
              "aspect-square"
            )}
          >
            <span className="text-[22px] font-semibold text-white group-hover:text-primary transition-colors leading-none">
              {key}
            </span>
            {sub && (
              <span className="text-[9px] font-bold tracking-[0.18em] text-white/30 mt-0.5 leading-none">
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
          "relative w-[72px] h-[72px] rounded-full flex items-center justify-center transition-all duration-200 active:scale-90",
          canCall && number
            ? "bg-gradient-to-br from-green-500 to-emerald-600 shadow-[0_8px_32px_-8px_rgba(34,197,94,0.6)] hover:shadow-[0_12px_40px_-8px_rgba(34,197,94,0.7)] hover:scale-105"
            : "bg-white/8 border border-white/10 cursor-not-allowed opacity-50"
        )}
      >
        {isPending ? (
          <Loader2 className="h-7 w-7 text-white animate-spin" />
        ) : (
          <PhoneCall className="h-7 w-7 text-white" />
        )}
        {canCall && number && (
          <span className="absolute inset-0 rounded-full bg-green-400/20 animate-ping pointer-events-none" />
        )}
      </button>
    </div>
  );
}
