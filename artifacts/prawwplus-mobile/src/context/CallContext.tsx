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
 *  - Outbound call record creation & finalization via API (with persistent retry queue)
 *  - Inbound call record creation on answer (callee call history)
 *  - API connectivity status surfaced to the UI
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
import { Alert, AppState, type AppStateStatus } from "react-native";
import { v4 as uuidv4 } from "uuid";
import type { RTCSession } from "jssip/lib/RTCSession";
import {
  voipEngine,
  type CallState,
  type CallInfo,
  type VoipCredentials,
  type WaitingCall,
} from "@/services/voip/voipEngine";
import { callKeepService } from "@/services/voip/callKeepService";
import { networkMonitor } from "@/services/networkMonitor";
import { apiRequest } from "@/services/api";
import {
  enqueueEndCall,
  flushEndCallQueue,
  startCallEndQueueListeners,
} from "@/services/callEndQueue";
import { navigationRef, navigate, resetTo } from "@/navigation/navigationRef";

// ─── Types ────────────────────────────────────────────────────────────────────

/** "ok"          — last API call succeeded
 *  "unavailable" — server returned 5xx or connection refused
 *  "timeout"     — request exceeded the 10-second limit
 *  "unknown"     — no API call has been made yet
 */
export type ApiStatus = "ok" | "unavailable" | "timeout" | "unknown";

interface CallContextValue {
  callState:            CallState;
  activeCall:           CallInfo | null;
  incomingSession:      RTCSession | null;
  incomingFrom:         string | null;
  incomingUuid:         string | null;
  waitingCall:          WaitingCall | null;
  missedBadgeCount:     number;
  isMuted:              boolean;
  isSpeakerOn:          boolean;
  isOnHold:             boolean;
  lastFailureReason:    string | null;
  networkState:         "online" | "offline" | "unknown";
  apiStatus:            ApiStatus;
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
  clearMissedBadges:    () => void;
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
  const [missedBadgeCount,  setMissedBadgeCount]  = useState(0);
  const [isMuted,           setIsMuted]           = useState(false);
  const [isSpeakerOn,       setIsSpeakerOn]       = useState(false);
  const [isOnHold,          setIsOnHold]          = useState(false);
  const [lastFailureReason, setLastFailureReason] = useState<string | null>(null);
  const [networkState,      setNetworkState]      = useState<"online" | "offline" | "unknown">("unknown");
  const [apiStatus,         setApiStatus]         = useState<ApiStatus>("unknown");

  const credentialsRef     = useRef<VoipCredentials | null>(null);
  const activeCallIdRef    = useRef<string | null>(null);
  const dbCallIdRef        = useRef<string | null>(null);
  const callConnectedAtRef = useRef<number | null>(null);
  // Track the direction of the current call so onConnected knows whether to
  // create an inbound DB record or use the already-created outbound one.
  const pendingDirectionRef = useRef<"inbound" | "outbound" | null>(null);
  // Capture incomingFrom at call-answer time for the inbound DB record
  const incomingFromRef    = useRef<string | null>(null);
  const registerInFlightRef = useRef<Promise<void> | null>(null);

  // ── Persistent end-call retry queue ──────────────────────────────────────

  useEffect(() => {
    const cleanup = startCallEndQueueListeners();
    // Flush any requests that were queued during the previous session
    flushEndCallQueue().catch((err) => {
      console.warn("[CallContext] flushEndCallQueue on mount failed:", err);
    });
    return cleanup;
  }, []);

  // ── App foreground re-register (iOS/Android) ─────────────────────────────

