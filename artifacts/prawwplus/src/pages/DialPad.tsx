import { useState, useEffect, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { useMakeCall, useGetMe, useListMyNumbers } from "@workspace/api-client-react";
import { Delete, Phone, Loader2, UserCircle2, ChevronRight, Shield, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiFetch";
import { NAV_H } from "@/components/Layout";
import { useCall } from "@/context/CallContext";
import { useEslOfflineRetry } from "@/hooks/useEslOfflineRetry";
import { EslOfflineBanner } from "@/components/EslOfflineBanner";

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
  const { data: myNumbersData } = useListMyNumbers();
  const primaryDid = (myNumbersData as any)?.myNumbers?.[0]?.number ?? null;

  const userPhone = (user as any)?.phone as string | undefined;
  const userPhoneVerified = (user as any)?.phoneVerified as boolean | undefined;
  const showPhoneBanner = user && (!userPhone || !userPhoneVerified);
  const { mutateAsync: initiateCall, isPending } = useMakeCall();
  const {
    startOutgoing, updateCallId, updateCallType, connectCall, endCall,
    isVertoConnected, vertoConfig, vertoError,
    makeVertoCall,
  } = useCall();
  const [number, setNumber] = useState("");

  const longPressTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired  = useRef(false);
  const zeroHandled     = useRef(false);

  /* ── Colleague name typeahead ──────────────────────────────────────────── */
  type DirUser = { id: string; name: string; username: string | null; extension: number | null; did: string | null };
  const [dirQuery, setDirQuery]     = useState("");
  const [dirResults, setDirResults] = useState<DirUser[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirOpen, setDirOpen]       = useState(false);
  const dirDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── ESL offline auto-retry ────────────────────────────────────────────────
  const { eslOfflinePending, eslRetryNumberRef, handleEslOfflineError, stopEslRetry } =
    useEslOfflineRetry();

  useEffect(() => {
    const params = new URLSearchParams(search);
    const dial = params.get("dial");
    if (dial) setNumber(decodeURIComponent(dial));
  }, [search]);

  /* Debounced directory search — fires when dirQuery changes and has ≥2 chars */
  useEffect(() => {
    if (dirDebounceRef.current) clearTimeout(dirDebounceRef.current);
    if (dirQuery.trim().length < 2) { setDirResults([]); setDirOpen(false); return; }
    dirDebounceRef.current = setTimeout(async () => {
      setDirLoading(true);
      try {
        const res = await apiFetch(`/api/users/directory?q=${encodeURIComponent(dirQuery.trim())}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json() as { users: DirUser[] };
          setDirResults(data.users ?? []);
          setDirOpen(true);
        }
      } catch { /* silent */ }
      finally { setDirLoading(false); }
    }, 280);
    return () => { if (dirDebounceRef.current) clearTimeout(dirDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirQuery]);

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

  const minLength = 4;
  const isExtension = /^[1-9]\d{3}$/.test(number.trim());

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
      // If a retry was pending (ESL came back) — clear it now that the call succeeded
      stopEslRetry();

      if (record?.id) updateCallId(record.id);

      const routeType = record?.type;
      // dialTarget is the backend routing key (extension for internal calls).
      // It is used solely to establish the WebRTC leg and is NEVER displayed
      // in the UI or logged to the console.
      const dialTarget = routeType === "internal" ? String(record.extension) : number;
      if (routeType) updateCallType(routeType);

      // For internal calls: wait up to 2.5 s so the callee's Verto WebSocket
      // has time to reconnect after receiving the FCM wakeup push we sent in
      // POST /calls.  Without this pause FreeSWITCH tries to bridge the call
      // before verto_contact() has an active session for the callee.
      if (routeType === "internal" && (record as any).calleeNotified) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2500));
      }

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
      if (handleEslOfflineError(err, number, handleCall)) return;
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

      {/* Primary DID display — prominent, no extension shown */}
      <div style={{
        width: "100%", maxWidth: 480,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "12px 20px 0",
        gap: 8,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 16px", borderRadius: 30,
          background: primaryDid ? "rgba(59,130,246,0.1)" : "rgba(255,255,255,0.045)",
          border: `0.5px solid ${primaryDid ? "rgba(96,165,250,0.28)" : "rgba(255,255,255,0.12)"}`,
          borderTop: `0.5px solid ${primaryDid ? "rgba(96,165,250,0.38)" : "rgba(255,255,255,0.22)"}`,
          backdropFilter: "blur(48px) saturate(2.2)",
          WebkitBackdropFilter: "blur(48px) saturate(2.2)",
          boxShadow: "0 0.5px 0 rgba(255,255,255,0.18) inset, 0 4px 20px rgba(0,0,0,0.5)",
        }}>
          <Phone style={{
            width: 13, height: 13,
            color: primaryDid ? "#93c5fd" : "rgba(255,255,255,0.3)",
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 15, fontWeight: 700, letterSpacing: "0.03em",
            fontFamily: "var(--font-sans)",
            color: primaryDid ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)",
          }}>
            {primaryDid ?? "No number assigned"}
          </span>
        </div>
      </div>

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
            background: "rgba(255,255,255,0.07)",
            border: "0.5px solid rgba(255,255,255,0.18)",
            backdropFilter: "blur(48px) saturate(2.2)",
            WebkitBackdropFilter: "blur(48px) saturate(2.2)",
            boxShadow: "0 0.5px 0 rgba(255,255,255,0.28) inset, 0 4px 16px rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            fontSize: 13, fontWeight: 600, color: "var(--text-1)",
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

      {/* ESL offline auto-retry banner */}
      {eslOfflinePending && (
        <EslOfflineBanner number={eslRetryNumberRef.current} onCancel={stopEslRetry} />
      )}

      <div style={{ flex: 1, minHeight: 16 }} />

      {/* Colleague name typeahead search */}
      <div style={{
        width: GRID_W + 40, maxWidth: "100%",
        position: "relative", marginBottom: 10, paddingLeft: 4, paddingRight: 4,
      }}>
        <input
          type="text"
          placeholder="Search colleague by name…"
          value={dirQuery}
          onChange={(e) => setDirQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setDirOpen(false)}
          onFocus={() => dirResults.length > 0 && setDirOpen(true)}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "10px 14px", borderRadius: 14,
            background: "rgba(255,255,255,0.05)",
            border: "0.5px solid rgba(255,255,255,0.12)",
            borderTop: "0.5px solid rgba(255,255,255,0.20)",
            backdropFilter: "blur(48px) saturate(2.2)",
            WebkitBackdropFilter: "blur(48px) saturate(2.2)",
            boxShadow: "0 0.5px 0 rgba(255,255,255,0.18) inset, 0 4px 20px rgba(0,0,0,0.4)",
            color: "rgba(255,255,255,0.85)", fontSize: 14, outline: "none",
          }}
        />
        {dirLoading && (
          <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.35)", fontSize: 11 }}>
            Searching…
          </span>
        )}
        {dirOpen && dirResults.length > 0 && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 300,
            marginTop: 6, borderRadius: 16, overflow: "hidden",
            background: "rgba(8,8,8,0.94)",
            border: "0.5px solid rgba(255,255,255,0.14)",
            borderTop: "0.5px solid rgba(255,255,255,0.22)",
            backdropFilter: "blur(48px) saturate(2.2)",
            WebkitBackdropFilter: "blur(48px) saturate(2.2)",
            boxShadow: "0 0.5px 0 rgba(255,255,255,0.14) inset, 0 16px 48px rgba(0,0,0,0.7)",
          }}>
            {dirResults.map((u) => (
              <button
                key={u.id}
                onClick={() => {
                  if (u.extension) {
                    setNumber(String(u.extension));
                    setDirQuery("");
                    setDirOpen(false);
                  } else if (u.did) {
                    setNumber(u.did);
                    setDirQuery("");
                    setDirOpen(false);
                  } else {
                    toast({ title: `${u.name} has no extension assigned`, variant: "destructive" });
                    setDirOpen(false);
                  }
                }}
                style={{
                  width: "100%", display: "flex", alignItems: "center",
                  justifyContent: "space-between", padding: "10px 14px",
                  background: "none", border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  cursor: "pointer", textAlign: "left",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.88)" }}>{u.name}</span>
                  {u.extension && (
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>Ext {u.extension}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

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
          fontWeight: 200,
          letterSpacing: "0.06em",
          color: number ? (isExtension ? "#60a5fa" : "var(--text-1)") : "rgba(255,255,255,0.18)",
          userSelect: "none",
          lineHeight: 1.1,
          fontFamily: "var(--font-display)",
          transition: "font-size 0.1s, color 0.15s",
        }}>
          {number || "Ext or number"}
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
                ? "rgba(255,69,58,0.25)"
                : "radial-gradient(circle at 38% 32%, rgba(255,255,255,0.30) 0%, rgba(52,211,105,0.95) 42%, rgba(22,163,74,1) 100%)",
              border: isVerificationGated ? "0.5px solid rgba(255,69,58,0.4)" : "0.5px solid rgba(255,255,255,0.22)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: isVerificationGated ? "default" : "pointer",
              opacity: isVerificationGated ? 0.8 : number.length >= minLength ? 1 : 0.4,
              transition: "opacity 0.2s, transform 0.1s",
              flexShrink: 0,
              boxShadow: isVerificationGated
                ? "none"
                : "0 0 0 10px rgba(34,197,94,0.08), 0 0 0 20px rgba(34,197,94,0.04), 0 12px 40px rgba(34,197,94,0.45), 0 0.5px 0 rgba(255,255,255,0.45) inset",
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
        background: pressed ? "var(--dial-btn-pressed)" : "var(--dial-btn-bg)",
        border: "0.5px solid var(--dial-btn-border)",
        backdropFilter: "blur(48px) saturate(2.2)",
        WebkitBackdropFilter: "blur(48px) saturate(2.2)",
        boxShadow: pressed
          ? "0 0.5px 0 rgba(255,255,255,0.1) inset, 0 2px 8px rgba(0,0,0,0.4)"
          : "0 0.5px 0 rgba(255,255,255,0.22) inset, 0 0 0 0.5px rgba(0,0,0,0.5), 0 6px 24px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        cursor: "pointer",
        userSelect: "none",
        WebkitUserSelect: "none",
        transition: "background 0.08s, transform 0.08s, box-shadow 0.08s",
        transform: pressed ? "scale(0.92)" : "scale(1)",
        padding: 0,
        gap: 0,
      }}
    >
      <span style={{
        fontSize: 28,
        fontWeight: 300,
        color: "var(--text-1)",
        lineHeight: 1,
        fontFamily: "var(--font-display)",
        letterSpacing: "-0.02em",
      }}>
        {primary}
      </span>
      {secondary && (
        <span style={{
          fontSize: 8.5,
          fontWeight: 600,
          letterSpacing: "0.16em",
          color: "var(--text-3)",
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
