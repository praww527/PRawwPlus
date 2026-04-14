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
      return { cause, causeCode, message: "Line busy", icon: "busy" };

    case "NO_ANSWER":
      return { cause, causeCode, message: "No answer", icon: "no-answer" };

    case "NORMAL_CLEARING":
      return { cause, causeCode, message: "Call ended", icon: "ended" };

    case "ORIGINATOR_CANCEL":
      return { cause, causeCode, message: "Call cancelled", icon: "ended" };

    case "UNREGISTERED":
    case "USER_NOT_REGISTERED":
    case "SUBSCRIBER_ABSENT":
    case "DESTINATION_OUT_OF_ORDER":
      return { cause, causeCode, message: "Not available", icon: "unavailable" };

    case "NO_ROUTE_DESTINATION":
    case "UNALLOCATED_NUMBER":
      return { cause, causeCode, message: "Number does not exist", icon: "unavailable" };

    case "ALLOTTED_TIMEOUT":
      return { cause, causeCode, message: "Insufficient balance", icon: "ended" };

    case "CALL_REJECTED":
      return { cause, causeCode, message: "Call rejected", icon: "unavailable" };

    case "ATTENDED_TRANSFER":
      return { cause, causeCode, message: "Went to voicemail", icon: "voicemail" };

    case "RECOVERY_ON_TIMER_EXPIRE":
    case "RECOVERY_ON_TIMER_EXPIRY":
      return { cause, causeCode, message: "No answer", icon: "no-answer" };

    default:
      if (causeCode === 17) return { cause, causeCode, message: "Line busy",             icon: "busy" };
      if (causeCode === 19) return { cause, causeCode, message: "No answer",             icon: "no-answer" };
      if (causeCode === 20) return { cause, causeCode, message: "Not available",         icon: "unavailable" };
      if (causeCode === 21) return { cause, causeCode, message: "Call rejected",         icon: "unavailable" };
      if (causeCode === 3)  return { cause, causeCode, message: "Number does not exist", icon: "unavailable" };
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
      onConnected:    () => setIsVertoConnected(true),
      onDisconnected: () => setIsVertoConnected(false),
      onError:        (err) => console.warn("[Verto]", err),

      onRinging: (_callId) => {
        setCallPhase((prev) => (prev === "calling" ? "ringing" : prev));
      },

      onIncoming: (callId, callerNumber, sdp) => {
        incomingSdpRef.current = sdp;
        pendingIncomingNumberRef.current = callerNumber;
        inboundRecordCreatedRef.current  = false;
        setHangupInfo(null);

        // A 4-digit number is an internal extension (caller ID hasn't resolved to mobile yet).
        // 7+ digit number is a mobile/external number — look up against PRaww+ users.
        const digits = callerNumber.replace(/\D/g, "");
        const looksInternal = digits.length === 4;

        setCallInfo({
          number: callerNumber,
          callId,
          callType: looksInternal ? "internal" : "external",
        });
        setCallPhase("calling");
        setCallState("incoming");

        if (looksInternal) {
          // Incoming extension — look up the caller's name and mobile number so
          // the UI can display a proper name instead of a raw 4-digit code.
          fetch(`/api/users/extension-lookup?extension=${encodeURIComponent(callerNumber)}`)
            .then((r) => r.ok ? r.json() : null)
            .then((data: { found: boolean; name?: string; phone?: string | null } | null) => {
              if (data?.found) {
                setCallInfo((prev) =>
                  prev?.callId === callId
                    ? {
                        ...prev,
                        callType: "internal",
                        name: data.name ?? prev.name,
                        // Show their mobile number as the subtitle if available
                        number: data.phone ?? prev.number,
                      }
                    : prev
                );
              }
            })
            .catch(() => {});
        } else if (digits.length >= 7) {
          // Mobile number — look up whether the caller is a PRaww+ user to show
          // "Internal · Free" and their display name.
          fetch(`/api/users/phone-lookup?phone=${encodeURIComponent(callerNumber)}`)
            .then((r) => r.ok ? r.json() : null)
            .then((data: { found: boolean; name?: string } | null) => {
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

        // Show a browser notification when the tab is not visible so the user
        // is alerted even if they are looking at a different tab or window.
        if (
          document.hidden &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          try {
            const label = looksInternal
              ? "Incoming call from a PRaww+ user"
              : `Incoming call from ${callerNumber}`;
            const n = new Notification("Incoming Call — PRaww+", {
              body: label,
              icon: "/favicon.ico",
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
        const info = resolveHangupInfo(hc);
        setHangupInfo(info);
        setCallPhase("ended");
        setTimeout(() => {
          setCallState("idle");
          setCallInfo(null);
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
        setTimeout(() => {
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
    } catch (e) {
      console.warn("[Verto] makeCall error", e);
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
      try {
        await clientRef.current.answerCall(callInfo.callId, incomingSdpRef.current);
        setHangupInfo(null);
        setCallPhase("connected");
        setCallState("active");

        // Create the inbound call record HERE — not in onAnswer.
        // For the callee (B-leg) browser, verto.answer is sent as a JSON-RPC
        // *request* to FreeSWITCH; FS only replies with a result — it never
        // pushes a verto.answer notification back to the callee, so onAnswer
        // never fires on this side.  acceptCall() is the correct place.
        //
        // IMPORTANT: capture the returned CallRecord and immediately update
        // callInfo.callId with the DB record's id (not the verto UUID).
        // CallingScreen uses callInfo.callId as the REST path param for
        // signalEndCall — if it stays as the verto UUID that call 404s.
        if (!inboundRecordCreatedRef.current && pendingIncomingNumberRef.current) {
          inboundRecordCreatedRef.current = true;
          try {
            const record = await createCallRecord({
              data: {
                recipientNumber: pendingIncomingNumberRef.current,
                direction: "inbound",
                fsCallId: callInfo.callId,
              },
            } as any);
            if (record?.id) {
              setCallInfo((prev) => prev ? { ...prev, callId: record.id } : prev);
            }
          } catch (e) {
            console.warn("[Call] inbound record create failed", e);
          }
        }
      } catch (e) {
        console.warn("[Verto] answerCall error", e);
        setHangupInfo({ cause: "WebRTC Error", causeCode: 500, message: "Failed to answer call", icon: "error" });
        setCallPhase("ended");
        setTimeout(() => {
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
    setTimeout(() => {
      setCallState("idle");
      setCallInfo(null);
    }, 800);
  }, [callInfo]);

  const endCall = useCallback((_durationSecs?: number) => {
    if (clientRef.current && callInfo?.callId) {
      clientRef.current.hangup(callInfo.callId, "NORMAL_CLEARING", 16);
    }
    setHangupInfo((prev) => prev ?? { cause: "NORMAL_CLEARING", causeCode: 16, message: "Call ended", icon: "ended" });
    setCallPhase("ended");
    setTimeout(() => {
      setCallState("idle");
      setCallInfo(null);
    }, 1500);
  }, [callInfo]);

  const setMuted   = useCallback((muted: boolean)    => { clientRef.current?.setMuted(muted); }, []);
  const setSpeaker = useCallback((enabled: boolean)  => { clientRef.current?.setSpeakerEnabled(enabled); }, []);
  const sendDtmf   = useCallback((digit: string)     => { clientRef.current?.sendDtmf(digit); }, []);

  return (
    <CallContext.Provider value={{
      callState, callPhase, callInfo, hangupInfo,
      vertoConfig, isVertoConnected,
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
