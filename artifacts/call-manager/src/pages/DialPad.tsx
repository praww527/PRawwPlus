import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useMakeCall, useGetMe } from "@workspace/api-client-react";
import { Delete, Phone, AlertCircle, Loader2 } from "lucide-react";
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

/* Button diameter in px — drives every size calculation */
const BTN = 72;
const GAP = 14;
const CALL_BTN = Math.round(BTN * 1.22); /* ≈ 88 px */
const GRID_W = BTN * 3 + GAP * 2; /* 244 px */

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
    /* Outer: fill the height the Layout propagates and center everything */
    <div className="flex-1 flex flex-col items-center justify-center animate-in fade-in duration-300">
      {/* ── Number display ── */}
      <div
        className="flex items-center justify-between mb-6"
        style={{ width: GRID_W }}
      >
        {/* spacer so delete stays right-aligned */}
        <div style={{ width: BTN * 0.5 }} />

        <p
          className={cn(
            "flex-1 text-center font-mono font-semibold tracking-widest select-none transition-all",
            number.length > 14 ? "text-xl" :
            number.length > 10 ? "text-2xl" :
            number.length > 6  ? "text-[28px]" : "text-[32px]",
            number ? "text-white" : "text-white/25"
          )}
        >
          {number || "Enter number"}
        </p>

        <div style={{ width: BTN * 0.5 }} className="flex justify-end">
          {number && (
            <button
              onClick={del}
              className="flex items-center justify-center rounded-full text-white/40 hover:text-white transition-colors active:scale-90"
              style={{ width: BTN * 0.5, height: BTN * 0.5 }}
            >
              <Delete className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Warning banner ── */}
      {!canCall && user && (
        <div
          className="flex items-center gap-2 px-3 py-2 mb-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs"
          style={{ width: GRID_W }}
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {!isActive ? "Subscribe to call — R100/month" : "Top up credit on Profile."}
          </span>
        </div>
      )}

      {/* ── 3 × 4 keypad ── */}
      <div
        className="grid grid-cols-3"
        style={{ width: GRID_W, gap: GAP }}
      >
        {DIAL_KEYS.map(({ key, sub }) => (
          <button
            key={key}
            onClick={() => press(key)}
            className={cn(
              "group flex flex-col items-center justify-center rounded-full",
              "bg-white/8 border border-white/10",
              "hover:bg-white/14 hover:border-white/20",
              "active:scale-90 active:bg-white/20",
              "transition-all duration-100 select-none"
            )}
            style={{ width: BTN, height: BTN }}
          >
            <span
              className="font-semibold text-white group-hover:text-white/90 leading-none"
              style={{ fontSize: 22 }}
            >
              {key}
            </span>
            {sub && (
              <span
                className="font-bold tracking-[0.14em] text-white/30 mt-0.5 leading-none"
                style={{ fontSize: 8 }}
              >
                {sub}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Call button ── */}
      <div style={{ height: GAP + 4 }} />

      <button
        onClick={handleCall}
        disabled={isPending || !number}
        className={cn(
          "relative flex items-center justify-center rounded-full transition-all duration-200",
          "active:scale-90",
          canCall && number
            ? "shadow-[0_6px_28px_-4px_rgba(52,199,89,0.55)] hover:scale-105"
            : "opacity-40 cursor-not-allowed"
        )}
        style={{
          width: CALL_BTN,
          height: CALL_BTN,
          background: canCall && number ? "#34c759" : "rgba(255,255,255,0.08)",
          border: canCall && number ? "none" : "1px solid rgba(255,255,255,0.12)",
        }}
      >
        {isPending ? (
          <Loader2 className="text-white animate-spin" style={{ width: 26, height: 26 }} />
        ) : (
          <Phone className="text-white" style={{ width: 26, height: 26 }} />
        )}
        {canCall && number && (
          <span className="absolute inset-0 rounded-full animate-ping pointer-events-none"
            style={{ background: "rgba(52,199,89,0.2)" }}
          />
        )}
      </button>
    </div>
  );
}
