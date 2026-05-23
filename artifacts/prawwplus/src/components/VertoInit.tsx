import { useEffect, useRef } from "react";
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

  // True when a service-worker or URL action says "answer as soon as the
  // incoming call arrives".  Using a ref avoids stale-closure issues.
  const pendingAnswerRef = useRef(false);

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
  // The SW posts SW_ANSWER_CALL / SW_DECLINE_CALL to the app window when the
  // user taps Answer / Decline on a push notification.  We forward those
  // actions to the Verto call layer here.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handler = (event: MessageEvent) => {
      const msgType = event.data?.type as string | undefined;

      if (msgType === "SW_ANSWER_CALL") {
        if (callState === "incoming") {
          acceptCall();
        } else {
          // Call may not have arrived yet (race between SW message and Verto
          // INVITE). Mark pending — the effect below will answer when ready.
          pendingAnswerRef.current = true;
        }
      } else if (msgType === "SW_DECLINE_CALL") {
        declineCall();
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [callState, acceptCall, declineCall]);

  // ── Auto-answer when the call arrives (after SW message or URL param) ───
  useEffect(() => {
    if (callState !== "incoming" || !pendingAnswerRef.current) return;
    pendingAnswerRef.current = false;
    // Small delay: let React flush the state update that set callState to
    // "incoming" before we call acceptCall(), which reads callInfo internals.
    const t = setTimeout(() => acceptCall(), 300);
    return () => clearTimeout(t);
  }, [callState, acceptCall]);

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
      // Decline is handled once the call arrives via the pending flag pattern;
      // for now just clean the URL.
      params.delete("sw_action");
      const cleanSearch = params.toString();
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + (cleanSearch ? "?" + cleanSearch : ""),
      );
    }

    // ── Request notification permission + web-push subscription ─────────────
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
