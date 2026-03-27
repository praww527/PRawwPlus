/**
 * Call context — bridges the VoIP engine, tone service, and React UI.
 *
 * Features:
 *  - Full call lifecycle (idle → registering → registered → calling/ringing → in-call → on-hold)
 *  - Incoming call routing (foreground and via CallKeep)
 *  - Hold / Unhold
 *  - DTMF
 *  - Call waiting (second incoming call while in-call)
 *  - No-answer timeout handling
 *  - SIP cause → user-friendly error messages
 *  - Network state monitoring
 *  - Call record creation & close via API
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
import { Alert } from "react-native";
import type { RTCSession } from "jssip/lib/RTCSession";
import {
  voipEngine,
  type CallState,
  type CallInfo,
  type VoipCredentials,
  type WaitingCall,
} from "@/lib/voipEngine";
import { callKeepService } from "@/lib/callKeepService";
import { networkMonitor } from "@/lib/networkMonitor";
import { apiRequest } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CallContextValue {
  callState:            CallState;
  activeCall:           CallInfo | null;
  incomingSession:      RTCSession | null;
  incomingFrom:         string | null;
  incomingUuid:         string | null;
  waitingCall:          WaitingCall | null;
  isMuted:              boolean;
  isSpeakerOn:          boolean;
  isOnHold:             boolean;
  lastFailureReason:    string | null;
  networkState:         "online" | "offline" | "unknown";
  register:             () => Promise<void>;
  unregister:           () => Promise<void>;
  makeCall:             (destination: string) => Promise<void>;
  answerCall:           () => Promise<void>;
  declineCall:          () => void;
  hangup:               () => void;
  holdCall:             () => void;
  unholdCall:           () => void;
  sendDTMF:             (digit: string) => void;
  answerWaitingCall:    () => Promise<void>;
  dismissWaitingCall:   () => void;
  toggleMute:           () => void;
  toggleSpeaker:        () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function CallProvider({ children }: PropsWithChildren) {
  const [callState,         setCallState]         = useState<CallState>("idle");
  const [activeCall,        setActiveCall]        = useState<CallInfo | null>(null);
  const [incomingSession,   setIncomingSession]   = useState<RTCSession | null>(null);
  const [incomingFrom,      setIncomingFrom]      = useState<string | null>(null);
  const [incomingUuid,      setIncomingUuid]      = useState<string | null>(null);
  const [waitingCall,       setWaitingCall]       = useState<WaitingCall | null>(null);
  const [isMuted,           setIsMuted]           = useState(false);
  const [isSpeakerOn,       setIsSpeakerOn]       = useState(false);
  const [isOnHold,          setIsOnHold]          = useState(false);
  const [lastFailureReason, setLastFailureReason] = useState<string | null>(null);
  const [networkState,      setNetworkState]      = useState<"online" | "offline" | "unknown">("unknown");

  const credentialsRef    = useRef<VoipCredentials | null>(null);
  const activeCallIdRef   = useRef<string | null>(null);

  // ── Network monitor + auto re-register on recovery ──

  useEffect(() => {
    networkMonitor.start();

    const remove = networkMonitor.addListener((state) => {
      setNetworkState(state);

      // When network comes back online and we have saved credentials but the
      // engine is not registered (e.g. connection dropped), re-register.
      if (state === "online" && credentialsRef.current) {
        const engineState = voipEngine.getState();
        if (engineState === "idle" || engineState === "error") {
          voipEngine.register(credentialsRef.current).catch((err) => {
            console.error("[VoIP] Auto re-register on network recovery failed:", err);
          });
        }
      }
    });

    setNetworkState(networkMonitor.getState());
    return () => {
      remove();
      networkMonitor.stop();
    };
  }, []);

  // ── VoIP engine wiring ──

  useEffect(() => {
    const onState = (state: CallState) => {
      setCallState(state);
      if (state === "on-hold") {
        setIsOnHold(true);
      } else if (state === "in-call") {
        setIsOnHold(false);
      }
    };

    const onIncoming = (session: RTCSession, from: string, uuid: string) => {
      setIncomingSession(session);
      setIncomingFrom(from);
      setIncomingUuid(uuid);
      setLastFailureReason(null);
      callKeepService.displayIncomingCall(uuid, from, from);
      router.push("/incoming-call");
    };

    const onWaiting = (info: WaitingCall) => {
      setWaitingCall(info);
    };

    const onConnected = (info: CallInfo) => {
      setActiveCall(info);
      setIncomingSession(null);
      setIncomingFrom(null);
      setIncomingUuid(null);
      setWaitingCall(null);
      setIsMuted(false);
      setIsSpeakerOn(false);
      setIsOnHold(false);
      setLastFailureReason(null);
      activeCallIdRef.current = info.uuid;
      callKeepService.reportCallConnected(info.uuid);
      router.push("/active-call");
    };

    const onEnded = (_rawReason: string, friendlyMessage: string) => {
      const prevCall = activeCallIdRef.current;
      setActiveCall(null);
      setIncomingSession(null);
      setIncomingFrom(null);
      setIncomingUuid(null);
      setWaitingCall(null);
      setIsMuted(false);
      setIsSpeakerOn(false);
      setIsOnHold(false);
      activeCallIdRef.current = null;

      if (prevCall) callKeepService.endAllCalls();

      // Show reason only for non-trivial endings
      const silent = ["ended", "Canceled", "ORIGINATOR_CANCEL", "NORMAL_CLEARING"];
      if (friendlyMessage && !silent.some((s) => _rawReason?.includes(s))) {
        setLastFailureReason(friendlyMessage);
      }

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
    voipEngine.on("waitingCall",   onWaiting);
    voipEngine.on("callConnected", onConnected);
    voipEngine.on("callEnded",     onEnded);
    voipEngine.on("error",         onError);

    // CallKeep events → VoIP engine
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
      voipEngine.off("waitingCall",   onWaiting);
      voipEngine.off("callConnected", onConnected);
      voipEngine.off("callEnded",     onEnded);
      voipEngine.off("error",         onError);
      removeCallKeepListener();
    };
  }, []);

  // ── Register ──

  const register = useCallback(async () => {
    try {
      if (!networkMonitor.isOnline()) {
        throw new Error("No internet connection. Please check your network settings.");
      }
      const res    = await apiRequest("/verto/config");
      const config = await res.json();
      if (!res.ok) throw new Error(config.error ?? "Failed to fetch VoIP configuration");

      const domain = process.env.EXPO_PUBLIC_FREESWITCH_DOMAIN ?? config.domain ?? "";
      const creds: VoipCredentials = {
        extension: String(config.extension),
        password:  config.password,
        domain,
      };

      credentialsRef.current = creds;
      await voipEngine.register(creds);
    } catch (err: any) {
      console.error("[VoIP] Register error:", err);
      throw err;
    }
  }, []);

  const unregister = useCallback(async () => {
    await voipEngine.unregister();
    credentialsRef.current = null;
  }, []);

  // ── Make call ──

  const makeCall = useCallback(async (destination: string) => {
    if (!networkMonitor.isOnline()) {
      Alert.alert("No Connection", "You are not connected to the internet. Please check your network and try again.");
      return;
    }
    setLastFailureReason(null);
    try {
      // Record call in the API before placing it
      await apiRequest("/calls", {
        method: "POST",
        body: JSON.stringify({ recipientNumber: destination }),
      }).catch(() => {}); // Non-fatal if this fails

      await voipEngine.makeCall(destination);
    } catch (err: any) {
      const msg = err?.message ?? "Could not place the call";
      setLastFailureReason(msg);
      throw err;
    }
  }, []);

  // ── Answer / Decline ──

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

  // ── Hold / Unhold ──

  const holdCall = useCallback(() => {
    voipEngine.hold();
  }, []);

  const unholdCall = useCallback(() => {
    voipEngine.unhold();
  }, []);

  // ── DTMF ──

  const sendDTMF = useCallback((digit: string) => {
    voipEngine.sendDTMF(digit);
  }, []);

  // ── Call waiting ──

  const answerWaitingCall = useCallback(async () => {
    await voipEngine.answerWaitingCall();
    setWaitingCall(null);
  }, []);

  const dismissWaitingCall = useCallback(() => {
    voipEngine.dismissWaitingCall();
    setWaitingCall(null);
  }, []);

  // ── Mute / Speaker ──

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
    <CallContext.Provider
      value={{
        callState,
        activeCall,
        incomingSession,
        incomingFrom,
        incomingUuid,
        waitingCall,
        isMuted,
        isSpeakerOn,
        isOnHold,
        lastFailureReason,
        networkState,
        register,
        unregister,
        makeCall,
        answerCall,
        declineCall,
        hangup,
        holdCall,
        unholdCall,
        sendDTMF,
        answerWaitingCall,
        dismissWaitingCall,
        toggleMute,
        toggleSpeaker,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used inside CallProvider");
  return ctx;
}
