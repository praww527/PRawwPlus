import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { VertoClient, type VertoConfig, type HangupCause } from "@/lib/verto";
import { useMakeCall } from "@workspace/api-client-react";

export type CallState = "idle" | "outgoing" | "incoming" | "active";
export type CallPhase = "calling" | "ringing" | "connected" | "ended";

export interface CallInfo {
  number: string;
  name?: string;
  callId?: string;
  callType?: "internal" | "external";
}

export interface HangupInfo {
  cause:     string;
  causeCode: number;
  message:   string;
  icon:      "busy" | "no-answer" | "unavailable" | "voicemail" | "ended" | "error";
}

function resolveHangupInfo(hc: HangupCause): HangupInfo {
  const { cause, causeCode } = hc;

  switch (cause) {
    case "USER_BUSY":
      return { cause, causeCode, message: "The number you dialled is busy. Please try again later.", icon: "busy" };

    case "NO_ANSWER":
      return { cause, causeCode, message: "The person you are calling is not answering.", icon: "no-answer" };

    case "NORMAL_CLEARING":
      return { cause, causeCode, message: "Call ended", icon: "ended" };

    case "ORIGINATOR_CANCEL":
      return { cause, causeCode, message: "Call cancelled", icon: "ended" };

    case "UNREGISTERED":
    case "USER_NOT_REGISTERED":
    case "SUBSCRIBER_ABSENT":
      return { cause, causeCode, message: "The number you dialled is not available right now. Please try again later.", icon: "unavailable" };

    case "DESTINATION_OUT_OF_ORDER":
      return { cause, causeCode, message: "We could not connect your call. The destination is temporarily out of service.", icon: "unavailable" };

    case "NO_ROUTE_DESTINATION":
    case "UNALLOCATED_NUMBER":
      return { cause, causeCode, message: "The number you dialled does not exist or is no longer in service.", icon: "unavailable" };

    case "ALLOTTED_TIMEOUT":
      return { cause, causeCode, message: "Your balance is too low to continue. Please top up and try again.", icon: "ended" };

    case "CALL_REJECTED":
      return { cause, causeCode, message: "The number you dialled is not available right now.", icon: "unavailable" };

    case "ATTENDED_TRANSFER":
      return { cause, causeCode, message: "The call was transferred to voicemail.", icon: "voicemail" };

    case "RECOVERY_ON_TIMER_EXPIRE":
    case "RECOVERY_ON_TIMER_EXPIRY":
      return { cause, causeCode, message: "The person you are calling is not answering.", icon: "no-answer" };

    case "INCOMPATIBLE_DESTINATION":
    case "MANDATORY_IE_MISSING":
      return { cause, causeCode, message: "We could not connect your call due to a network issue. Please try again.", icon: "error" };

    case "SERVICE_UNAVAILABLE":
    case "NETWORK_OUT_OF_ORDER":
      return { cause, causeCode, message: "The network is temporarily unavailable. Please try again in a moment.", icon: "unavailable" };

    case "CHAN_NOT_IMPLEMENTED":
    case "FACILITY_NOT_IMPLEMENTED":
      return { cause, causeCode, message: "This type of call is not supported. Please contact support.", icon: "error" };

    default:
      if (causeCode === 17) return { cause, causeCode, message: "The number you dialled is busy. Please try again later.",            icon: "busy" };
      if (causeCode === 19) return { cause, causeCode, message: "The person you are calling is not answering.",                       icon: "no-answer" };
      if (causeCode === 20) return { cause, causeCode, message: "The number you dialled is not available right now.",                 icon: "unavailable" };
      if (causeCode === 21) return { cause, causeCode, message: "The number you dialled is not available right now.",                 icon: "unavailable" };
      if (causeCode === 3)  return { cause, causeCode, message: "The number you dialled does not exist or is no longer in service.", icon: "unavailable" };
      if (causeCode === 38) return { cause, causeCode, message: "The network is temporarily unavailable. Please try again.",         icon: "unavailable" };
      if (causeCode === 41) return { cause, causeCode, message: "We could not connect your call. Please try again.",                 icon: "error" };
      return { cause, causeCode, message: "Call ended", icon: "ended" };
  }
}