  useEffect(() => {
    const onAppState = (nextState: AppStateStatus) => {
      if (nextState !== "active") return;
      const creds = credentialsRef.current;
      if (!creds) return;

      const engineState = voipEngine.getState();
      if (engineState !== "idle" && engineState !== "error") return;
      if (!networkMonitor.isOnline()) return;

      if (registerInFlightRef.current) return;
      registerInFlightRef.current = voipEngine.register(creds)
        .catch((err) => {
          console.error("[VoIP] Re-register on app foreground failed:", err);
        })
        .finally(() => {
          registerInFlightRef.current = null;
        });
    };

    const sub = AppState.addEventListener("change", onAppState);
    return () => {
      sub.remove();
    };
  }, []);

  // ── Network monitor + auto re-register on recovery ────────────────────────

  useEffect(() => {
    networkMonitor.start();

    const remove = networkMonitor.addListener((state) => {
      setNetworkState(state);

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

  // ── Helper: finalize a call record via the API (with queue fallback) ──────

  const finalizeCallRecord = useCallback(
    async (dbCallId: string, durationSecs: number, status: string) => {
      try {
        const res = await apiRequest(`/calls/${dbCallId}/end`, {
          method: "POST",
          body: JSON.stringify({ duration: durationSecs, status }),
        });

        if (res.ok) {
          setApiStatus("ok");
          return;
        }

        // Server-side error — queue for retry
        setApiStatus("unavailable");
      } catch (err: any) {
        if (err?.name === "TimeoutError") {
          setApiStatus("timeout");
        } else {
          setApiStatus("unavailable");
        }
      }

      // Network or server error — persist and retry later
      await enqueueEndCall(dbCallId, durationSecs, status);
    },
    [],
  );

  // ── Helper: create a call DB record ───────────────────────────────────────

  const createCallRecord = useCallback(
    async (
      recipientNumber: string,
      direction: "inbound" | "outbound",
      fsCallId?: string,
    ): Promise<string | null> => {
      try {
        const res = await apiRequest("/calls", {
          method: "POST",
          body: JSON.stringify({
            recipientNumber,
            direction,
            ...(fsCallId ? { fsCallId } : {}),
          }),
        });

        if (res.ok) {
          setApiStatus("ok");
          try {
            const record = await res.json();
            return record?.id ?? null;
          } catch {
            setApiStatus("unavailable");
            return null;
          }
        }

        setApiStatus("unavailable");
        return null;
      } catch (err: any) {
        if (err?.name === "TimeoutError") {
          setApiStatus("timeout");
        } else {
          setApiStatus("unavailable");
        }
        return null;
      }
    },
    [],
  );

  // ── VoIP engine wiring ────────────────────────────────────────────────────

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
      incomingFromRef.current = from;
      pendingDirectionRef.current = "inbound";
      setLastFailureReason(null);
      callKeepService.displayIncomingCall(uuid, from, from);
      navigate("IncomingCall");
    };

    const onWaiting = (info: WaitingCall) => {
      setWaitingCall(info);
    };

    const onWaitingCallEnded = () => {
      setWaitingCall(null);
    };

    const onConnected = async (info: CallInfo) => {
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
      callConnectedAtRef.current = Date.now();
      callKeepService.reportCallConnected(info.uuid);
      navigate("ActiveCall");

      // For inbound calls: create the DB record now that the call is answered.
      // Outbound calls already have a record created in makeCall().
      if (info.direction === "inbound" && !dbCallIdRef.current) {
        const callerNumber = incomingFromRef.current ?? info.remoteNumber;
        const callId = await createCallRecord(callerNumber, "inbound");
        // Store even if null — onEnded guards against null dbCallId
        dbCallIdRef.current = callId;
      }
    };

    const onEnded = async (_rawReason: string, friendlyMessage: string) => {
      const prevCall    = activeCallIdRef.current;
      const dbCallId    = dbCallIdRef.current;
      const connectedAt = callConnectedAtRef.current;
      const endedDirection = activeCall?.direction ?? pendingDirectionRef.current;

      setActiveCall(null);
      setIncomingSession(null);
      setIncomingFrom(null);
      setIncomingUuid(null);
      setWaitingCall(null);
      setIsMuted(false);
      setIsSpeakerOn(false);
      setIsOnHold(false);
      activeCallIdRef.current    = null;
      dbCallIdRef.current        = null;
      callConnectedAtRef.current = null;
      pendingDirectionRef.current = null;
      incomingFromRef.current    = null;

      if (prevCall) callKeepService.endAllCalls();

      // Determine final status from the SIP reason string
      const durationSecs = connectedAt
        ? Math.floor((Date.now() - connectedAt) / 1000)
        : 0;

      let finalStatus = "completed";
      const silentReasons = ["ended", "Canceled", "ORIGINATOR_CANCEL", "NORMAL_CLEARING"];
      if (!silentReasons.some((s) => _rawReason?.includes(s))) {
        if (_rawReason?.includes("NO_ANSWER") || _rawReason?.includes("RECOVERY_ON_TIMER_EXPIRE")) {
          finalStatus = "missed";
        } else if (_rawReason?.includes("USER_BUSY") || _rawReason?.includes("CALL_REJECTED")) {
          finalStatus = "cancelled";
        } else if (_rawReason && _rawReason !== "ended") {
          finalStatus = durationSecs > 0 ? "completed" : "failed";
        }
      }

      if (finalStatus === "missed" && endedDirection === "inbound") {
        setMissedBadgeCount((c) => c + 1);
      }

      // Finalize the call record (with retry queue fallback)
      if (dbCallId) {
        await finalizeCallRecord(dbCallId, durationSecs, finalStatus);
      }

      // Show reason only for non-trivial endings
      if (friendlyMessage && !silentReasons.some((s) => _rawReason?.includes(s))) {
        setLastFailureReason(friendlyMessage);
      }

      resetTo("MainTabs");
    };

    const onError = (message: string) => {
      console.error("[VoIP] Error:", message);
    };

    voipEngine.on("stateChange",      onState);
    voipEngine.on("incomingCall",     onIncoming);
    voipEngine.on("waitingCall",      onWaiting);
    voipEngine.on("waitingCallEnded", onWaitingCallEnded);
    voipEngine.on("callConnected",    onConnected);
    voipEngine.on("callEnded",        onEnded);
    voipEngine.on("error",            onError);

    const removeCallKeepListener = callKeepService.addListener((event) => {
      if (event.type === "answerCall") {
        voipEngine.answerIncomingCall().catch(console.error);
      } else if (event.type === "endCall") {
        voipEngine.rejectIncomingCall();
        voipEngine.hangup();
      }
    });

    return () => {
      voipEngine.off("stateChange",      onState);
      voipEngine.off("incomingCall",     onIncoming);
      voipEngine.off("waitingCall",      onWaiting);
      voipEngine.off("waitingCallEnded", onWaitingCallEnded);
      voipEngine.off("callConnected",    onConnected);
      voipEngine.off("callEnded",        onEnded);
      voipEngine.off("error",            onError);
      removeCallKeepListener();
    };
  }, [createCallRecord, finalizeCallRecord]);

  // ── Register ──────────────────────────────────────────────────────────────

  const register = useCallback(async () => {
    try {
      if (!networkMonitor.isOnline()) {
        throw new Error("No internet connection. Please check your network settings.");
      }

      const res = await apiRequest("/verto/config");
      if (!res.ok) {
        setApiStatus("unavailable");
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? "Failed to fetch VoIP configuration");
      }

      setApiStatus("ok");
      const config = await res.json();
      const domain = process.env.EXPO_PUBLIC_FREESWITCH_DOMAIN ?? config.domain ?? "";
      const iceServers = Array.isArray(config.iceServers) ? config.iceServers : undefined;
      const sipWsUrl = typeof config.sipWsUrl === "string" ? config.sipWsUrl : undefined;
      const creds: VoipCredentials = {
        extension: String(config.extension),
        password:  config.password,
        domain,
        iceServers,
        sipWsUrl,
      };

      credentialsRef.current = creds;
      await voipEngine.register(creds);

      // Flush any queued end-call requests now that we have an auth session
      flushEndCallQueue().catch((e) => {
        console.warn("[CallContext] flushEndCallQueue after register failed:", e);
      });
    } catch (err: any) {
      if (err?.name === "TimeoutError") {
        setApiStatus("timeout");
      } else if (!err?.message?.includes("internet connection")) {
        setApiStatus("unavailable");
      }
      console.error("[VoIP] Register error:", err);
      throw err;
    }
  }, []);

