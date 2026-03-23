import { useState, useEffect, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { useMakeCall, useGetMe } from "@workspace/api-client-react";
import { Delete, Phone, AlertCircle, Loader2, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const dial = params.get("dial");
    if (dial) setNumber(decodeURIComponent(dial));
  }, [search]);

  const press = (key: string) => setNumber((n) => n.length < 20 ? n + key : n);

  const handleZeroDown = () => {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setNumber((n) => n.length < 20 ? n + "+" : n);
    }, 500);
  };

  const handleZeroUp = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (!longPressFired.current) press("0");
  };

  const del = () => setNumber((n) => n.slice(0, -1));

  const handleCall = async () => {
    if (!number || number.length < 5) { toast({ title: "Enter a valid phone number", variant: "destructive" }); return; }
    startOutgoing({ number });
    try {
      await initiateCall({ data: { recipientNumber: number } });
      connectCall();
    } catch (err: any) {
      endCall();
      toast({ title: "Call failed", description: err?.message ?? "Check your subscription and coin balance.", variant: "destructive" });
    }
  };

  const coins = user?.coins ?? 0;
  const isActive = user?.subscriptionStatus === "active";
  const canCall = coins > 0 && isActive;

  const outerH = `calc(100dvh - env(safe-area-inset-top,0px) - ${NAV_H + 20}px - env(safe-area-inset-bottom,0px))`;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: outerH, paddingBottom: 16 }}>

      {/* Balance chip */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, marginBottom: 20,
        padding: "6px 14px", borderRadius: 20,
        background: canCall ? "var(--surface-1)" : "rgba(255,69,58,0.12)",
        border: `1px solid ${canCall ? "var(--sep)" : "rgba(255,69,58,0.22)"}`,
      }}>
        <Coins style={{ width: 13, height: 13, color: canCall ? "#ffd60a" : "#ff453a" }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: canCall ? "#ffd60a" : "#ff453a" }}>
          {coins.toFixed(2)} coins
        </span>
        {canCall && <span style={{ fontSize: 11, color: "var(--text-3)" }}>≈ {coins} min</span>}
      </div>

      {/* Warning */}
      {!canCall && user && (
        <button
          onClick={() => setLocation("/profile")}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 16px", borderRadius: 12, marginBottom: 16,
            background: "rgba(255,214,10,0.10)", border: "1px solid rgba(255,214,10,0.22)",
            width: "100%", maxWidth: 320, cursor: "pointer",
          }}
        >
          <AlertCircle style={{ width: 14, height: 14, color: "#ffd60a", flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "#ffd60a", textAlign: "left" }}>
            {!isActive ? "Subscribe to call — Basic R59 or Pro R109/month" : "Top up your wallet to make calls."}
          </span>
        </button>
      )}

      {/* Number display */}
      <div style={{ display: "flex", alignItems: "center", width: "100%", maxWidth: 320, marginBottom: 20 }}>
        <div style={{ width: 36 }} />
        <p style={{
          flex: 1, textAlign: "center", fontFamily: "monospace", fontWeight: 700,
          letterSpacing: "0.06em", userSelect: "none",
          fontSize: number.length > 14 ? 22 : number.length > 10 ? 26 : number.length > 6 ? 30 : 34,
          color: number ? "var(--text-1)" : "var(--text-3)",
        }}>
          {number || "Enter number"}
        </p>
        <div style={{ width: 36, display: "flex", justifyContent: "flex-end" }}>
          {number && (
            <button onClick={del} style={{
              width: 36, height: 36, borderRadius: 10,
              background: "var(--surface-1)", border: "1px solid var(--sep)",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}>
              <Delete style={{ width: 17, height: 17, color: "var(--text-2)" }} />
            </button>
          )}
        </div>
      </div>

      {/* Keypad inside a rounded card */}
      <div style={{
        background: "var(--surface-1)",
        border: "1px solid var(--sep)",
        borderRadius: 24,
        padding: "20px 20px 16px",
        display: "inline-block",
        boxShadow: "0 2px 12px rgba(0,0,0,0.22)",
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 68px)", gap: 12 }}>
          {DIAL_KEYS.map(({ key, sub }) => {
            const isZero = key === "0";
            return (
              <button
                key={key}
                {...(isZero
                  ? { onPointerDown: handleZeroDown, onPointerUp: handleZeroUp, onPointerLeave: handleZeroUp, onContextMenu: (e) => e.preventDefault() }
                  : { onClick: () => press(key) })}
                style={{
                  width: 68, height: 68, borderRadius: "50%",
                  background: "var(--surface-2)",
                  border: "1px solid var(--sep)",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  cursor: "pointer", userSelect: "none",
                  transition: "transform 0.08s, background 0.08s",
                }}
                onMouseDown={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                onMouseUp={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onTouchStart={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                onTouchEnd={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              >
                <span style={{ fontSize: 24, fontWeight: 500, color: "var(--text-1)", lineHeight: 1 }}>{key}</span>
                {sub && (
                  <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.14em", color: "var(--text-3)", marginTop: 2, lineHeight: 1 }}>
                    {sub}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Call button */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
          <button
            onClick={handleCall}
            disabled={isPending || !number}
            style={{
              width: 72, height: 72, borderRadius: "50%",
              background: number ? "#30d158" : "var(--surface-2)",
              border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: number ? "pointer" : "not-allowed",
              opacity: number ? 1 : 0.35,
              boxShadow: number ? "0 4px 16px rgba(48,209,88,0.35)" : "none",
              transition: "transform 0.12s, box-shadow 0.12s, opacity 0.18s",
            }}
          >
            {isPending
              ? <Loader2 style={{ width: 28, height: 28, color: "#fff" }} className="animate-spin" />
              : <Phone style={{ width: 28, height: 28, color: number ? "#fff" : "var(--text-3)" }} />
            }
          </button>
        </div>
      </div>
    </div>
  );
}
