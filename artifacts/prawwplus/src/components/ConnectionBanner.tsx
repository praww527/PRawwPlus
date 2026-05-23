/**
 * ConnectionBanner — persistent status strip shown when Verto is disconnected.
 *
 * Rules:
 *  - Hidden when Verto is connected and browser is online.
 *  - Shows "Reconnecting…" (amber) during exponential-backoff reconnect loop.
 *  - Shows "No internet connection" (red) when browser goes offline.
 *  - Shows "Connecting…" (blue) during first-time connect.
 */

import { useEffect, useState } from "react";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { Wifi, WifiOff, Loader2 } from "lucide-react";

export function ConnectionBanner() {
  const { isOnline, isVertoReady, isReconnecting, reconnectCount } = useConnectionStatus();
  const [visible, setVisible] = useState(false);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const shouldShow = !isOnline || (!isVertoReady && (isReconnecting || reconnectCount > 0));
    if (shouldShow) {
      setVisible(true);
      setAnimate(true);
      return;
    }
    const t = setTimeout(() => {
      setVisible(false);
      setAnimate(false);
    }, 1200);
    return () => clearTimeout(t);
  }, [isOnline, isVertoReady, isReconnecting, reconnectCount]);

  if (!visible) return null;

  const hiding = isVertoReady && isOnline;

  let bg = "rgba(255,149,0,0.92)";
  let text = "Reconnecting…";
  let Icon = Loader2;
  let spin = true;

  if (!isOnline) {
    bg = "rgba(255,59,48,0.92)";
    text = "No internet connection";
    Icon = WifiOff;
    spin = false;
  } else if (!isVertoReady && !isReconnecting && reconnectCount === 0) {
    bg = "rgba(10,132,255,0.92)";
    text = "Connecting…";
    Icon = Loader2;
    spin = true;
  } else if (isVertoReady) {
    bg = "rgba(48,209,88,0.92)";
    text = "Connected";
    Icon = Wifi;
    spin = false;
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        padding: "7px 16px",
        paddingTop: "calc(7px + env(safe-area-inset-top, 0px))",
        background: bg,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        transition: "opacity 0.4s ease, transform 0.4s ease",
        opacity: animate && !hiding ? 1 : 0,
        transform: animate && !hiding ? "translateY(0)" : "translateY(-100%)",
        pointerEvents: "none",
      }}
    >
      <Icon
        size={13}
        style={{
          color: "#fff",
          animation: spin ? "spin 1s linear infinite" : undefined,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 12, fontWeight: 600, color: "#fff", letterSpacing: "0.01em" }}>
        {text}
      </span>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
