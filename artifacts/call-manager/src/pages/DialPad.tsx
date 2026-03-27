import { useState, useEffect, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { useMakeCall, useGetMe } from "@workspace/api-client-react";
import { Delete, Phone, AlertCircle, Loader2, Wifi, WifiOff } from "lucide-react";
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

const BTN = 76;
const COL_GAP = 22;
const ROW_GAP = 14;
const GRID_W = BTN * 3 + COL_GAP * 2;

function isInternalNumber(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  return digits.length === 4;
}

export default function DialPad() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: user } = useGetMe();
  const { mutateAsync: initiateCall, isPending } = useMakeCall();
  const {
    startOutgoing, updateCallId, connectCall, endCall,
    isVertoConnected, vertoConfig,
    makeVertoCall, callInfo: activeCallInfo,
  } = useCall();
  const [number, setNumber] = useState("");

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const zeroHandled = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const dial = params.get("dial");
    if (dial) setNumber(decodeURIComponent(dial));
  }, [search]);

  const press = (key: string) => setNumber((n) => n.length < 20 ? n + key : n);

  const handleZeroDown = () => {
    longPressFired.current = false;
    zeroHandled.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setNumber((n) => n.length < 20 ? n + "+" : n);
    }, 500);
  };

  const handleZeroUp = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (!longPressFired.current && !zeroHandled.current) {
      zeroHandled.current = true;
      press("0");
    }
  };

  const del = () => setNumber((n) => n.slice(0, -1));

  const isInternal = isInternalNumber(number);
  const coins = user?.coins ?? 0;
  const isActive = user?.subscriptionStatus === "active";
  const canCallExternal = coins > 0 && isActive;
  const minLength = 3;

  const handleCall = async () => {
    if (!number || number.length < minLength) {
      toast({
        title: "Enter a valid number or extension",
        variant: "destructive",
      });
      return;
    }

    if (!isInternal && !canCallExternal) {
      toast({
        title: "Cannot make external call",
        description: !isActive ? "Subscribe to make external calls" : "Top up your balance",
        variant: "destructive",
      });
      return;
    }

    const callType: "internal" | "external" = isInternal ? "internal" : "external";
    const vertoActive = Boolean(vertoConfig?.configured && isVertoConnected);

    // Pre-generate the FreeSWITCH call UUID so we can store it in the DB
    // BEFORE initiating the Verto call. This prevents a race condition where
    // FreeSWITCH fires CHANNEL_ORIGINATE / CHANNEL_ANSWER events before the
    // call record exists, causing the ESL handler to silently drop them.
    const fsCallId = crypto.randomUUID();

    // Show calling UI immediately
    startOutgoing({ number, callType });

    try {
      // Create the server-side call record FIRST (validates subscription/balance).
      // The fsCallId is stored now so ESL events arriving during ICE negotiation
      // can find this record.
      const record = await initiateCall({
        data: {
          recipientNumber: number,
          fsCallId,
        },
      });

      if (record?.id) {
        updateCallId(record.id);
      }

      if (vertoActive) {
        // Place the Verto WebRTC call, reusing the pre-generated UUID as the
        // Verto callID so FreeSWITCH uses it as its channel Unique-ID.
        const vertoCallId = await makeVertoCall(number, fsCallId);
        if (!vertoCallId) {
          // makeVertoCall returned null — WebSocket issue or ICE failure
          endCall();
          toast({
            title: "Call failed",
            description: "Could not connect to the call server. Check your connection.",
            variant: "destructive",
          });
          return;
        }
      } else {
        // No Verto connection — immediately mark as connected (non-VoIP fallback)
        connectCall();
      }
      // When Verto IS active: stay in "calling/ringing" state until verto.answer fires
    } catch (err: any) {
      endCall();
      toast({
        title: "Call failed",
        description: err?.message ?? (isInternal
          ? "Could not reach that extension."
          : "Check your subscription and coin balance."),
        variant: "destructive",
      });
    }
  };

  const extension = user?.extension;
  const numFontSize = number.length > 14 ? 26 : number.length > 10 ? 30 : number.length > 6 ? 36 : 42;

  return (
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
      <div style={{ flex: 1, minHeight: 16 }} />

      {extension && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          padding: "6px 16px",
          borderRadius: 20,
          background: "rgba(0,199,255,0.07)",
          border: "1px solid rgba(0,199,255,0.15)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Your Extension
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#00c7ff", letterSpacing: "0.04em" }}>
            {extension}
          </span>
          {vertoConfig?.configured && (
            <span style={{ display: "flex", alignItems: "center" }}>
              {isVertoConnected
                ? <Wifi style={{ width: 12, height: 12, color: "#30d158" }} />
                : <WifiOff style={{ width: 12, height: 12, color: "#ff9500" }} />
              }
            </span>
          )}
        </div>
      )}

      {user && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 10,
          padding: "5px 14px",
          borderRadius: 20,
          background: "rgba(255,214,10,0.08)",
          border: "1px solid rgba(255,214,10,0.15)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.40)", fontWeight: 500 }}>Balance</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#ffd60a", letterSpacing: "0.02em" }}>
            {coins.toFixed(2)}
          </span>
          <span style={{ fontSize: 10, color: "rgba(255,214,10,0.55)" }}>coins</span>
        </div>
      )}

      {number.length >= 3 && (
        <div style={{
          marginBottom: 8,
          padding: "4px 12px",
          borderRadius: 12,
          background: isInternal ? "rgba(48,209,88,0.08)" : "rgba(255,159,10,0.08)",
          border: `1px solid ${isInternal ? "rgba(48,209,88,0.2)" : "rgba(255,159,10,0.2)"}`,
        }}>
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: isInternal ? "#30d158" : "#ff9f0a",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}>
            {isInternal ? "Extension Call · Free" : "External Call · Coins"}
          </span>
        </div>
      )}

      {user && !isInternal && !canCallExternal && number.length >= 5 && (
        <button
          onClick={() => setLocation("/profile")}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            marginBottom: 16, padding: "10px 18px", borderRadius: 14,
            background: "rgba(255,149,0,0.08)",
            border: "1px solid rgba(255,149,0,0.15)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            cursor: "pointer", maxWidth: GRID_W + 40,
          }}
        >
          <AlertCircle style={{ width: 15, height: 15, color: "#ff9500", flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "#ff9500", textAlign: "left" }}>
            {!isActive
              ? "Subscribe for external calls — from R59/mo"
              : "Top up your coin balance to call externally"}
          </span>
        </button>
      )}

      <div style={{
        width: GRID_W + 40,
        maxWidth: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 24,
        minHeight: 56,
        position: "relative",
        paddingLeft: 40,
        paddingRight: 40,
      }}>
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

      <div style={{
        width: GRID_W,
        display: "flex",
        justifyContent: "center",
        marginTop: ROW_GAP + 4,
        marginBottom: 8,
      }}>
        <div style={{ width: BTN }} />
        <div style={{ width: BTN + COL_GAP * 2, display: "flex", justifyContent: "center" }}>
          <button
            onClick={handleCall}
            disabled={isPending || number.length < minLength}
            style={{
              width: BTN + 6, height: BTN + 6,
              borderRadius: "50%",
              background: "linear-gradient(145deg, #3ddb6a, #28a84e)",
              border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
              opacity: number.length >= minLength ? 1 : 0.45,
              transition: "opacity 0.2s, transform 0.1s",
              flexShrink: 0,
              boxShadow: "0 4px 20px rgba(48,209,88,0.35)",
            }}
            onPointerDown={(e) => { e.currentTarget.style.transform = "scale(0.93)"; }}
            onPointerUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
            onPointerLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            {isPending
              ? <Loader2 style={{ width: 28, height: 28, color: "#fff" }} className="animate-spin" />
              : <Phone style={{ width: 28, height: 28, color: "#fff", fill: "#fff", strokeWidth: 0 }} />
            }
          </button>
        </div>
        <div style={{ width: BTN }} />
      </div>

      <div style={{ flex: "0 0 12px" }} />
    </div>
  );
}

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
        background: pressed
          ? "rgba(255,255,255,0.18)"
          : "var(--dial-btn-bg)",
        border: "1px solid var(--dial-btn-border)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        cursor: "pointer",
        userSelect: "none",
        WebkitUserSelect: "none",
        transition: "background 0.08s, transform 0.08s",
        transform: pressed ? "scale(0.93)" : "scale(1)",
        padding: 0,
        gap: 0,
      }}
    >
      <span style={{
        fontSize: 30,
        fontWeight: 300,
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
