import { useEffect, useRef } from "react";
import { useGetVertoConfig } from "@workspace/api-client-react";
import { useCall } from "@/context/CallContext";
import { phoneAudio } from "@/lib/phoneAudio";
import { useVisibilityReconnect } from "@/hooks/useConnectionStatus";
import { apiFetch } from "@/lib/apiFetch";

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
 *  - Listens for SW_ANSWER_CALL / SW_DECLINE_CALL messages posted by the
 *    service worker when the user taps Answer/Decline on a push notification,
 *    and auto-answers or declines the Verto call accordingly.
 *  - Reads ?sw_action=answer from the URL on page load so that tapping
 *    Answer when the app was closed re-opens it and auto-answers the call
 *    once the Verto socket delivers the incoming-call invitation.
 */
export function VertoInit() {
  const { data } = useGetVertoConfig();
  const { setVertoConfig, callState, acceptCall, declineCall } = useCall();

  // Re-trigger Verto config (which reconnects the WebSocket) when the tab
  // becomes visible again and the connection is already lost.
  const dataRef = useRef(data);
  dataRef.current = data;
  useVisibilityReconnect(() => {
    if (!dataRef.current) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${location.host}/api/verto/ws`;
    setVertoConfig({ ...dataRef.current, wsUrl, configured: true });
  });

  // Keep stable refs to the latest call handlers so the SW listener never
  // becomes stale and never needs to be re-registered on every state change.
  const callStateRef  = useRef(callState);
  const acceptRef     = useRef(acceptCall);
  const declineRef    = useRef(declineCall);
  callStateRef.current = callState;
  acceptRef.current    = acceptCall;
  declineRef.current   = declineCall;

  // "answer as soon as the incoming call arrives" flag.
  const pendingAnswerRef  = useRef(false);
  // "decline as soon as the incoming call arrives" flag (app-closed decline).
  const pendingDeclineRef = useRef(false);

  useEffect(() => {
    if (!data) return;

    // Build the proxy WebSocket URL from the browser's current origin so we
    // never rely on the server-side APP_URL env var (which can be stale).
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${location.host}/api/verto/ws`;

    setVertoConfig({ ...data, wsUrl, configured: true });
  }, [data, setVertoConfig]);

  // ── Service-worker message bridge ────────────────────────────────────────
  //
  // Registered once (empty deps).  Uses refs for call state + handlers so it
  // never becomes stale.  This avoids a subtle race where a SW message arrives
  // exactly while the effect is tearing down and re-registering.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handler = (event: MessageEvent) => {
      const msgType = event.data?.type as string | undefined;

      if (msgType === "SW_ANSWER_CALL") {
        if (callStateRef.current === "incoming") {
          acceptRef.current();
        } else {
          pendingAnswerRef.current = true;
        }
      } else if (msgType === "SW_DECLINE_CALL") {
        if (callStateRef.current === "incoming") {
          declineRef.current();
        } else {
          pendingDeclineRef.current = true;
        }
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []); // intentionally empty — uses refs above

  // ── Auto-answer / auto-decline when the call arrives ────────────────────
  useEffect(() => {
    if (callState !== "incoming") return undefined;

    if (pendingAnswerRef.current) {
      pendingAnswerRef.current = false;
      // Small delay: let React flush the "incoming" state before acceptCall()
      // reads callInfo internals.
      const t = setTimeout(() => acceptCall(), 300);
      return () => clearTimeout(t);
    }

    if (pendingDeclineRef.current) {
      pendingDeclineRef.current = false;
      const t = setTimeout(() => declineCall(), 100);
      return () => clearTimeout(t);
    }

    return undefined;
  }, [callState, acceptCall, declineCall]);

  // ── Unlock AudioContext + push subscription + URL action parse ───────────
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

    // ── Parse ?sw_action from URL (app was closed when user tapped Answer) ──
    const params = new URLSearchParams(window.location.search);
    const swAction = params.get("sw_action");
    if (swAction === "answer") {
      pendingAnswerRef.current = true;
      // Clean up the URL immediately so a page refresh doesn't re-trigger it.
      params.delete("sw_action");
      params.delete("sw_callUuid");
      const cleanSearch = params.toString();
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + (cleanSearch ? "?" + cleanSearch : ""),
      );
    } else if (swAction === "decline") {
      // Mark pending so the call is declined as soon as Verto delivers the INVITE.
      pendingDeclineRef.current = true;
      params.delete("sw_action");
      const cleanSearch = params.toString();
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + (cleanSearch ? "?" + cleanSearch : ""),
      );
    }

    // ── Request notification permission + web-push subscription ─────────────
    //
    // iOS Safari 16.4+ supports Web Push but ONLY:
    //   1. When the site is added to the Home Screen (standalone PWA mode)
    //   2. When Notification.requestPermission() is called inside a user-gesture
    //      handler (calling it outside a gesture is silently blocked on iOS)
    //
    // Strategy:
    //   - Non-iOS browsers: subscribe immediately (Chrome/Firefox/Edge allow
    //     permission prompts outside gesture handlers).
    //   - iOS Safari: defer the permission request to the first user interaction
    //     so it runs inside the gesture-handling stack required by iOS.

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as { MSStream?: unknown }).MSStream;

    const setupPushSubscription = async () => {
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

        const appServerKey = Uint8Array.from(
          atob(key.replace(/-/g, "+").replace(/_/g, "/")),
          (c) => c.charCodeAt(0),
        );

        // If a subscription exists, verify its key matches the current VAPID public key.
        // If the key changed (e.g. env var was rotated), the old subscription will always
        // return 403/410 from the push service — force a re-subscription.
        if (sub) {
          const existingKey = sub.options.applicationServerKey;
          const keysMatch = existingKey && (() => {
            const a = new Uint8Array(existingKey as ArrayBuffer);
            const b = appServerKey;
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
            return true;
          })();
          if (!keysMatch) {
            await sub.unsubscribe();
            sub = null;
          }
        }

        if (!sub) {
          sub = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: appServerKey,
          });
        }

        await apiFetch("/api/users/web-push-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });
      } catch (err) {
        console.warn("[Push] Web push subscription error:", err);
      }
    };

    if (isIOS) {
      // Defer to the user-gesture unlock handler — required by iOS Safari.
      const iosUnlock = () => {
        setupPushSubscription().catch(() => {});
        document.removeEventListener("click",      iosUnlock, true);
        document.removeEventListener("touchstart", iosUnlock, true);
      };
      document.addEventListener("click",      iosUnlock, { capture: true, once: true });
      document.addEventListener("touchstart", iosUnlock, { capture: true, once: true });
    } else {
      setupPushSubscription().catch(() => {});
    }

    return () => {
      document.removeEventListener("click",      unlock, true);
      document.removeEventListener("touchstart", unlock, true);
      document.removeEventListener("keydown",    unlock, true);
    };
  }, []);

  return null;
}
