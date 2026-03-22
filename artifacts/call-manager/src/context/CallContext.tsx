import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type CallState = "idle" | "outgoing" | "incoming" | "active";
export type CallPhase = "calling" | "connected" | "ended";

export interface CallInfo {
  number: string;
  name?: string;
}

interface CallContextValue {
  callState: CallState;
  callPhase: CallPhase;
  callInfo: CallInfo | null;
  startOutgoing: (info: CallInfo) => void;
  connectCall: () => void;
  simulateIncoming: (info: CallInfo) => void;
  acceptCall: () => void;
  declineCall: () => void;
  endCall: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [callPhase, setCallPhase] = useState<CallPhase>("calling");
  const [callInfo, setCallInfo]   = useState<CallInfo | null>(null);

  const startOutgoing = useCallback((info: CallInfo) => {
    setCallInfo(info);
    setCallPhase("calling");
    setCallState("outgoing");
  }, []);

  /* Called when the remote party answers */
  const connectCall = useCallback(() => {
    setCallPhase("connected");
  }, []);

  const simulateIncoming = useCallback((info: CallInfo) => {
    setCallInfo(info);
    setCallPhase("calling");
    setCallState("incoming");
  }, []);

  /* Accepting an incoming call goes straight to connected */
  const acceptCall = useCallback(() => {
    setCallPhase("connected");
    setCallState("active");
  }, []);

  const declineCall = useCallback(() => {
    setCallState("idle");
    setCallInfo(null);
  }, []);

  const endCall = useCallback(() => {
    setCallPhase("ended");
    /* Brief "Call Ended" pause before clearing overlay */
    setTimeout(() => {
      setCallState("idle");
      setCallInfo(null);
    }, 1200);
  }, []);

  return (
    <CallContext.Provider value={{
      callState, callPhase, callInfo,
      startOutgoing, connectCall,
      simulateIncoming, acceptCall, declineCall, endCall,
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
