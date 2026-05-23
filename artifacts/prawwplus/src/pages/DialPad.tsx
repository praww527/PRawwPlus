import { useState, useEffect, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { useMakeCall, useGetMe } from "@workspace/api-client-react";
import { Delete, Phone, Loader2, UserCircle2, ChevronRight, Shield, AlertTriangle, Clock } from "lucide-react";
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

function userInitials(name?: string, email?: string) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "ME";
}

export default function DialPad() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: user } = useGetMe();

  const userPhone = (user as any)?.phone as string | undefined;
  const userPhoneVerified = (user as any)?.phoneVerified as boolean | undefined;
  const showPhoneBanner = user && (!userPhone || !userPhoneVerified);
  const { mutateAsync: initiateCall, isPending } = useMakeCall();
  const {
    startOutgoing, updateCallId, updateCallType, connectCall, endCall,
    isVertoConnected, vertoConfig, vertoError,
    makeVertoCall, callInfo: activeCallInfo,
  } = useCall();
  const [number, setNumber] = useState("");
  const [recentCalls, setRecentCalls] = useState<any[]>([]);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const zeroHandled = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const dial = params.get("dial");
    if (dial) setNumber(decodeURIComponent(dial));
  }, [search]);

  useEffect(() => {
    fetch("/api/calls?limit=10&page=1", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const seen = new Set<string>();
        const uniq: any[] = [];
        for (const c of (d.calls ?? [])) {
          const num = c.recipientNumber ?? c.callerNumber;
          if (num && !seen.has(num)) { seen.add(num); uniq.push(c); }
          if (uniq.length >= 4) break;
        }
        setRecentCalls(uniq);
      })
      .catch(() => {});
  }, []);

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

  const coins = user?.coins ?? 0;
  const verificationStatus = (user as any)?.verificationStatus as string | undefined;
  const isVerificationGated = !verificationStatus || verificationStatus === "none" || verificationStatus === "rejected";
  const isVerificationPending = verificationStatus === "pending";

  const minLength = 7;

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
      toast({ title: "Enter a valid mobile number", variant: "destructive" });
      return;
    }

    // Block bare 4-digit strings — these look like internal extensions which
    // are backend-only identifiers and must never be dialled directly by users.
    if (/^[1-9]\d{3}$/.test(number.trim())) {
      toast({
        title: "Invalid number",
        description: "Please enter the full mobile number of the person you want to call.",
        variant: "destructive",
      });
      return;
    }

    const vertoActive = Boolean(vertoConfig?.configured && isVertoConnected);
    const fsCallId = crypto.randomUUID();

    startOutgoing({ number });

    try {
      const record = await initiateCall({ data: { recipientNumber: number, fsCallId } });
      if (record?.id) updateCallId(record.id);

      const routeType = record?.type;
      // dialTarget is the backend routing key (extension for internal calls).
      // It is used solely to establish the WebRTC leg and is NEVER displayed
      // in the UI or logged to the console.
      const dialTarget = routeType === "internal" ? String(record.extension) : number;
      if (routeType) updateCallType(routeType);

      if (vertoActive) {
        const vertoCallId = await makeVertoCall(dialTarget, fsCallId);
        if (!vertoCallId) {
          endCall();
          // isVertoConnected may have changed since we captured vertoActive
          // (the Verto WS could have dropped during the initiateCall await).
          // Give a targeted message so the user knows to wait for reconnection.
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
      toast({
        title: "Call failed",
        description: err?.message ?? "Could not place the call.",
        variant: "destructive",
      });
    }
  };

  const numFontSize = number.length > 14 ? 26 : number.length > 10 ? 30 : number.length > 6 ? 36 : 42;

  const isConnected = Boolean(vertoConfig?.configured && isVertoConnected);
  const isConnecting = Boolean(vertoConfig?.configured && !isVertoConnected);
  const dotColor = isConnected ? "#30d158" : isConnecting ? "#ff9f0a" : "#ff453a";

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
      background: "transparent",
      overflowY: "auto",
    }}>

      {/* Top bar: Balance (left) | Connection dot (center) | Profile (right) */}
      <div style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 20px 0",
        maxWidth: 480,
      }}>
        {/* Balance — top left */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)" }}>
            R {coins.toFixed(2)}
          </span>
        </div>

        {/* Connection dot + status label — center */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 10, height: 10, borderRadius: "50%",
            background: dotColor,
            boxShadow: `0 0 6px ${dotColor}`,
          }} />
          {vertoConfig?.configured && (
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: isConnected ? "#30d158" : isConnecting ? "#ff9f0a" : "#ff453a",
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

        {/* Profile avatar — top right */}
        <button
          onClick={() => setLocation("/profile")}
          style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "var(--glass-bg)",
            border: "1px solid var(--glass-border)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            fontSize: 13, fontWeight: 700, color: "var(--text-1)",
          }}
        >
          {user?.name || user?.email
            ? userInitials(user.name, user.email)
            : <UserCircle2 style={{ width: 18, height: 18, color: "var(--text-2)" }} />
          }
        </button>
      </div>

      {/* Business verification gate banner */}
      {isVerificationGated && (
        <button
          onClick={() => setLocation("/profile")}
          style={{
            width: "calc(100% - 32px)",
            margin: "10px 16px 0",
            padding: "12px 14px",
            borderRadius: 14,
            background: "rgba(255,69,58,0.10)",
            border: "1px solid rgba(255,69,58,0.28)",
            display: "flex", alignItems: "center", gap: 10,
            cursor: "pointer", textAlign: "left",
          }}
        >
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,69,58,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Shield style={{ width: 14, height: 14, color: "#ff453a" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12, color: "#ff453a", fontWeight: 700, margin: 0 }}>
              {verificationStatus === "rejected" ? "Verification rejected — resubmit to make calls" : "Business verification required to make calls"}
            </p>
            <p style={{ fontSize: 11, color: "rgba(255,69,58,0.75)", margin: "2px 0 0" }}>
              Submit your business documents & agree to the Responsible Use Policy
            </p>
          </div>
          <ChevronRight style={{ width: 13, height: 13, color: "#ff453a", flexShrink: 0 }} />
        </button>
      )}

      {/* Pending verification banner */}
      {isVerificationPending && (
        <button
          onClick={() => setLocation("/profile")}
          style={{
            width: "calc(100% - 32px)",
            margin: "10px 16px 0",
            padding: "10px 14px",
            borderRadius: 12,
            background: "rgba(255,214,10,0.08)",
            border: "1px solid rgba(255,214,10,0.22)",
            display: "flex", alignItems: "center", gap: 10,
            cursor: "pointer", textAlign: "left",
          }}
        >
          <AlertTriangle style={{ width: 14, height: 14, color: "#ffd60a", flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12, color: "#ffd60a", fontWeight: 600 }}>
            Verification under review · calls may be limited until approved
          </span>
          <ChevronRight style={{ width: 13, height: 13, color: "#ffd60a", flexShrink: 0 }} />
        </button>
      )}

      {/* Phone verification banner */}
      {showPhoneBanner && !isVerificationGated && (
        <button
          onClick={() => setLocation("/profile")}
          style={{
            width: "calc(100% - 32px)",
            margin: "10px 16px 0",
            padding: "10px 14px",
            borderRadius: 12,
            background: "rgba(255,149,0,0.12)",
            border: "1px solid rgba(255,149,0,0.28)",
            display: "flex", alignItems: "center", gap: 10,
            cursor: "pointer", textAlign: "left",
          }}
        >
          <Phone style={{ width: 14, height: 14, color: "#ff9f0a", flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12, color: "#ff9f0a", fontWeight: 600 }}>
            {!userPhone ? "Add your mobile number so PRaww+ users can reach you" : "Verify your mobile number to receive calls and dial external numbers"}
          </span>
          <ChevronRight style={{ width: 13, height: 13, color: "#ff9f0a", flexShrink: 0 }} />
        </button>
      )}

      <div style={{ flex: 1, minHeight: 16 }} />

      {/* Number display */}
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

      {/* Dial grid */}
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

      {/* Call button row */}
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
            disabled={isPending || number.length < minLength || isVerificationGated}
            style={{
              width: BTN + 6, height: BTN + 6,
              borderRadius: "50%",
              background: isVerificationGated
                ? "rgba(255,69,58,0.30)"
                : "linear-gradient(145deg, #3ddb6a, #28a84e)",
              border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: isVerificationGated ? "default" : "pointer",
              opacity: isVerificationGated ? 0.8 : number.length >= minLength ? 1 : 0.45,
              transition: "opacity 0.2s, transform 0.1s",
              flexShrink: 0,
              boxShadow: isVerificationGated ? "none" : "0 4px 20px rgba(48,209,88,0.35)",
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

      {/* Recent calls quick-dial */}
      {recentCalls.length > 0 && (
        <div style={{ width: GRID_W, maxWidth: "100%", marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 8 }}>
            <Clock style={{ width: 10, height: 10, color: "var(--text-3)" }} />
            <span style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Recent</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {recentCalls.map((c) => {
              const num = c.recipientNumber ?? c.callerNumber ?? "";
              return (
                <button
                  key={c.id}
                  onClick={() => setNumber(num)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 14px", borderRadius: 12,
                    background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                    cursor: "pointer", textAlign: "left", width: "100%",
                    backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
                  }}
                  onPointerDown={(e) => { e.currentTarget.style.opacity = "0.6"; }}
                  onPointerUp={(e) => { e.currentTarget.style.opacity = "1"; }}
                  onPointerLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                >
                  <Phone style={{ width: 12, height: 12, color: "var(--text-3)", flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 14, fontFamily: "monospace", color: "var(--text-1)", fontWeight: 500 }}>{num}</span>
                  <ChevronRight style={{ width: 12, height: 12, color: "var(--text-3)", flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        </div>
      )}

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
        background: pressed ? "rgba(255,255,255,0.18)" : "var(--dial-btn-bg)",
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
        fontWeight: 700,
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
