import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { VertoClient, type VertoConfig } from "@/lib/verto";

export type CallState = "idle" | "outgoing" | "incoming" | "active";
/** calling = dialling (no answer yet), ringing = remote is ringing, connected = answered */
export type CallPhase = "calling" | "ringing" | "connected" | "ended";

export interface CallInfo {
  number: string;
  name?: string;
  callId?: string;
  callType?: "internal" | "external";
}

interface CallContextValue {
  callState: CallState;
  callPhase: CallPhase;
  callInfo: CallInfo | null;
  vertoConfig: VertoConfig | null;
  isVertoConnected: boolean;
  startOutgoing: (info: CallInfo) => void;
  updateCallId: (callId: string) => void;
  connectCall: () => void;
  acceptCall: () => void;
  declineCall: () => void;
  endCall: (durationSecs?: number) => void;
  setMuted: (muted: boolean) => void;
  setSpeaker: (enabled: boolean) => void;
  setVertoConfig: (cfg: VertoConfig) => void;
  makeVertoCall: (to: string) => Promise<string | null>;
  answerVertoCall: (callId: string, sdp: string) => Promise<void>;
  sendDtmf: (digit: string) => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [callPhase, setCallPhase] = useState<CallPhase>("calling");
  const [callInfo, setCallInfo] = useState<CallInfo | null>(null);
  const [vertoConfig, setVertoConfigState] = useState<VertoConfig | null>(null);
  const [isVertoConnected, setIsVertoConnected] = useState(false);

  const clientRef = useRef<VertoClient | null>(null);
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
        // Remote side is ringing — update phase from "calling" to "ringing"
        setCallPhase((prev) => (prev === "calling" ? "ringing" : prev));
      },

      onIncoming: (callId, callerNumber, sdp) => {
        incomingSdpRef.current = sdp;
        setCallInfo({
          number: callerNumber,
          callId,
          callType: callerNumber.replace(/\D/g, "").length === 4 ? "internal" : "external",
        });
        setCallPhase("calling");
        setCallState("incoming");
      },

      onAnswer: (_callId, _sdp) => {
        // Remote SDP was applied inside VertoClient before this fires
        setCallPhase("connected");
        setCallState("active");
      },

      onHangup: (_callId) => {
        setCallPhase("ended");
        setTimeout(() => {
          setCallState("idle");
          setCallInfo(null);
        }, 1500);
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
    setCallInfo(info);
    setCallPhase("calling");
    setCallState("outgoing");
  }, []);

  const updateCallId = useCallback((callId: string) => {
    setCallInfo((prev) => prev ? { ...prev, callId } : prev);
  }, []);

  // connectCall: fallback for non-Verto mode only
  const connectCall = useCallback(() => {
    setCallPhase("connected");
    setCallState("active");
  }, []);

  const makeVertoCall = useCallback(async (to: string): Promise<string | null> => {
    if (!clientRef.current) return null;
    try {
      return await clientRef.current.makeCall(to);
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
    setCallPhase("connected");
    setCallState("active");
  }, [callInfo]);

  const declineCall = useCallback(() => {
    if (clientRef.current && callInfo?.callId) {
      clientRef.current.hangup(callInfo.callId);
    }
    setCallPhase("ended");
    setTimeout(() => {
      setCallState("idle");
      setCallInfo(null);
    }, 800);
  }, [callInfo]);

  const endCall = useCallback((_durationSecs?: number) => {
    if (clientRef.current && callInfo?.callId) {
      clientRef.current.hangup(callInfo.callId);
    }
    setCallPhase("ended");
    setTimeout(() => {
      setCallState("idle");
      setCallInfo(null);
    }, 1500);
  }, [callInfo]);

  const setMuted = useCallback((muted: boolean) => {
    clientRef.current?.setMuted(muted);
  }, []);

  const setSpeaker = useCallback((enabled: boolean) => {
    clientRef.current?.setSpeakerEnabled(enabled);
  }, []);

  const sendDtmf = useCallback((digit: string) => {
    clientRef.current?.sendDtmf(digit);
  }, []);

  return (
    <CallContext.Provider value={{
      callState, callPhase, callInfo,
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
