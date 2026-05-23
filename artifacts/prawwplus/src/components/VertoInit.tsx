import { useEffect } from "react";
import { useGetVertoConfig } from "@workspace/api-client-react";
import { useCall } from "@/context/CallContext";
import { phoneAudio } from "@/lib/phoneAudio";

/**
 * Initialises the Verto WebSocket client once the user's config is loaded.
 *
 * The WebSocket URL is always built from window.location so it works
 * regardless of what APP_URL is set to on the server.  The proxy at
 * /api/verto/ws is served by the API server (and forwarded by Vite dev
 * proxy in development), so same-origin wss:// always works.
 *
 * Also:
 *  - Unlocks the AudioContext on first user gesture so incoming ringtones
 *    are never silently blocked by the browser's autoplay policy.
 *  - Requests Web Notification permission so incoming calls can alert the
 *    user even when the tab is in the background.
 */
export function VertoInit() {
  const { data } = useGetVertoConfig();
  const { setVertoConfig } = useCall();

  useEffect(() => {
    if (!data) return;

    // Build the proxy WebSocket URL from the browser's current origin so we
    // never rely on the server-side APP_URL env var (which can be stale).
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${location.host}/api/verto/ws`;

    setVertoConfig({ ...data, wsUrl, configured: true });
  }, [data, setVertoConfig]);

  // Unlock the AudioContext on the first user gesture so subsequent
  // plays (including the incoming-call ringtone, which fires on an async
  // WebSocket message with no user gesture) are not blocked by autoplay policy.
  useEffect(() => {
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      phoneAudio.unlock();
      document.removeEventListener("click",      unlock, true);
      document.removeEventListener("touchstart", unlock, true);
      document.removeEventListener("keydown",    unlock, true);
    };
    document.addEventListener("click",      unlock, { capture: true, once: true });
    document.addEventListener("touchstart", unlock, { capture: true, once: true });
    document.addEventListener("keydown",    unlock, { capture: true, once: true });

    // Request notification permission and subscribe to web push so calls and
    // missed-call alerts arrive even when the tab is closed/backgrounded.
    (async () => {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return;

      let permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
      }
      if (permission !== "granted") return;

      try {
        const keyResp = await fetch("/api/users/vapid-public-key");
        if (!keyResp.ok) return;
        const { key } = (await keyResp.json()) as { key?: string };
        if (!key) return;

        const registration = await navigator.serviceWorker.ready;
        let sub = await registration.pushManager.getSubscription();

        if (!sub) {
          const appServerKey = Uint8Array.from(
            atob(key.replace(/-/g, "+").replace(/_/g, "/")),
            (c) => c.charCodeAt(0),
          );
          sub = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: appServerKey,
          });
        }

        await fetch("/api/users/web-push-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });
      } catch (err) {
        console.warn("[Push] Web push subscription error:", err);
      }
    })();

    return () => {
      document.removeEventListener("click",      unlock, true);
      document.removeEventListener("touchstart", unlock, true);
      document.removeEventListener("keydown",    unlock, true);
    };
  }, []);

  return null;
}