interface CallContextValue {
  callState:        CallState;
  callPhase:        CallPhase;
  callInfo:         CallInfo | null;
  hangupInfo:       HangupInfo | null;
  vertoConfig:      VertoConfig | null;
  isVertoConnected: boolean;
  vertoError:       string | null;
  startOutgoing:    (info: CallInfo) => void;
  updateCallId:     (callId: string) => void;
  updateCallType:   (callType: "internal" | "external") => void;
  connectCall:      () => void;
  acceptCall:       () => void;
  declineCall:      () => void;
  endCall:          (durationSecs?: number) => void;
  setMuted:         (muted: boolean) => void;
  setSpeaker:       (enabled: boolean) => void;
  setVertoConfig:   (cfg: VertoConfig) => void;
  makeVertoCall:    (to: string, callId?: string) => Promise<string | null>;
  answerVertoCall:  (callId: string, sdp: string) => Promise<void>;
  sendDtmf:         (digit: string) => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const [callState,        setCallState]        = useState<CallState>("idle");
  const [callPhase,        setCallPhase]        = useState<CallPhase>("calling");
  const [callInfo,         setCallInfo]         = useState<CallInfo | null>(null);
  const [hangupInfo,       setHangupInfo]       = useState<HangupInfo | null>(null);
  const [vertoConfig,      setVertoConfigState] = useState<VertoConfig | null>(null);
  const [isVertoConnected, setIsVertoConnected] = useState(false);
  const [vertoError,       setVertoError]       = useState<string | null>(null);

  const clientRef      = useRef<VertoClient | null>(null);
  const incomingSdpRef = useRef<string>("");
  const pendingIncomingNumberRef  = useRef<string | null>(null);
  const inboundRecordCreatedRef   = useRef<boolean>(false);
  const incomingNotificationRef   = useRef<Notification | null>(null);

  // Refs used inside the stale Verto-callback closure and the polling effect
  const callStateRef      = useRef<CallState>("idle");
  const callInfoRef       = useRef<CallInfo | null>(null);
  const vertoConfigRef    = useRef<VertoConfig | null>(null);
  const pollIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttemptsRef   = useRef(0);
  const hangupTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Epoch counter — incremented each time a new call starts (outgoing or incoming).
  // Guards stale async callbacks and timers from mutating state for a new call.
  const callEpochRef      = useRef(0);

  const { mutateAsync: createCallRecord } = useMakeCall();

  // Keep refs in sync so stale closures always see current values
  useEffect(() => { callStateRef.current   = callState;   }, [callState]);
  useEffect(() => { callInfoRef.current    = callInfo;    }, [callInfo]);
  useEffect(() => { vertoConfigRef.current = vertoConfig; }, [vertoConfig]);

  const setVertoConfig = useCallback((cfg: VertoConfig) => {
    setVertoConfigState((prev) => {
      if (prev?.wsUrl === cfg.wsUrl && prev?.extension === cfg.extension) return prev;
      return cfg;
    });
  }, []);

