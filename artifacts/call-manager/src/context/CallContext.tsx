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
      return { cause, causeCode, message: "Call time limit reached", icon: "ended" };

    case "CALL_REJECTED":
      return { cause, causeCode, message: "Call rejected", icon: "unavailable" };

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
        setHangupInfo(null);
        setCallInfo({
          number: callerNumber,
          callId,
          callType: callerNumber.replace(/\D/g, "").length === 4 ? "internal" : "external",
        });
        setCallPhase("calling");
        setCallState("incoming");
      },

      onAnswer: (_callId, _sdp) => {
        setHangupInfo(null);
        setCallPhase("connected");
        setCallState("active");
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
      } catch (e) {
        console.warn("[Verto] answerCall error", e);
      }
    }
    setHangupInfo(null);
    setCallPhase("connected");
    setCallState("active");
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
