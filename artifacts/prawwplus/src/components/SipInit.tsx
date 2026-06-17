/**
 * SipInit — mounts a JsSIP SIP/WS User Agent in the background.
 *
 * Incoming-call state machine per INVITE
 * ───────────────────────────────────────
 *   "racing"  — INVITE received; 400 ms window for Verto to win
 *   "ringing" — guard fired, SIP won race; IncomingCallScreen showing
 *   "active"  — user tapped Accept; WebRTC session answered
 *   "ended"   — call finished for any reason; cleanup complete
 *
 * Key invariants
 *   - SipClient.answerPending() is NEVER called automatically — only from
 *     the Accept button via startIncomingSip() acceptFn.
 *   - session.on("ended") is registered IMMEDIATELY after the INVITE arrives
 *     (not inside the guard timer) so early caller-cancels before the guard
 *     fires are caught and never produce a ghost IncomingCallScreen.
 *   - hangupFn passed to startIncomingSip() lets endCall() terminate the SIP
 *     session when the local user taps the End Call button during an active call.
 *   - onHangup callback handles audio cleanup; session event handlers handle
 *     UI state transitions.
 */

import { useEffect, useRef, useState } from "react";
import { SipClient, type SipConfig } from "@/lib/sip";
import { useCall } from "@/context/CallContext";
import { apiFetch } from "@/lib/apiFetch";
import { phoneAudio } from "@/lib/phoneAudio";

const FETCH_RETRY_MS = 30_000;
const VERTO_RACE_MS  = 800;

export function SipInit() {
  const [sipConfig, setSipConfig] = useState<SipConfig | null>(null);
  const {
    callState,
    startIncomingSip,
    clearIncomingSip,
    declineCall,
    endCall,
  } = useCall();

  const callStateRef        = useRef(callState);
  const startIncomingSipRef = useRef(startIncomingSip);
  const clearIncomingSipRef = useRef(clearIncomingSip);
  const declineCallRef      = useRef(declineCall);
  const endCallRef          = useRef(endCall);

  useEffect(() => { callStateRef.current        = callState;        }, [callState]);
  useEffect(() => { startIncomingSipRef.current = startIncomingSip; }, [startIncomingSip]);
  useEffect(() => { clearIncomingSipRef.current = clearIncomingSip; }, [clearIncomingSip]);
  useEffect(() => { declineCallRef.current      = declineCall;      }, [declineCall]);
  useEffect(() => { endCallRef.current          = endCall;          }, [endCall]);

  // ── Fetch SIP config ───────────────────────────────────────────────────────
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
          setSipConfig({ ...cfg, sipWsUrl: `${proto}//${location.host}/api/sip/ws` });
        }
      } catch (err) {
        console.warn("[SIP] Config fetch failed, retrying in 30 s:", err);
        if (!cancelled) retryTimer = setTimeout(fetchConfig, FETCH_RETRY_MS);
      }
    }

    fetchConfig();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, []);

  // ── Manage SipClient lifecycle ─────────────────────────────────────────────
  useEffect(() => {
    if (!sipConfig) return;

    const clientRef = { current: null as SipClient | null };

    const client = new SipClient(sipConfig, {
      onRegistered:   () => console.info("[SIP] Registered"),
      onUnregistered: () => console.info("[SIP] Unregistered"),
      onError:        (msg) => console.warn("[SIP]", msg),

      // ── Audio cleanup only — UI transitions are handled by session event handlers ──
      onHangup: (_callId, cause) => {
        console.info("[SIP] onHangup:", cause);
        phoneAudio.stopAll();
      },

      onIncoming: (session, callId, callerNumber, _sdp) => {
        const currentState = callStateRef.current;

        // Verto already owns a call → reject to avoid dual incoming-call UIs.
        if (
          currentState === "incoming" ||
          currentState === "active"   ||
          currentState === "outgoing"
        ) {
          console.info("[SIP] Rejecting SIP INVITE — Verto/call already active:", callId);
          return false;
        }

        // ── Per-INVITE state machine ─────────────────────────────────────────
        type InviteState = "racing" | "ringing" | "active" | "ended";
        let state: InviteState = "racing";

        const finish = (guardTimer: ReturnType<typeof setTimeout> | null) => {
          if (state === "ended") return;
          state = "ended";
          if (guardTimer !== null) clearTimeout(guardTimer);
          phoneAudio.stopAll();
        };

        // Register session end handlers IMMEDIATELY so a caller-cancel that
        // arrives before the guard fires is never missed.
        session.on("ended", () => {
          console.info("[SIP] session ended, state was:", state);
          const prevState = state;
          finish(guard);

          if (prevState === "ringing") {
            // Caller hung up while we were showing IncomingCallScreen.
            clearIncomingSipRef.current();
            declineCallRef.current();
          } else if (prevState === "active") {
            // Remote side hung up during an active call.
            endCallRef.current();
          }
          // prevState === "racing": guard timer is cancelled; no UI was shown.
        });

        session.on("failed", () => {
          console.info("[SIP] session failed, state was:", state);
          const prevState = state;
          finish(guard);

          if (prevState === "ringing") {
            clearIncomingSipRef.current();
            declineCallRef.current();
          }
        });

        // ── 400 ms race window ───────────────────────────────────────────────
        // eslint-disable-next-line prefer-const
        let guard = setTimeout(() => {
          if (state !== "racing") return; // session already ended before guard fired

          if (callStateRef.current !== "idle") {
            // Verto delivered the call during the window → reject SIP leg.
            console.info("[SIP] Verto won race — rejecting SIP INVITE:", callId);
            clientRef.current?.rejectPending(486, "Busy Here");
            state = "ended";
            return;
          }

          // SIP wins → show IncomingCallScreen.
          state = "ringing";
          console.info("[SIP] SIP fallback — showing incoming call from:", callerNumber);
          phoneAudio.startRingtone();

          const acceptFn = () => {
            if (state !== "ringing") return;
            state = "active";
            phoneAudio.stopAll();
            clientRef.current?.answerPending(sipConfig.iceServers);
          };

          const declineFn = () => {
            if (state === "ended") return;
            finish(null);
            state = "ended";
            clientRef.current?.rejectPending(486, "CALL_REJECTED");
          };

          const hangupFn = () => {
            if (state === "ended") return;
            finish(null);
            state = "ended";
            clientRef.current?.hangUp("NORMAL_CLEARING");
          };

          startIncomingSipRef.current(callerNumber, acceptFn, declineFn, hangupFn);
        }, VERTO_RACE_MS);

        // Returning true stores the session in SipClient as pendingSession.
        // answerPending() is only called explicitly via acceptFn above.
        return true;
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