  useEffect(() => {
    if (!vertoConfig?.configured || !vertoConfig.wsUrl) return;

    const client = new VertoClient(vertoConfig, {
      onConnected:    () => { setIsVertoConnected(true); setVertoError(null); },
      onDisconnected: () => setIsVertoConnected(false),
      onError:        (err) => { console.warn("[Verto]", err); setVertoError(err); },

      onRinging: (_callId) => {
        setCallPhase((prev) => (prev === "calling" ? "ringing" : prev));
      },

      onIncoming: (callId, callerNumber, sdp) => {
        if (hangupTimerRef.current) { clearTimeout(hangupTimerRef.current); hangupTimerRef.current = null; }
        const epoch = ++callEpochRef.current;
        incomingSdpRef.current = sdp;
        // Always store the raw Verto caller ID (extension or phone) in the ref
        // so acceptCall() can use it for the inbound call record.
        pendingIncomingNumberRef.current = callerNumber;
        inboundRecordCreatedRef.current  = false;
        setHangupInfo(null);

        const digits = callerNumber.replace(/\D/g, "");
        const looksInternal = digits.length === 4;

        // For internal (extension) callers we deliberately start with an empty
        // number so the raw 4-digit extension is never shown to the user.
        // The async lookup below fills in the real mobile number immediately.
        setCallInfo({
          number:   looksInternal ? "" : callerNumber,
          callId,
          callType: looksInternal ? "internal" : "external",
        });
        setCallPhase("calling");
        setCallState("incoming");

        if (looksInternal) {
          // Resolve extension → name + mobile number so the UI looks like a
          // normal phone call (no 4-digit codes ever exposed to the user).
          fetch(`/api/users/extension-lookup?extension=${encodeURIComponent(callerNumber)}`)
            .then((r) => r.ok ? r.json() : null)
            .then((data: { found: boolean; name?: string; phone?: string | null } | null) => {
              if (callEpochRef.current !== epoch) return; // stale — new call started
              setCallInfo((prev) => {
                if (prev?.callId !== callId) return prev;
                return {
                  ...prev,
                  callType: "internal",
                  // Always prefer the resolved phone number — fall back to
                  // the name only (shown large) if phone is unavailable.
                  number: data?.phone ?? prev.number,
                  name:   data?.name  ?? prev.name,
                };
              });
            })
            .catch(() => {});
        } else if (digits.length >= 7) {
          // Full phone number — look up whether this is a registered PRaww+ user
          // so we can show their name and mark the call as internal.
          fetch(`/api/users/phone-lookup?phone=${encodeURIComponent(callerNumber)}`)
            .then((r) => r.ok ? r.json() : null)
            .then((data: { found: boolean; name?: string } | null) => {
              if (callEpochRef.current !== epoch) return; // stale — new call started
              if (data?.found) {
                setCallInfo((prev) =>
                  prev?.callId === callId
                    ? { ...prev, callType: "internal", name: data.name ?? prev.name }
                    : prev
                );
              }
            })
            .catch(() => {});
        }

        // Browser notification when the tab is not in focus.
        // Use the local `callerNumber` value here — state updates (setCallInfo)
        // are async and callInfo won't reflect the new call yet.
        if (
          document.hidden &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          try {
            const displayCaller = looksInternal ? "PRaww+ User" : callerNumber;
            const n = new Notification("📞 Incoming Call — PRaww+", {
              body: `${displayCaller} is calling`,
              icon: "/favicon.svg",
              tag: "incoming-call",
              requireInteraction: true,
            });
            n.onclick = () => { window.focus(); n.close(); };
            incomingNotificationRef.current = n;
          } catch {}
        }
      },

      onAnswer: (callId, _sdp) => {
        setHangupInfo(null);
        if (callStateRef.current === "outgoing") {
          // FreeSWITCH answered the A-leg for ICE/DTLS media setup before the
          // callee has actually picked up.  Stay in "ringing" — the polling
          // effect below transitions to "connected" once the DB confirms
          // status=answered via the CHANNEL_ANSWER ESL event.
          setCallPhase("ringing");
        } else {
          // onAnswer fires on the A-leg (caller) when the callee picks up.
          // For the B-leg (callee browser) onAnswer never fires because the
          // callee sends verto.answer as a JSON-RPC request and only gets a
          // result back — FreeSWITCH does not push a verto.answer notification
          // to the callee.  Inbound record creation is handled in acceptCall().
          setCallPhase("connected");
        }
        setCallState("active");
      },

      onHangup: (_callId, hc) => {
        // Dismiss any pending incoming-call notification
        if (incomingNotificationRef.current) {
          try { incomingNotificationRef.current.close(); } catch {}
          incomingNotificationRef.current = null;
        }
        const epochAtHangup = callEpochRef.current;
        const info = resolveHangupInfo(hc);
        setHangupInfo(info);
        setCallPhase("ended");
        if (hangupTimerRef.current) clearTimeout(hangupTimerRef.current);
        hangupTimerRef.current = setTimeout(() => {
          hangupTimerRef.current = null;
          // Only reset state if no new call has started since this hangup fired.
          // This prevents a delayed onHangup from a previous call from clearing
          // a new call that started in the 3-second window.
          if (callEpochRef.current === epochAtHangup) {
            setCallState("idle");
            setCallInfo(null);
          }
        }, 3000);
      },
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
      setIsVertoConnected(false);
    };
  }, [vertoConfig]);

  // Poll the call record (every 2 s) until FreeSWITCH confirms the callee
  // answered (CHANNEL_ANSWER → status "answered" in DB), then go to
  // "connected".  Also enforces a 60-second no-answer timeout: if the callee
  // never picks up and FreeSWITCH's verto.bye is delayed or lost, we auto-hangup
  // so the caller is never stuck ringing indefinitely.
  // This effect only runs in the unique state: active+ringing, which only
  // occurs for outbound calls after verto.answer fires prematurely.
  const NO_ANSWER_TIMEOUT_POLLS = 30; // 30 × 2 s = 60 seconds

  useEffect(() => {
    const active = callState === "active" && callPhase === "ringing" && callInfo?.callId;
    if (!active) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        pollAttemptsRef.current = 0;
      }
      return;
    }

    const dbCallId = callInfo!.callId!;
    pollAttemptsRef.current = 0;

    pollIntervalRef.current = setInterval(async () => {
      pollAttemptsRef.current += 1;

      // 60-second no-answer timeout: auto-hangup if callee never picks up
      if (pollAttemptsRef.current >= NO_ANSWER_TIMEOUT_POLLS) {
        clearInterval(pollIntervalRef.current!);
        pollIntervalRef.current = null;
        // Tell FreeSWITCH to tear down the call
        clientRef.current?.hangup(undefined, "NO_ANSWER", 19);
        setHangupInfo({ cause: "NO_ANSWER", causeCode: 19, message: "No answer", icon: "no-answer" });
        setCallPhase("ended");
        if (hangupTimerRef.current) clearTimeout(hangupTimerRef.current);
        hangupTimerRef.current = setTimeout(() => {
          hangupTimerRef.current = null;
          setCallState("idle");
          setCallInfo(null);
        }, 3000);
        return;
      }

      try {
        const res = await fetch(`/api/calls/${dbCallId}`);
        if (!res.ok) return;
        const data = await res.json() as { status?: string };
        if (data.status === "answered") {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          setCallPhase("connected");
        } else if (data.status === "completed" || data.status === "missed" || data.status === "failed" || data.status === "cancelled") {
          // Call ended on the server side — stop polling; onHangup will handle the UI
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
        }
      } catch { /* network error — will retry */ }
    }, 2000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [callState, callPhase, callInfo?.callId]);

  const startOutgoing = useCallback((info: CallInfo) => {
    if (hangupTimerRef.current) { clearTimeout(hangupTimerRef.current); hangupTimerRef.current = null; }
    callEpochRef.current += 1; // new call epoch — invalidates any pending stale timers
    setHangupInfo(null);
    setCallInfo(info);
    setCallPhase("calling");
    setCallState("outgoing");
  }, []);

  const updateCallId = useCallback((callId: string) => {
    setCallInfo((prev) => prev ? { ...prev, callId } : prev);
  }, []);

  const updateCallType = useCallback((callType: "internal" | "external") => {
    setCallInfo((prev) => prev ? { ...prev, callType } : prev);
  }, []);

  const connectCall = useCallback(() => {
    setCallPhase("connected");
    setCallState("active");
  }, []);

  const makeVertoCall = useCallback(async (to: string, callId?: string): Promise<string | null> => {
    if (!clientRef.current) return null;
    try {
      return await clientRef.current.makeCall(to, callId);
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e);
      console.warn("[Verto] makeCall error:", msg);
      // Surface the specific rejection reason so DialPad can show a useful toast.
      setVertoError(msg);
      return null;
    }
  }, []);

