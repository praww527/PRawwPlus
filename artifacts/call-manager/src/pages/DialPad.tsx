import { useState, useEffect, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { useMakeCall, useGetMe } from "@workspace/api-client-react";
import { Delete, Phone, AlertCircle, Loader2 } from "lucide-react";
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

/* Button size and grid dimensions */
const BTN = 76;        // circle diameter px
const COL_GAP = 22;    // gap between columns px
const ROW_GAP = 14;    // gap between rows px
const GRID_W = BTN * 3 + COL_GAP * 2; // 272px total grid width

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
      toast({ title: "Call failed", description: err?.message ?? "Check your subscription and coin balance.", variant: "destructive" });
    }
  };

  const isActive = user?.subscriptionStatus === "active";
  const coins = user?.coins ?? 0;
  const canCall = coins > 0 && isActive;

  /* Number display font size — shrink for long numbers */
  const numFontSize = number.length > 14 ? 26 : number.length > 10 ? 30 : number.length > 6 ? 36 : 42;

  return (
    /* Fixed overlay that fills exactly the space between safe-area-top and tab bar */
    <div style={{
      position: "fixed",
      top: "env(safe-area-inset-top, 0px)",
      left: 0,
      right: 0,
      bottom: `calc(${NAV_H}px + env(safe-area-inset-bottom, 0px))`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      background: "var(--surface-0)",
      overflowY: "auto",
    }}>
      {/* Top breathing space */}
      <div style={{ flex: 1, minHeight: 24 }} />

      {/* ── Warning banner (subscription / coins) ── */}
      {user && !canCall && (
        <button
          onClick={() => setLocation("/profile")}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            marginBottom: 20, padding: "10px 18px", borderRadius: 12,
            background: "rgba(255,149,0,0.10)", border: "none",
            cursor: "pointer", maxWidth: GRID_W + 40,
          }}
        >
          <AlertCircle style={{ width: 15, height: 15, color: "#ff9500", flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "#ff9500", textAlign: "left" }}>
            {!isActive
              ? "Subscribe to make calls — from R59/mo"
              : "Top up your coin balance to call"}
          </span>
        </button>
      )}

      {/* ── Number display ── */}
      <div style={{
        width: GRID_W + 40,
        maxWidth: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 28,
        minHeight: 56,
        position: "relative",
        paddingLeft: 40,
        paddingRight: 40,
      }}>
        {/* Number text */}
        <span style={{
          flex: 1,
          textAlign: "center",
          fontSize: numFontSize,
          fontWeight: 300,
          letterSpacing: "0.04em",
          color: number ? "var(--text-1)" : "transparent",
          userSelect: "none",
          lineHeight: 1.1,
          fontFamily: "var(--font-sans)",
          transition: "font-size 0.1s",
        }}>
          {number || "0"}
        </span>

        {/* Backspace — visible only when there's a number */}
        {number.length > 0 && (
          <button
            onClick={del}
            style={{
              position: "absolute",
              right: 0,
              width: 40, height: 40,
              borderRadius: "50%",
              background: "transparent",
              border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
              color: "var(--text-2)",
            }}
          >
            <Delete style={{ width: 22, height: 22 }} />
          </button>
        )}
      </div>

      {/* ── Keypad grid ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(3, ${BTN}px)`,
        columnGap: COL_GAP,
        rowGap: ROW_GAP,
      }}>
        {DIAL_KEYS.map(({ key, sub }) => {
          const isZero = key === "0";
          return (
            <DialButton
              key={key}
              primary={key}
              secondary={sub}
              isZero={isZero}
              onPress={() => press(key)}
              onZeroDown={handleZeroDown}
              onZeroUp={handleZeroUp}
              size={BTN}
            />
          );
        })}
      </div>

      {/* ── Call button row ── */}
      <div style={{
        width: GRID_W,
        display: "flex",
        justifyContent: "center",
        marginTop: ROW_GAP + 4,
        marginBottom: 8,
      }}>
        {/* Left spacer (same width as a dial button for alignment) */}
        <div style={{ width: BTN }} />

        {/* Green call button — centered slot */}
        <div style={{ width: BTN + COL_GAP * 2, display: "flex", justifyContent: "center" }}>
          <button
            onClick={handleCall}
            disabled={isPending}
            style={{
              width: BTN + 6, height: BTN + 6,
              borderRadius: "50%",
              background: "#34C759",
              border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
              opacity: number.length >= 5 ? 1 : 0.45,
              transition: "opacity 0.2s, transform 0.1s",
              flexShrink: 0,
            }}
            onPointerDown={(e) => { e.currentTarget.style.transform = "scale(0.94)"; }}
            onPointerUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
            onPointerLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            {isPending
              ? <Loader2 style={{ width: 28, height: 28, color: "#fff" }} className="animate-spin" />
              : <Phone style={{ width: 28, height: 28, color: "#fff", fill: "#fff", strokeWidth: 0 }} />
            }
          </button>
        </div>

        {/* Right spacer */}
        <div style={{ width: BTN }} />
      </div>

      {/* Bottom breathing space */}
      <div style={{ flex: "0 0 16px" }} />
    </div>
  );
}

/* ── Reusable dial button ─────────────────────────────────────────── */
interface DialButtonProps {
  primary: string;
  secondary: string;
  isZero: boolean;
  size: number;
  onPress: () => void;
  onZeroDown: () => void;
  onZeroUp: () => void;
}

function DialButton({ primary, secondary, isZero, size, onPress, onZeroDown, onZeroUp }: DialButtonProps) {
  const [pressed, setPressed] = useState(false);

  const handlers = isZero
    ? {
        onPointerDown: () => { setPressed(true); onZeroDown(); },
        onPointerUp: () => { setPressed(false); onZeroUp(); },
        onPointerLeave: () => { setPressed(false); onZeroUp(); },
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      }
    : {
        onPointerDown: () => setPressed(true),
        onPointerUp: () => { setPressed(false); onPress(); },
        onPointerLeave: () => setPressed(false),
      };

  return (
    <button
      {...handlers}
      style={{
        width: size, height: size,
        borderRadius: "50%",
        background: pressed ? "var(--dial-btn-pressed)" : "var(--dial-btn-bg)",
        border: "none",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        cursor: "pointer",
        userSelect: "none",
        WebkitUserSelect: "none",
        transition: "background 0.08s",
        padding: 0,
        gap: 0,
      }}
    >
      <span style={{
        fontSize: 30,
        fontWeight: 400,
        color: "var(--text-1)",
        lineHeight: 1,
        fontFamily: "var(--font-sans)",
        letterSpacing: "-0.01em",
      }}>
        {primary}
      </span>
      {secondary && (
        <span style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "0.16em",
          color: "var(--text-2)",
          lineHeight: 1,
          marginTop: 3,
          fontFamily: "var(--font-sans)",
        }}>
          {secondary}
        </span>
      )}
    </button>
  );
}
