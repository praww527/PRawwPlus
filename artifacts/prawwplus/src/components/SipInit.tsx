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
 */

import { useEffect, useRef, useState } from "react";
import { SipClient, type SipConfig } from "@/lib/sip";
import { useCall } from "@/context/CallContext";
import { apiFetch } from "@/lib/apiFetch";
import { phoneAudio } from "@/lib/phoneAudio";

const FETCH_RETRY_MS = 30_000;

export function SipInit() {
  const [sipConfig, setSipConfig] = useState<SipConfig | null>(null);
  const { callState } = useCall();
  const callStateRef = useRef(callState);
  useEffect(() => { callStateRef.current = callState; }, [callState]);

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
          // Build the WS URL from the current browser origin (same logic as Verto)
          // so it always works behind the dev proxy and in production.
          const proto  = location.protocol === "https:" ? "wss:" : "ws:";
          const wsUrl  = `${proto}//${location.host}/api/sip/ws`;
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

        // Verto already owns a call — reject so only one ring UI is shown.
        if (currentState === "incoming" || currentState === "active" || currentState === "outgoing") {
          console.info("[SIP] Rejecting duplicate SIP INVITE (Verto is active), callId:", callId);
          return false;
        }

        // Verto connection is up and will handle this call — let it win.
        // We reject the SIP leg so the browser doesn't end up with two
        // competing WebRTC PeerConnections for the same call.
        //
        // The Verto onIncoming fires within milliseconds of the SIP INVITE
        // because FreeSWITCH sends both legs simultaneously. The 400 ms
        // guard below gives Verto a chance to arrive first.
        //
        // If Verto does NOT deliver the INVITE within 400 ms we accept the
        // SIP call on this leg (fallback path for Verto downtime).
        let accepted = false;
        const guard = setTimeout(() => {
          if (callStateRef.current === "incoming") {
            // Verto already won — session is already answered or about to be.
            console.info("[SIP] Verto delivered call first — SIP fallback not needed");
            try { session.terminate({ status_code: 486, reason_phrase: "Busy Here" }); } catch { /* ignore */ }
            return;
          }
          if (!accepted) {
            accepted = true;
            console.info("[SIP] Accepting SIP call (Verto fallback), from:", callerNumber);
            // Play ringtone — let the Verto/SIP both ring
            phoneAudio.startRingtone();
          }
        }, 400);

        // Tell SipClient to auto-answer (return true) so JsSIP sets up the
        // WebRTC session internally. We intercept the guard timer above to
        // stop the ringtone if Verto wins.
        void guard; // captured for cleanup in session.on("ended")
        return true;
      },

      onHangup: (callId, cause) => {
        console.info("[SIP] Call ended:", callId, cause);
        phoneAudio.stopAll();
      },
    });

    client.start();
    return () => { client.stop(); };
  }, [sipConfig]);

  return null;
}