  const unregister = useCallback(async () => {
    await voipEngine.unregister();
    credentialsRef.current = null;
  }, []);

  // ── Make call ─────────────────────────────────────────────────────────────

  const makeCall = useCallback(async (destination: string) => {
    if (!networkMonitor.isOnline()) {
      Alert.alert("No Connection", "You are not connected to the internet. Please check your network and try again.");
      return;
    }
    setLastFailureReason(null);
    dbCallIdRef.current         = null;
    callConnectedAtRef.current  = null;
    pendingDirectionRef.current = "outbound";

    try {
      // Align with web Verto: one UUID for CallKit, POST /calls fsCallId, and (when FS is configured) ESL.
      const fsCallId = uuidv4();
      const callId   = await createCallRecord(destination, "outbound", fsCallId);
      dbCallIdRef.current = callId;

      await voipEngine.makeCall(destination, fsCallId, callId);
    } catch (err: any) {
      // SIP precondition failure (not registered, etc.) — finalize immediately
      if (dbCallIdRef.current) {
        await finalizeCallRecord(dbCallIdRef.current, 0, "failed");
        dbCallIdRef.current = null;
      }
      const msg = err?.message ?? "Could not place the call";
      setLastFailureReason(msg);
      throw err;
    }
  }, [createCallRecord, finalizeCallRecord]);

