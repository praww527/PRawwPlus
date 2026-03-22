import { useState, useEffect, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { useMakeCall, useGetMe } from "@workspace/api-client-react";
import { Delete, Phone, AlertCircle, Loader2, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { NAV_H } from "@/components/Layout";
import { useCall } from "@/context/CallContext";

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
  { key: "*",  sub: "" },
  { key: "0",  sub: "+" },
  { key: "#",  sub: "" },
];

export default function DialPad() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: user } = useGetMe();
  const { mutateAsync: initiateCall, isPending } = useMakeCall();
  const { startOutgoing, connectCall, endCall } = useCall();
  const [number, setNumber] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(search);
    const dial = params.get("dial");
    if (dial) setNumber(decodeURIComponent(dial));
  }, [search]);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  const press = (key: string) => {
    setNumber((n) => (n.length < 20 ? n + key : n));
  };

  const handleZeroDown = () => {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setNumber((n) => (n.length < 20 ? n + "+" : n));
    }, 500);
  };

  const handleZeroUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (!longPressFired.current) {
      press("0");
    }
  };

  const del = () => setNumber((n) => n.slice(0, -1));

  const handleCall = async () => {
    if (!number || number.length < 5) {
      toast({ title: "Enter a valid phone number", variant: "destructive" });
      return;
    }
    startOutgoing({ number });
    try {
      await initiateCall({ data: { recipientNumber: number } });
      connectCall();
    } catch (err: any) {
      endCall();
      toast({
        title: "Call failed",
        description: err?.message ?? "Check your subscription and coin balance.",
        variant: "destructive",
      });
    }
  };

  const coins = user?.coins ?? 0;
  const isActive = user?.subscriptionStatus === "active";
  const canCall = coins > 0 && isActive;

  const outerH = `calc(100dvh - env(safe-area-inset-top,0px) - ${NAV_H}px - env(safe-area-inset-bottom,0px) - 8px)`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: outerH,
        paddingBottom: 20,
      }}
      className="animate-in fade-in duration-300"
    >
      {/* Coin balance indicator — always visible */}
      <div className={cn(
        "flex items-center gap-1.5 mb-4 px-3.5 py-1.5 rounded-full border transition-colors",
        coins > 0 && isActive
          ? "glass border-white/10"
          : "bg-red-500/8 border-red-500/20",
      )}>
        <Coins className={cn("h-3 w-3", coins > 0 && isActive ? "text-amber-400" : "text-red-400")} />
        <span className={cn("text-xs font-bold tabular-nums", coins > 0 && isActive ? "text-amber-400" : "text-red-400")}>
          {coins.toFixed(2)} coins
        </span>
        {coins > 0 && isActive && (
          <span className="text-[10px] text-white/30">≈ {coins} min</span>
        )}
      </div>

      {/* Number display */}
      <div style={{ display: "flex", alignItems: "center", width: "100%", marginBottom: 20 }}>
        <div style={{ width: 36 }} />
        <p
          className={cn(
            "flex-1 text-center font-mono font-bold tracking-widest select-none transition-all",
            number.length > 14 ? "text-xl"    :
            number.length > 10 ? "text-2xl"   :
            number.length > 6  ? "text-[28px]": "text-[32px]",
            number ? "text-white" : "text-white/20"
          )}
        >
          {number || "Enter number"}
        </p>
        <div style={{ width: 36, display: "flex", justifyContent: "flex-end" }}>
          {number && (
            <button
              onClick={del}
              className="w-9 h-9 flex items-center justify-center rounded-full
                         text-white/35 hover:text-white hover:bg-white/8
                         transition-all active:scale-90"
            >
              <Delete className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </div>

      {/* Warning banner */}
      {!canCall && user && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl
                     bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs cursor-pointer"
          style={{ width: "100%", marginBottom: 16 }}
          onClick={() => !isActive ? setLocation("/profile") : setLocation("/profile")}
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {!isActive
              ? "Subscribe to call — Basic R59 or Pro R109/month"
              : "Top up your wallet to make calls."}
          </span>
        </div>
      )}

      {/* 3×4 keypad */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 70px)",
          gap: 20,
        }}
      >
        {DIAL_KEYS.map(({ key, sub }) => {
          const isZero = key === "0";
          return (
            <button
              key={key}
              {...(isZero
                ? {
                    onPointerDown: handleZeroDown,
                    onPointerUp: handleZeroUp,
                    onPointerLeave: handleZeroUp,
                    onContextMenu: (e) => e.preventDefault(),
                  }
                : { onClick: () => press(key) })}
              style={{
                width: 70,
                height: 70,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "transform 0.1s, background 0.1s",
                userSelect: "none",
              }}
              className="hover:bg-white/[0.12] active:scale-90 active:bg-white/20"
            >
              <span style={{ fontSize: 22, fontWeight: 600, color: "white", lineHeight: 1 }}>
                {key}
              </span>
              {sub && (
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    color: "rgba(255,255,255,0.3)",
                    marginTop: 2,
                    lineHeight: 1,
                  }}
                >
                  {sub}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Call button */}
      <button
        onClick={handleCall}
        disabled={isPending || !number}
        style={{
          width: 85,
          height: 85,
          borderRadius: "50%",
          background: "#34c759",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 14,
          boxShadow: number ? "0 6px 20px rgba(52,199,89,0.4)" : "none",
          cursor: number ? "pointer" : "not-allowed",
          opacity: number ? 1 : 0.35,
          transition: "transform 0.15s, box-shadow 0.15s, opacity 0.2s",
          position: "relative",
        }}
        className={cn(
          "active:scale-90",
          number && "hover:scale-105"
        )}
      >
        {isPending ? (
          <Loader2 className="text-white animate-spin" style={{ width: 30, height: 30 }} />
        ) : (
          <Phone className="text-white" style={{ width: 30, height: 30 }} />
        )}
        {number && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: "rgba(52,199,89,0.25)",
              animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite",
              pointerEvents: "none",
            }}
          />
        )}
      </button>
    </div>
  );
}
