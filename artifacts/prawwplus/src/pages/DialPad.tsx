import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Phone, UserCircle2, Delete, ChevronRight, Shield, AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "@workspace/auth-web";
import { useInitiateCall } from "@workspace/api-client-react";
import { useCall } from "@/context/CallContext";
import { useToast } from "@/hooks/use-toast";
import { useEslOfflineRetry } from "@/hooks/useEslOfflineRetry";
import { EslOfflineBanner } from "@/components/EslOfflineBanner";

const BTN        = 76;
const COL_GAP    = 20;
const ROW_GAP    = 14;
const GRID_W     = BTN * 3 + COL_GAP * 2;

const DIAL_KEYS = [
  { key: "1", sub: "" },   { key: "2", sub: "ABC" },  { key: "3", sub: "DEF" },
  { key: "4", sub: "GHI" },{ key: "5", sub: "JKL" },  { key: "6", sub: "MNO" },
  { key: "7", sub: "PQRS"},{ key: "8", sub: "TUV" },  { key: "9", sub: "WXYZ" },
  { key: "*", sub: "" },   { key: "0", sub: "+" },     { key: "#", sub: "" },
];

function userInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return email ? email[0].toUpperCase() : "?";
}

const NAV_H = 83;

export default function DialPad() {
  const [, setLocation] = useLocation();
  const { user }         = useAuth();
  const {
    startOutgoing, connectCall, endCall, callPhase, updateCallId, updateCallType,
    vertoConfig, isVertoConnected, vertoError, makeVertoCall,
  } = useCall();
  const { mutateAsync: initiateCall, isPending } = useInitiateCall();
  const { toast } = useToast();

  const [number, setNumber] = useState("");
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const zeroHandled    = useRef(false);

  const primaryDid = (user as any)?.primaryDid as string | undefined;

  const {
    eslOfflinePending,
    eslRetryNumberRef,
    handleEslOfflineError,
    stopEslRetry,
  } = useEslOfflineRetry(() => handleCall());

  // If another call starts (ESL push), stop any pending retry
  useEffect(() => {
    if (callPhase === "incoming") stopEslRetry();
  }, [callPhase, stopEslRetry]);

  const press = (key: string) => {
    setNumber((n) => n.length < 20 ? n + key : n);
  };

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

  const coins = user?.coins ?? 0;
  const verificationStatus = (user as any)?.verificationStatus as string | undefined;
  const isVerificationGated = !verificationStatus || verificationStatus === "none" || verificationStatus === "rejected";
  const isVerificationPending = verificationStatus === "pending";

  const minLength  = 4;
  const isExtension = /^[1-9]\d{3}$/.test(number.trim());
  const isStarPrefix = number.startsWith("*") && number.length > 1;

  const handleCall = async () => {
    if (isVerificationGated) {
      toast({
        title: "Verification required",
        description: "Submit your business documents before making calls.",
        variant: "destructive",
      });
      setLocation("/profile");
      return;
    }
    if (!number || number.length < minLength) {
      toast({ title: "Enter an extension (4 digits) or full number", variant: "destructive" });
      return;
    }

    const vertoActive = Boolean(vertoConfig?.configured && isVertoConnected);
    const fsCallId = crypto.randomUUID();

    startOutgoing({ number });

    try {
      const record = await initiateCall({ data: { recipientNumber: number, fsCallId } });
      stopEslRetry();

      if (record?.id) updateCallId(record.id);

      const routeType  = record?.type;
      const dialTarget = routeType === "internal" ? String(record.extension) : number;
      if (routeType) updateCallType(routeType);

      if (routeType === "internal" && (record as any).calleeNotified) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2500));
      }

      if (vertoActive) {
        const vertoCallId = await makeVertoCall(dialTarget, fsCallId);
        if (!vertoCallId) {
          endCall();
          const stillConnected = Boolean(vertoConfig?.configured && isVertoConnected);
          toast({
            title:       "Call failed",
            description: stillConnected
              ? vertoError
                ? `Call rejected: ${vertoError}`
                : "FreeSWITCH rejected the call — check the server logs."
              : "Call server disconnected. Wait for reconnection (green dot) and try again.",
            variant: "destructive",
          });
          return;
        }
      } else {
        connectCall();
      }
    } catch (err: any) {
      endCall();
      if (handleEslOfflineError(err, number, handleCall)) return;
      toast({
        title: "Call failed",
        description: err?.message ?? "Could not place the call.",
        variant: "destructive",
      });
    }
  };

  const numFontSize = number.length > 14 ? 26 : number.length > 10 ? 30 : number.length > 6 ? 36 : 42;

  const isConnected  = Boolean(vertoConfig?.configured && isVertoConnected);
  const isConnecting = Boolean(vertoConfig?.configured && !isVertoConnected);
  const dotColor = isConnected ? "#30D158" : isConnecting ? "#FF9500" : "#FF3B30";

  const callBtnEnabled = !isPending && number.length >= minLength && !isVerificationGated;

  return (
    <div style={{
      position: "fixed",
      top: "env(safe-area-inset-top, 0px)",
      left: 0, right: 0,
      bottom: `calc(${NAV_H}px + env(safe-area-inset-bottom, 0px))`,
      display: "flex", flexDirection: "column", alignItems: "center",
      background: "transparent",
      overflowY: "auto",
      fontFamily: "-apple-system, 'SF Pro Text', 'Inter', sans-serif",
    }}>

      {/* ── Primary DID pill ── */}
      <div style={{
        width: "100%", maxWidth: 390,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "12px 20px 0", gap: 8,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 16px", borderRadius: 30,
          background: primaryDid ? "rgba(0,122,255,0.12)" : "rgba(118,118,128,0.18)",
          border: `0.5px solid ${primaryDid ? "rgba(0,122,255,0.3)" : "rgba(84,84,88,0.5)"}`,
        }}>
          <Phone style={{
            width: 13, height: 13,
            color: primaryDid ? "#007AFF" : "rgba(235,235,245,0.35)",
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 15, fontWeight: 700, letterSpacing: "0.02em",
            color: primaryDid ? "rgba(235,235,245,0.9)" : "rgba(235,235,245,0.35)",
          }}>
            {primaryDid ?? "No number assigned"}
          </span>
        </div>
      </div>

      {/* ── Top bar: Balance | Connection | Profile ── */}
      <div style={{
        width: "100%", maxWidth: 390,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px 0",
      }}>
        {/* Balance */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)" }}>
            R {coins.toFixed(2)}
          </span>
        </div>

        {/* Connection status */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 9, height: 9, borderRadius: "50%",
            background: dotColor,
            boxShadow: `0 0 5px ${dotColor}`,
          }} />
          {vertoConfig?.configured && (
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: isConnected ? "#30D158" : isConnecting ? "#FF9500" : "#FF3B30",
              maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {isConnected
                ? "Registered"
                : isConnecting
                  ? "Connecting…"
                  : vertoError
                    ? vertoError.length > 30 ? vertoError.slice(0, 30) + "…" : vertoError
                    : "Not registered"}
            </span>
          )}
        </div>

        {/* Profile avatar */}
        <button
          onClick={() => setLocation("/profile")}
          style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "rgba(118,118,128,0.24)",
            border: "none", display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", fontSize: 13, fontWeight: 600,
            color: "var(--text-1)", flexShrink: 0,
          }}
        >
          {user?.name || user?.email
            ? userInitials(user.name, user.email)
            : <UserCircle2 style={{ width: 18, height: 18, color: "rgba(235,235,245,0.4)" }} />
          }
        </button>
      </div>

      {/* ── Verification gate banner ── */}
      {isVerificationGated && (
        <button
          onClick={() => setLocation("/profile")}
          style={{
            width: "calc(100% - 32px)",
            margin: "10px 16px 0",
            padding: "12px 14px", borderRadius: 14,
            background: "rgba(255,59,48,0.10)",
            border: "1px solid rgba(255,59,48,0.28)",
            display: "flex", alignItems: "center", gap: 10,
            cursor: "pointer", textAlign: "left",
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: "rgba(255,59,48,0.18)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Shield style={{ width: 14, height: 14, color: "#FF3B30" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12, color: "#FF3B30", fontWeight: 700, margin: 0 }}>
              {verificationStatus === "rejected"
                ? "Verification rejected — resubmit to make calls"
                : "Business verification required to make calls"}
            </p>
            <p style={{ fontSize: 11, color: "rgba(255,59,48,0.75)", margin: "2px 0 0" }}>
              Submit your business documents &amp; agree to the Responsible Use Policy
            </p>
          </div>
          <ChevronRight style={{ width: 13, height: 13, color: "#FF3B30", flexShrink: 0 }} />
        </button>
      )}

      {/* ── Verification pending banner ── */}
      {isVerificationPending && (
        <button
          onClick={() => setLocation("/profile")}
          style={{
            width: "calc(100% - 32px)",
            margin: "10px 16px 0",
            padding: "10px 14px", borderRadius: 12,
            background: "rgba(255,214,10,0.08)",
            border: "1px solid rgba(255,214,10,0.22)",
            display: "flex", alignItems: "center", gap: 10,
            cursor: "pointer", textAlign: "left",
          }}
        >
          <AlertTriangle style={{ width: 14, height: 14, color: "#FFD60A", flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12, color: "#FFD60A", fontWeight: 600 }}>
            Verification under review · calls may be limited until approved
          </span>
          <ChevronRight style={{ width: 13, height: 13, color: "#FFD60A", flexShrink: 0 }} />
        </button>
      )}

      {/* ── ESL offline auto-retry banner ── */}
      {eslOfflinePending && (
        <EslOfflineBanner number={eslRetryNumberRef.current} onCancel={stopEslRetry} />
      )}

      <div style={{ flex: 1, minHeight: 16 }} />

      {/* ── Number display ── */}
      <div style={{
        width: GRID_W + 40, maxWidth: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 6, minHeight: 56, position: "relative",
        paddingLeft: 40, paddingRight: 40,
      }}>
        <span style={{
          flex: 1, textAlign: "center",
          fontSize: numFontSize, fontWeight: 300,
          letterSpacing: "0.04em",
          color: number
            ? isExtension
              ? "#007AFF"
              : isStarPrefix
                ? "#30D158"
                : "var(--text-1)"
            : "rgba(235,235,245,0.25)",
          userSelect: "none", lineHeight: 1.1,
          fontFamily: "-apple-system, 'SF Pro Display', sans-serif",
          transition: "font-size 0.1s, color 0.15s",
        }}>
          {number || "Ext or number"}
        </span>

        {number.length > 0 && (
          <button
            onClick={del}
            style={{
              position: "absolute", right: 0,
              width: 40, height: 40, borderRadius: "50%",
              background: "transparent", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "rgba(235,235,245,0.5)",
            }}
          >
            <Delete style={{ width: 22, height: 22 }} />
          </button>
        )}
      </div>

      {/* ── Star-prefix hint ── */}
      {isStarPrefix && (
        <div style={{
          marginBottom: 8,
          fontSize: 11, fontWeight: 500,
          color: "#30D158", letterSpacing: "0.03em",
        }}>
          ✓ Direct PSTN route · bypasses internal lookup
        </div>
      )}

      {/* ── Dial grid ── */}
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
        display: "flex", justifyContent: "center",
        marginTop: ROW_GAP + 4,
        marginBottom: 8,
      }}>
        <div style={{ width: BTN }} />
        <div style={{ width: BTN + COL_GAP * 2, display: "flex", justifyContent: "center" }}>
          <button
            onClick={handleCall}
            disabled={isPending || number.length < minLength || isVerificationGated}
            style={{
              width: BTN + 6, height: BTN + 6,
              borderRadius: "50%",
              background: isVerificationGated
                ? "rgba(255,59,48,0.25)"
                : "#30D158",
              border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: callBtnEnabled ? "pointer" : "default",
              opacity: isVerificationGated ? 0.7 : callBtnEnabled ? 1 : 0.38,
              transition: "opacity 0.2s, transform 0.1s",
              flexShrink: 0,
              boxShadow: callBtnEnabled && !isVerificationGated
                ? "0 4px 24px rgba(48,209,88,0.45)"
                : "none",
              WebkitTapHighlightColor: "transparent",
            }}
            onPointerDown={(e) => { if (callBtnEnabled) e.currentTarget.style.transform = "scale(0.93)"; }}
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
        onPointerUp:   () => { setPressed(false); onZeroUp(); },
        onPointerLeave: () => { setPressed(false); onZeroUp(); },
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      }
    : {
        onPointerDown: () => setPressed(true),
        onPointerUp:   () => { setPressed(false); onPress(); },
        onPointerLeave: () => setPressed(false),
      };

  return (
    <button
      {...handlers}
      style={{
        width: size, height: size,
        borderRadius: "50%",
        background: pressed ? "rgba(118,118,128,0.44)" : "rgba(118,118,128,0.24)",
        border: "none",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        cursor: "pointer",
        userSelect: "none", WebkitUserSelect: "none",
        transition: "background 0.08s, transform 0.08s",
        transform: pressed ? "scale(0.93)" : "scale(1)",
        padding: 0, gap: 0,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{
        fontSize: 28, fontWeight: 300,
        color: "var(--text-1)", lineHeight: 1,
        fontFamily: "-apple-system, 'SF Pro Display', sans-serif",
        letterSpacing: "-0.02em",
      }}>
        {primary}
      </span>
      {secondary && (
        <span style={{
          fontSize: 8.5, fontWeight: 600,
          letterSpacing: "0.16em",
          color: "rgba(235,235,245,0.45)",
          lineHeight: 1, marginTop: 3,
          fontFamily: "-apple-system, 'SF Pro Text', sans-serif",
        }}>
          {secondary}
        </span>
      )}
    </button>
  );
}
