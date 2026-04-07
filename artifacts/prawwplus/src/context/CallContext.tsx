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
  const pendingIncomingNumberRef = useRef<string | null>(null);
  const inboundRecordCreatedRef  = useRef<boolean>(false);

  // Refs used inside the stale Verto-callback closure and the polling effect
  const callStateRef    = useRef<CallState>("idle");
  const callInfoRef     = useRef<CallInfo | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttemptsRef = useRef(0);

  const { mutateAsync: createCallRecord } = useMakeCall();

  // Keep refs in sync so stale closures always see current values
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { callInfoRef.current  = callInfo;  }, [callInfo]);

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
        setCallInfo({
          number: callerNumber,
          callId,
          callType: callerNumber.replace(/\D/g, "").length === 4 ? "internal" : "external",
        });
        setCallPhase("calling");
        setCallState("incoming");
      },

      onAnswer: async (callId, _sdp) => {
        setHangupInfo(null);
        if (callStateRef.current === "outgoing") {
          // FreeSWITCH answered the A-leg for ICE/DTLS media setup before the
          // callee has actually picked up.  Stay in "ringing" — the polling
          // effect below transitions to "connected" once the DB confirms
          // status=answered via the CHANNEL_ANSWER ESL event.
          setCallPhase("ringing");
        } else {
          setCallPhase("connected");
        }
        setCallState("active");

        // Create an inbound call record for the callee so their Call History is complete.
        // Use the FreeSWITCH Unique-ID (verto callID) as fsCallId so ESL can correlate.
        if (!inboundRecordCreatedRef.current && pendingIncomingNumberRef.current) {
          inboundRecordCreatedRef.current = true;
          try {
            await createCallRecord({
              data: {
                recipientNumber: pendingIncomingNumberRef.current,
                direction: "inbound",
                fsCallId: callId,
              },
            } as any);
          } catch (e) {
            console.warn("[Call] inbound record create failed", e);
          }
        }
      },

      onHangup: (_callId, hc) => {
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
    if (clientRef.current && callInfo?.callId && incomingSdpRef.current) {
      try {
        await clientRef.current.answerCall(callInfo.callId, incomingSdpRef.current);
        setHangupInfo(null);
        setCallPhase("connected");
        setCallState("active");
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
  }, [callInfo]);

  const declineCall = useCallback(() => {
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
      startOutgoing, updateCallId, connectCall,
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
