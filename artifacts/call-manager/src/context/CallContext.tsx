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
export type CallPhase = "calling" | "connected" | "ended";

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
  connectCall: () => void;
  acceptCall: () => void;
  declineCall: () => void;
  endCall: (durationSecs?: number) => void;
  setMuted: (muted: boolean) => void;
  setSpeaker: (enabled: boolean) => void;
  setVertoConfig: (cfg: VertoConfig) => void;
  makeVertoCall: (to: string) => Promise<string | null>;
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
      onConnected: () => setIsVertoConnected(true),
      onDisconnected: () => setIsVertoConnected(false),
      onError: (err) => console.warn("[Verto]", err),

      onIncoming: (callId, callerNumber, sdp) => {
        incomingSdpRef.current = sdp;
        setCallInfo({
          number: callerNumber,
          callId,
          callType: callerNumber.replace(/\D/g, "").length <= 4 ? "internal" : "external",
        });
        setCallPhase("calling");
        setCallState("incoming");
      },

      onAnswer: (_callId, _sdp) => {
        // Remote SDP is applied inside VertoClient.handleMessage before this fires
        setCallPhase("connected");
        setCallState("active");
      },

      onHangup: (_callId) => {
        setCallPhase("ended");
        setTimeout(() => {
          setCallState("idle");
          setCallInfo(null);
        }, 1200);
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
    setCallState("idle");
    setCallInfo(null);
  }, [callInfo]);

  const endCall = useCallback((_durationSecs?: number) => {
    if (clientRef.current && callInfo?.callId) {
      clientRef.current.hangup(callInfo.callId);
    }
    setCallPhase("ended");
    setTimeout(() => {
      setCallState("idle");
      setCallInfo(null);
    }, 1200);
  }, [callInfo]);

  const setMuted = useCallback((muted: boolean) => {
    clientRef.current?.setMuted(muted);
  }, []);

  const setSpeaker = useCallback((enabled: boolean) => {
    clientRef.current?.setSpeakerEnabled(enabled);
  }, []);

  return (
    <CallContext.Provider value={{
      callState, callPhase, callInfo,
      vertoConfig, isVertoConnected,
      startOutgoing, connectCall,
      acceptCall, declineCall, endCall,
      setMuted, setSpeaker,
      setVertoConfig, makeVertoCall,
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