  // ── Answer / Decline ──────────────────────────────────────────────────────

  const answerCall = useCallback(async () => {
    pendingDirectionRef.current = "inbound";
    await voipEngine.answerIncomingCall();
  }, []);

  const declineCall = useCallback(() => {
    voipEngine.rejectIncomingCall();
    if (incomingUuid) callKeepService.endCall(incomingUuid);
    setIncomingSession(null);
    setIncomingFrom(null);
    setIncomingUuid(null);
    incomingFromRef.current = null;
    if (navigationRef.isReady() && navigationRef.canGoBack()) {
      navigationRef.goBack();
    }
  }, [incomingUuid]);

  const hangup = useCallback(() => {
    voipEngine.hangup();
    if (activeCall?.uuid) callKeepService.endCall(activeCall.uuid);
  }, [activeCall]);

  // ── Hold / Unhold ─────────────────────────────────────────────────────────

  const holdCall   = useCallback(() => { voipEngine.hold();   }, []);
  const unholdCall = useCallback(() => { voipEngine.unhold(); }, []);

  // ── DTMF ──────────────────────────────────────────────────────────────────

  const sendDTMF = useCallback((digit: string) => {
    voipEngine.sendDTMF(digit);
  }, []);

  // ── Call waiting ──────────────────────────────────────────────────────────

  const answerWaitingCall = useCallback(async () => {
    await voipEngine.answerWaitingCall();
    setWaitingCall(null);
  }, []);

  const dismissWaitingCall = useCallback(() => {
    voipEngine.dismissWaitingCall();
    setWaitingCall(null);
  }, []);

  const clearMissedBadges = useCallback(() => {
    setMissedBadgeCount(0);
  }, []);

  // ── Mute / Speaker ────────────────────────────────────────────────────────

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
        missedBadgeCount,
        isMuted,
        isSpeakerOn,
        isOnHold,
        lastFailureReason,
        networkState,
        apiStatus,
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
        clearMissedBadges,
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