  const answerVertoCall = useCallback(async (callId: string, sdp: string): Promise<void> => {
    if (!clientRef.current) return;
    await clientRef.current.answerCall(callId, sdp);
  }, []);

  const acceptCall = useCallback(async () => {
    // Dismiss any background-tab notification immediately when the user answers
    if (incomingNotificationRef.current) {
      try { incomingNotificationRef.current.close(); } catch {}
      incomingNotificationRef.current = null;
    }

    if (clientRef.current && callInfo?.callId && incomingSdpRef.current) {
      // Capture the Verto UUID now — answerCall() needs it, but we may
      // overwrite callInfo.callId below with the MongoDB record ID.
      const vertoCallId = callInfo.callId;

      try {
        // ── Step 1: Create the inbound DB record BEFORE answering ─────────
        //
        // Doing this first guarantees that callInfo.callId is the MongoDB
        // record ID before callPhase ever becomes "connected".  Without this
        // ordering, a fast hangup would fire signalEndCall with the raw Verto
        // UUID (which is owned by the *caller's* outbound record, not the
        // callee's), causing a 404 and leaving the callee's record stuck in
        // "initiated".
        //
        // IMPORTANT — do NOT pass fsCallId here.  The caller's outbound record
        // already uses this Verto UUID as fsCallId.  Sharing the same value
        // causes ESL's finalizeCall() to findOne() the wrong record and leave
        // one of them permanently in "answered" state (silent data leak).
        //
        // Field semantics for the callee's inbound record:
        //   recipientNumber = callee's own extension (internal routing key)
        //   callerNumber    = caller's resolved mobile number (from extension
        //                     lookup) so call history always shows a real phone
        //                     number, never a raw 4-digit extension code.
        if (!inboundRecordCreatedRef.current && pendingIncomingNumberRef.current) {
          inboundRecordCreatedRef.current = true;
          try {
            const ownExt = vertoConfigRef.current?.extension;
            // By the time the user taps "Accept", the async extension→phone
            // lookup has almost always completed and callInfo.number holds the
            // real mobile number.  Fall back to the raw extension only if the
            // lookup failed or is somehow still in flight.
            const resolvedCallerPhone =
              callInfo?.number && callInfo.number.replace(/\D/g, "").length >= 7
                ? callInfo.number
                : pendingIncomingNumberRef.current;
            const record = await createCallRecord({
              data: {
                recipientNumber: ownExt ? String(ownExt) : pendingIncomingNumberRef.current,
                callerNumber:    resolvedCallerPhone,
                direction:       "inbound",
              },
            } as any);
            if (record?.id) {
              // Switch callInfo.callId to the DB record ID so signalEndCall
              // always targets the correct document.
              setCallInfo((prev) => prev ? { ...prev, callId: record.id } : prev);
            }
          } catch (e) {
            console.warn("[Call] inbound record create failed — call will still connect but history may be incomplete", e);
          }
        }

        // ── Step 2: Answer the Verto call using the original UUID ──────────
        await clientRef.current.answerCall(vertoCallId, incomingSdpRef.current);
        setHangupInfo(null);
        setCallPhase("connected");
        setCallState("active");
      } catch (e) {
        console.warn("[Verto] answerCall error", e);
        setHangupInfo({ cause: "WebRTC Error", causeCode: 500, message: "Failed to answer call", icon: "error" });
        setCallPhase("ended");
        if (hangupTimerRef.current) clearTimeout(hangupTimerRef.current);
        hangupTimerRef.current = setTimeout(() => {
          hangupTimerRef.current = null;
          setCallState("idle");
          setCallInfo(null);
        }, 1500);
      }
    } else {
      setHangupInfo(null);
      setCallPhase("connected");
      setCallState("active");
    }
  }, [callInfo, createCallRecord]);

