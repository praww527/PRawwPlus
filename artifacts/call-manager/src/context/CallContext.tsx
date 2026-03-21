import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type CallState = "idle" | "outgoing" | "incoming";

export interface CallInfo {
  number: string;
  name?: string;
}

interface CallContextValue {
  callState: CallState;
  callInfo: CallInfo | null;
  startOutgoing: (info: CallInfo) => void;
  simulateIncoming: (info: CallInfo) => void;
  acceptCall: () => void;
  declineCall: () => void;
  endCall: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [callInfo, setCallInfo] = useState<CallInfo | null>(null);

  const startOutgoing = useCallback((info: CallInfo) => {
    setCallInfo(info);
    setCallState("outgoing");
  }, []);

  const simulateIncoming = useCallback((info: CallInfo) => {
    setCallInfo(info);
    setCallState("incoming");
  }, []);

  const acceptCall = useCallback(() => setCallState("outgoing"), []);

  const declineCall = useCallback(() => {
    setCallState("idle");
    setCallInfo(null);
  }, []);

  const endCall = useCallback(() => {
    setCallState("idle");
    setCallInfo(null);
  }, []);

  return (
    <CallContext.Provider value={{ callState, callInfo, startOutgoing, simulateIncoming, acceptCall, declineCall, endCall }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}
