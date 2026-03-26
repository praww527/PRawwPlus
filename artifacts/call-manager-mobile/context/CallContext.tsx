/**
 * Call context — manages VoIP call state and exposes it to the UI.
 *
 * Wires together:
 *  - voipEngine (JsSIP + WebRTC)
 *  - callKeepService (native call UI)
 *  - React navigation (navigate to/from call screens)
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type PropsWithChildren,
} from "react";
import { router } from "expo-router";
import { type RTCSession } from "jssip";
import { voipEngine, type CallState, type CallInfo, type VoipCredentials } from "@/lib/voipEngine";
import { callKeepService } from "@/lib/callKeepService";
import { apiRequest } from "@/lib/api";

interface CallContextValue {
  callState:       CallState;
  activeCall:      CallInfo | null;
  incomingSession: RTCSession | null;
  incomingFrom:    string | null;
  incomingUuid:    string | null;
  isMuted:         boolean;
  isSpeakerOn:     boolean;
  register:        () => Promise<void>;
  unregister:      () => Promise<void>;
  makeCall:        (destination: string) => Promise<void>;
  answerCall:      () => Promise<void>;
  declineCall:     () => void;
  hangup:          () => void;
  toggleMute:      () => void;
  toggleSpeaker:   () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: PropsWithChildren) {
  const [callState,       setCallState]       = useState<CallState>("idle");
  const [activeCall,      setActiveCall]      = useState<CallInfo | null>(null);
  const [incomingSession, setIncomingSession] = useState<RTCSession | null>(null);
  const [incomingFrom,    setIncomingFrom]    = useState<string | null>(null);
  const [incomingUuid,    setIncomingUuid]    = useState<string | null>(null);
  const [isMuted,         setIsMuted]         = useState(false);
  const [isSpeakerOn,     setIsSpeakerOn]     = useState(false);
  const credentialsRef = useRef<VoipCredentials | null>(null);

  useEffect(() => {
    // Wire voipEngine events
    const onState = (state: CallState) => setCallState(state);

    const onIncoming = (session: RTCSession, from: string, uuid: string) => {
      setIncomingSession(session);
      setIncomingFrom(from);
      setIncomingUuid(uuid);
      // Navigate to the incoming call screen
      router.push("/incoming-call");
    };

    const onConnected = (info: CallInfo) => {
      setActiveCall(info);
      setIncomingSession(null);
      router.push("/active-call");
    };

    const onEnded = (_reason: string) => {
      setActiveCall(null);
      setIncomingSession(null);
      setIncomingFrom(null);
      setIncomingUuid(null);
      setIsMuted(false);
      setIsSpeakerOn(false);
      callKeepService.endAllCalls();
      // Navigate back to main tabs
      if (router.canGoBack()) {
        router.dismissAll();
      } else {
        router.replace("/(tabs)");
      }
    };

    const onError = (message: string) => {
      console.error("[VoIP] Error:", message);
    };

    voipEngine.on("stateChange",   onState);
    voipEngine.on("incomingCall",  onIncoming);
    voipEngine.on("callConnected", onConnected);
    voipEngine.on("callEnded",     onEnded);
    voipEngine.on("error",         onError);

    // Wire CallKeep events to VoIP engine
    const removeCallKeepListener = callKeepService.addListener((event) => {
      if (event.type === "answerCall") {
        voipEngine.answerIncomingCall().catch(console.error);
      } else if (event.type === "endCall") {
        voipEngine.rejectIncomingCall();
        voipEngine.hangup();
      }
    });

    return () => {
      voipEngine.off("stateChange",   onState);
      voipEngine.off("incomingCall",  onIncoming);
      voipEngine.off("callConnected", onConnected);
      voipEngine.off("callEnded",     onEnded);
      voipEngine.off("error",         onError);
      removeCallKeepListener();
    };
  }, []);

  const register = useCallback(async () => {
    try {
      const res = await apiRequest("/verto/config");
      const config = await res.json();
      if (!res.ok) throw new Error(config.error ?? "Failed to fetch VoIP config");

      const domain = process.env.EXPO_PUBLIC_FREESWITCH_DOMAIN ?? config.domain ?? "";
      const creds: VoipCredentials = {
        extension: String(config.extension),
        password:  config.password,
        domain,
      };

      credentialsRef.current = creds;
      await voipEngine.register(creds);
    } catch (err) {
      console.error("[VoIP] Register error:", err);
      throw err;
    }
  }, []);

  const unregister = useCallback(async () => {
    await voipEngine.unregister();
    credentialsRef.current = null;
  }, []);

  const makeCall = useCallback(async (destination: string) => {
    await voipEngine.makeCall(destination);
  }, []);

  const answerCall = useCallback(async () => {
    await voipEngine.answerIncomingCall();
  }, []);

  const declineCall = useCallback(() => {
    voipEngine.rejectIncomingCall();
    if (incomingUuid) callKeepService.endCall(incomingUuid);
    setIncomingSession(null);
    setIncomingFrom(null);
    setIncomingUuid(null);
    if (router.canGoBack()) router.back();
  }, [incomingUuid]);

  const hangup = useCallback(() => {
    voipEngine.hangup();
    if (activeCall?.uuid) callKeepService.endCall(activeCall.uuid);
  }, [activeCall]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    voipEngine.muteMicrophone(next);
    setIsMuted(next);
  }, [isMuted]);

  const toggleSpeaker = useCallback(() => {
    const next = !isSpeakerOn;
    voipEngine.setSpeakerEnabled(next);
    setIsSpeakerOn(next);
  }, [isSpeakerOn]);

  return (
    <CallContext.Provider value={{
      callState,
      activeCall,
      incomingSession,
      incomingFrom,
      incomingUuid,
      isMuted,
      isSpeakerOn,
      register,
      unregister,
      makeCall,
      answerCall,
      declineCall,
      hangup,
      toggleMute,
      toggleSpeaker,
    }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used inside CallProvider");
  return ctx;
}
