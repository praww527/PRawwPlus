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
    <div className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-400">

      {/* Number input row */}
      <div className="w-full flex items-center gap-2 mt-3 mb-3">
        <div className="flex-1 relative">
          <input
            readOnly
            value={number}
            placeholder="Enter number"
            className={cn(
              "w-full text-center font-mono font-bold tracking-wider bg-transparent border-none outline-none select-none",
              "placeholder:text-white/20",
              number.length > 14 ? "text-xl" :
              number.length > 10 ? "text-2xl" :
              number.length > 6  ? "text-3xl" : "text-4xl",
              number ? "text-white" : "text-white/20"
            )}
          />
        </div>
        <div className="w-9 flex justify-center shrink-0">
          {number && (
            <button
              onClick={del}
              className="w-9 h-9 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/8 transition-all active:scale-90"
            >
              <Delete className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Warning banner */}
      {!canCall && user && (
        <div className="w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {!isActive ? "Subscribe to call — R100/month" : "Top up credit on Profile page."}
          </span>
        </div>
      )}

      {/* Dial grid — 70 % of remaining vertical space, max 320 px */}
      <div
        className="w-full grid grid-cols-3 gap-2 mb-3"
        style={{ maxWidth: 320 }}
      >
        {DIAL_KEYS.map(({ key, sub }) => (
          <button
            key={key}
            onClick={() => press(key)}
            onDoubleClick={key === "0" ? longPressZero : undefined}
            className={cn(
              "group flex flex-col items-center justify-center rounded-full select-none cursor-pointer",
              "glass border border-white/10 hover:border-primary/30 hover:bg-white/10",
              "active:scale-90 transition-all duration-100 aspect-square"
            )}
            style={{ maxHeight: 76, maxWidth: 76 }}
          >
            <span className="text-lg font-semibold text-white group-hover:text-primary transition-colors leading-none">
              {key}
            </span>
            {sub && (
              <span className="text-[8px] font-bold tracking-[0.15em] text-white/30 mt-0.5 leading-none">
                {sub}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Call button */}
      <button
        onClick={handleCall}
        disabled={isPending || !number}
        className={cn(
          "relative w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90",
          canCall && number
            ? "bg-gradient-to-br from-green-500 to-emerald-600 shadow-[0_6px_24px_-6px_rgba(34,197,94,0.55)] hover:scale-105"
            : "bg-white/8 border border-white/10 cursor-not-allowed opacity-40"
        )}
      >
        {isPending ? (
          <Loader2 className="h-5 w-5 text-white animate-spin" />
        ) : (
          <PhoneCall className="h-5 w-5 text-white" />
        )}
        {canCall && number && (
          <span className="absolute inset-0 rounded-full bg-green-400/20 animate-ping pointer-events-none" />
        )}
      </button>
    </div>
  );
}
