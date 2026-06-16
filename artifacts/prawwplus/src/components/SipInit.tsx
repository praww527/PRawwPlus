/**
 * SipInit — mounts a JsSIP SIP/WS User Agent in the background.
 *
 * Why both SIP and Verto?
 *   The dialplan dials BOTH legs simultaneously:
 *     ${verto_contact(N@domain)},user/N@domain
 *   Verto handles web-browser calls via mod_verto (JSON-RPC, port 8081).
 *   SIP/WS  handles calls via mod_sofia  (standard SIP, port 5066).
 *
 *   Registering both means:
 *    - Multi-device ring (web + mobile) — first to answer wins.
 *    - SIP fallback: if the Verto WebSocket is temporarily disconnected,
 *      the SIP leg can still receive incoming calls.
 *    - Outgoing calls continue to use Verto → callOrchestrator (no change).
 *
 * Deduplication:
 *   When a call comes in, FreeSWITCH rings BOTH legs.  The Verto INVITE
 *   usually arrives first.  If callState is already "incoming" or "active"
 *   when the SIP INVITE lands, the SIP session is rejected with 486 Busy Here
 *   so only one incoming-call UI is shown.
 *
 *   If the Verto connection is down, the SIP leg handles the call on its own.
 *
 * Incoming-call flow for the SIP fallback path:
 *   1. SIP INVITE arrives → start 400 ms race window.
 *   2. If callState is already "incoming"/"active"/"outgoing" within 400 ms
 *      → Verto won. Reject the SIP INVITE with 486.
 *   3. Otherwise → SIP wins. Call startIncomingSip() from CallContext, which
 *      sets callState = "incoming" and renders IncomingCallScreen.
 *   4. acceptFn  is wired to SipClient.answerPending() so JsSIP answers only
 *      when the user explicitly taps the Accept button.
 *   5. declineFn terminates the session with 486 / CALL_REJECTED.
 *   6. If the caller hangs up while the phone is ringing, the session "ended"
 *      event fires → declineCall() collapses the IncomingCallScreen.
 */

import { useEffect, useRef, useState } from "react";
import { SipClient, type SipConfig } from "@/lib/sip";
import { useCall } from "@/context/CallContext";
import { apiFetch } from "@/lib/apiFetch";
import { phoneAudio } from "@/lib/phoneAudio";

const FETCH_RETRY_MS  = 30_000;
const VERTO_RACE_MS   = 400;   // time to give Verto before SIP wins the race

export function SipInit() {
  const [sipConfig, setSipConfig] = useState<SipConfig | null>(null);
  const { callState, startIncomingSip, clearIncomingSip, declineCall } = useCall();
  const callStateRef = useRef(callState);
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  // Keep stable refs to context callbacks so the SipClient closure never
  // captures stale function references.
  const startIncomingSipRef = useRef(startIncomingSip);
  const clearIncomingSipRef = useRef(clearIncomingSip);
  const declineCallRef      = useRef(declineCall);
  useEffect(() => { startIncomingSipRef.current = startIncomingSip; }, [startIncomingSip]);
  useEffect(() => { clearIncomingSipRef.current = clearIncomingSip; }, [clearIncomingSip]);
  useEffect(() => { declineCallRef.current      = declineCall; },      [declineCall]);

  // ── Fetch SIP config from the API ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function fetchConfig() {
      try {
        const res = await apiFetch("/api/sip/config", { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const cfg = (await res.json()) as SipConfig;
        if (!cancelled && cfg.configured) {
          const proto = location.protocol === "https:" ? "wss:" : "ws:";
          const wsUrl = `${proto}//${location.host}/api/sip/ws`;
          setSipConfig({ ...cfg, sipWsUrl: wsUrl });
        }
      } catch (err) {
        console.warn("[SIP] Config fetch failed, retrying in 30 s:", err);
        if (!cancelled) retryTimer = setTimeout(fetchConfig, FETCH_RETRY_MS);
      }
    }

    fetchConfig();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, []);

  // ── Create and manage the SipClient lifecycle ──────────────────────────────
  useEffect(() => {
    if (!sipConfig) return;

    // Keep a ref to the client so the onIncoming accept/decline callbacks
    // (which close over clientRef) can call answerPending / rejectPending.
    const clientRef = { current: null as SipClient | null };

    const client = new SipClient(sipConfig, {
      onRegistered: () => {
        console.info("[SIP] Registered — browser is a SIP endpoint");
      },
      onUnregistered: () => {
        console.info("[SIP] Unregistered");
      },
      onError: (msg) => {
        console.warn("[SIP]", msg);
      },

      onIncoming: (session, callId, callerNumber, _sdp) => {
        const currentState = callStateRef.current;

        // Verto already owns a call — reject immediately so only one UI shows.
        if (currentState === "incoming" || currentState === "active" || currentState === "outgoing") {
          console.info(
            "[SIP] Rejecting duplicate SIP INVITE (Verto/call already active), callId:", callId,
          );
          return false;
        }

        // Give Verto VERTO_RACE_MS to deliver the same INVITE first.
        // If it does, we reject the SIP leg (deduplication).
        // If it doesn't, the SIP leg wins and we show IncomingCallScreen.
        let guardFired  = false;
        let cleanedUp   = false;

        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;
          clearTimeout(guard);
          phoneAudio.stopAll();
        };

        const guard = setTimeout(() => {
          guardFired = true;
          const stateNow = callStateRef.current;

          if (stateNow === "incoming" || stateNow === "active" || stateNow === "outgoing") {
            // Verto delivered the call during the race window.
            console.info("[SIP] Verto won race — rejecting SIP INVITE, callId:", callId);
            clientRef.current?.rejectPending(486, "Busy Here");
            cleanup();
            return;
          }

          // SIP wins — show the incoming call screen.
          console.info("[SIP] SIP fallback handling call from:", callerNumber, "callId:", callId);
          phoneAudio.startRingtone();

          const acceptFn = () => {
            cleanup();
            clientRef.current?.answerPending(sipConfig.iceServers);
          };

          const declineFn = () => {
            cleanup();
            clientRef.current?.rejectPending(486, "CALL_REJECTED");
          };

          startIncomingSipRef.current(callerNumber, acceptFn, declineFn);

          // If the caller hangs up while we're ringing, tear down the UI.
          session.on("ended", () => {
            console.info("[SIP] Caller ended while ringing — collapsing IncomingCallScreen");
            cleanup();
            // Only reset the UI if this SIP session is still the one being shown
            // (guard fires first check state is "incoming").
            if (callStateRef.current === "incoming") {
              clearIncomingSipRef.current();
              declineCallRef.current();
            }
          });
        }, VERTO_RACE_MS);

        // If the SIP session fails (e.g. network error) BEFORE the guard fires,
        // cancel the guard so we don't show a ghost incoming-call screen.
        session.on("failed", () => {
          if (!guardFired) {
            cleanup();
          }
        });

        // Returning true stores the session in SipClient as pendingSession.
        // It will NOT be auto-answered — answerPending() must be called explicitly.
        return true;
      },

      onHangup: (callId, cause) => {
        console.info("[SIP] Call ended:", callId, cause);
        phoneAudio.stopAll();
      },
    });

    clientRef.current = client;
    client.start();

    return () => {
      client.stop();
      clientRef.current = null;
    };
  }, [sipConfig]);

  return null;
}
