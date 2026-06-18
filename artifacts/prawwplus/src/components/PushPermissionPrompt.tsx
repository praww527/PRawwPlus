/**
 * PushPermissionPrompt — first-login in-app notification permission sheet.
 *
 * Slides up from the bottom once after the user logs in (2 s delay so the
 * UI settles first).  Calls usePushSubscription.subscribe() when the user
 * clicks "Allow" so the actual browser dialog fires from inside a user
 * gesture — required by iOS Safari and preferred by all browsers.
 *
 * Visibility rules:
 *  - Only shown when Notification.permission === "default" (never asked yet).
 *  - Never shown after the user interacts (localStorage key stores choice).
 *  - Never shown on iOS Safari unless the PWA is running in standalone mode,
 *    since iOS only supports push for Add-to-Home-Screen installs.
 */

import { useState, useEffect } from "react";
import { Bell, Loader2, X } from "lucide-react";
import { usePushSubscription } from "@/hooks/usePushSubscription";

const STORAGE_KEY = "praww:push-prompt";

function shouldShowPrompt(): boolean {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) return false;
  if (Notification.permission !== "default") return false;
  if (localStorage.getItem(STORAGE_KEY)) return false;

  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as { MSStream?: unknown }).MSStream;
  if (isIOS) {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    if (!isStandalone) return false;
  }

  return true;
}

export function PushPermissionPrompt() {
  const [visible, setVisible]   = useState(false);
  const [animate, setAnimate]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const { subscribe }           = usePushSubscription();

  useEffect(() => {
    if (!shouldShowPrompt()) return;
    const t = setTimeout(() => {
      setVisible(true);
      requestAnimationFrame(() => setAnimate(true));
    }, 2000);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    setAnimate(false);
    localStorage.setItem(STORAGE_KEY, "dismissed");
    setTimeout(() => setVisible(false), 350);
  }

  async function handleAllow() {
    setLoading(true);
    const granted = await subscribe();
    setLoading(false);
    localStorage.setItem(STORAGE_KEY, granted ? "subscribed" : "dismissed");
    setAnimate(false);
    setTimeout(() => setVisible(false), 350);
  }

  if (!visible) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Enable notifications prompt"
      style={{
        position: "fixed",
        bottom: 96,
        left: "50%",
        transform: `translateX(-50%) translateY(${animate ? 0 : 120}%)`,
        opacity: animate ? 1 : 0,
        transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease",
        zIndex: 9000,
        width: "calc(100% - 32px)",
        maxWidth: 400,
      }}
    >
      <div
        style={{
          background: "var(--glass-bg-strong)",
          backdropFilter: "blur(var(--glass-blur)) saturate(2.2)",
          WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(2.2)",
          border: "0.5px solid var(--glass-border)",
          boxShadow: "0 0.5px 0 var(--glass-highlight) inset, 0 16px 48px var(--glass-shadow)",
          borderRadius: 20,
          padding: "18px 18px 16px",
          display: "flex",
          gap: 14,
          alignItems: "flex-start",
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "rgba(0,122,255,0.18)",
            border: "1px solid rgba(0,122,255,0.32)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Bell style={{ width: 20, height: 20, color: "#007AFF" }} />
        </div>

        {/* Body */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text-1)",
            margin: "0 0 4px",
            lineHeight: 1.3,
          }}>
            Stay connected to your calls
          </p>
          <p style={{
            fontSize: 13,
            color: "var(--text-2)",
            margin: "0 0 14px",
            lineHeight: 1.45,
          }}>
            Get notified about incoming calls and voicemail even when this tab isn't active.
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleAllow}
              disabled={loading}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 10,
                background: loading ? "rgba(0,122,255,0.5)" : "#007AFF",
                border: "none",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: loading ? "default" : "pointer",
                transition: "background 0.15s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {loading ? (
                <>
                  <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
                  Enabling…
                </>
              ) : (
                "Allow Notifications"
              )}
            </button>
            <button
              onClick={dismiss}
              style={{
                height: 36,
                padding: "0 14px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.07)",
                border: "0.5px solid var(--glass-border)",
                color: "var(--text-2)",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Not now
            </button>
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={dismiss}
          aria-label="Close"
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "rgba(255,255,255,0.07)",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginTop: -2,
          }}
        >
          <X style={{ width: 14, height: 14, color: "var(--text-3)" }} />
        </button>
      </div>
    </div>
  );
}
