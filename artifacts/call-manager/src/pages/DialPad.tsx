import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useMakeCall, useGetMe } from "@workspace/api-client-react";
import { Delete, Phone, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { NAV_H } from "@/components/Layout";

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
    /*
     * Explicit height = full viewport minus safe areas and nav.
     * This works inside an overflow-y:auto scroll container because
     * we're telling the div exactly how tall to be — no flex-1 needed.
     */
    <div
      className="flex flex-col items-center justify-center animate-in fade-in duration-300"
      style={{
        height: `calc(100dvh - env(safe-area-inset-top, 0px) - ${NAV_H}px - env(safe-area-inset-bottom, 0px) - 8px)`,
      }}
    >
      {/* ── Number display ── */}
      <div className="w-full flex items-center justify-between mb-5 px-2">
        <div className="w-9" />
        <p
          className={cn(
            "flex-1 text-center font-mono font-semibold tracking-widest select-none transition-all",
            number.length > 14 ? "text-xl"    :
            number.length > 10 ? "text-2xl"   :
            number.length > 6  ? "text-[28px]": "text-[32px]",
            number ? "text-white" : "text-white/25"
          )}
        >
          {number || "Enter number"}
        </p>
        <div className="w-9 flex justify-end">
          {number && (
            <button
              onClick={del}
              className="w-9 h-9 flex items-center justify-center rounded-full
                         text-white/40 hover:text-white hover:bg-white/8
                         transition-all active:scale-90"
            >
              <Delete className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Warning banner ── */}
      {!canCall && user && (
        <div className="w-full flex items-center gap-2 px-3 py-2 mb-3
                        rounded-xl bg-amber-500/10 border border-amber-500/20
                        text-amber-400 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {!isActive ? "Subscribe to call — R100/month" : "Top up credit on Profile."}
          </span>
        </div>
      )}

      {/*
       * ── 3×4 keypad ──
       * Width: fills parent px-4 (16px each side) capped at 300 px.
       * Buttons: aspect-square → always perfect circles whatever the width.
       */}
      <div
        className="grid grid-cols-3 w-full mx-auto"
        style={{ maxWidth: 300, gap: 12 }}
      >
        {DIAL_KEYS.map(({ key, sub }) => (
          <button
            key={key}
            onClick={() => press(key)}
            className={cn(
              "group aspect-square flex flex-col items-center justify-center rounded-full",
              "bg-white/8 border border-white/10",
              "hover:bg-white/14 hover:border-white/20",
              "active:scale-90 active:bg-white/20",
              "transition-all duration-100 select-none"
            )}
          >
            <span className="text-[20px] font-semibold text-white leading-none group-hover:text-white/90">
              {key}
            </span>
            {sub && (
              <span className="text-[8px] font-bold tracking-[0.14em] text-white/30 mt-0.5 leading-none">
                {sub}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Gap between keypad and call button ── */}
      <div className="h-4" />

      {/* ── Call button — 1.2× one keypad cell ── */}
      <button
        onClick={handleCall}
        disabled={isPending || !number}
        className={cn(
          "relative flex items-center justify-center rounded-full transition-all duration-200 active:scale-90",
          canCall && number
            ? "hover:scale-105 shadow-[0_6px_28px_-4px_rgba(52,199,89,0.55)]"
            : "opacity-40 cursor-not-allowed"
        )}
        style={{
          /*
           * Width = one grid cell of a 300px / 3-col / 12px-gap grid ≈ 92 px,
           * then 1.2× → 110 px — slightly larger than any keypad button.
           */
          width: 70,
          height: 70,
          background: canCall && number ? "#34c759" : "rgba(255,255,255,0.08)",
          border: canCall && number ? "none" : "1px solid rgba(255,255,255,0.12)",
        }}
      >
        {isPending ? (
          <Loader2 className="text-white animate-spin" style={{ width: 24, height: 24 }} />
        ) : (
          <Phone className="text-white" style={{ width: 24, height: 24 }} />
        )}
        {canCall && number && (
          <span
            className="absolute inset-0 rounded-full animate-ping pointer-events-none"
            style={{ background: "rgba(52,199,89,0.2)" }}
          />
        )}
      </button>
    </div>
  );
}