  const declineCall = useCallback(() => {
    // Dismiss any background-tab notification when the user declines
    if (incomingNotificationRef.current) {
      try { incomingNotificationRef.current.close(); } catch {}
      incomingNotificationRef.current = null;
    }
    if (clientRef.current && callInfo?.callId) {
      clientRef.current.hangup(callInfo.callId, "CALL_REJECTED", 21);
    }
    setHangupInfo({ cause: "CALL_REJECTED", causeCode: 21, message: "Declined", icon: "ended" });
    setCallPhase("ended");
    if (hangupTimerRef.current) clearTimeout(hangupTimerRef.current);
    hangupTimerRef.current = setTimeout(() => {
      hangupTimerRef.current = null;
      setCallState("idle");
      setCallInfo(null);
    }, 800);
  }, [callInfo]);

  const endCall = useCallback((_durationSecs?: number) => {
    if (clientRef.current) {
      // Pass undefined so hangup() falls back to this.currentCallId — the real
      // Verto/FreeSWITCH UUID.  callInfo.callId is updated to the MongoDB
      // record ID after acceptCall() (callee) or after initiateCall() (caller),
      // so passing it directly would send verto.bye with an unrecognised callID
      // and FreeSWITCH would silently ignore the hangup request.
      clientRef.current.hangup(undefined, "NORMAL_CLEARING", 16);
    }
    setHangupInfo((prev) => prev ?? { cause: "NORMAL_CLEARING", causeCode: 16, message: "Call ended", icon: "ended" });
    setCallPhase("ended");
    if (hangupTimerRef.current) clearTimeout(hangupTimerRef.current);
    hangupTimerRef.current = setTimeout(() => {
      hangupTimerRef.current = null;
      setCallState("idle");
      setCallInfo(null);
    }, 1500);
  }, []);

  const setMuted   = useCallback((muted: boolean)    => { clientRef.current?.setMuted(muted); }, []);
  const setSpeaker = useCallback((enabled: boolean)  => { clientRef.current?.setSpeakerEnabled(enabled); }, []);
  const sendDtmf   = useCallback((digit: string)     => { clientRef.current?.sendDtmf(digit); }, []);

  return (
    <CallContext.Provider value={{
      callState, callPhase, callInfo, hangupInfo,
      vertoConfig, isVertoConnected, vertoError,
      startOutgoing, updateCallId, updateCallType, connectCall,
      acceptCall, declineCall, endCall,
      setMuted, setSpeaker,
      setVertoConfig, makeVertoCall, answerVertoCall, sendDtmf,
    }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}
