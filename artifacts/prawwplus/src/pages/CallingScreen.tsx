import { useState, useEffect, useRef, useCallback } from "react";
import { PhoneOff, Mic, MicOff, Keyboard, Volume2, VolumeX, X, PhoneMissed, PhoneCall, WifiOff, Voicemail, Users, PauseCircle, PlayCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCall } from "@/context/CallContext";
import { useEndCall, getGetMeQueryKey, type EndCallRequestStatus } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { phoneAudio } from "@/lib/phoneAudio";
import { apiFetch } from "@/lib/apiFetch";

const DTMF_KEYS = [
  { key: "1", sub: "" },
  { key: "2", sub: "ABC" },
  { key: "3", sub: "DEF" },
  { key: "4", sub: "GHI" },
  { key: "5", sub: "JKL" },
  { key: "6", sub: "MNO" },
  { key: "7", sub: "PQRS" },
  { key: "8", sub: "TUV" },
  { key: "9", sub: "WXYZ" },
  { key: "*",  sub: "" },
  { key: "0",  sub: "+" },
  { key: "#",  sub: "" },
];

function formatDuration(secs: number) {
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function avatarInitials(info: { number: string; name?: string } | null) {
  if (!info) return "?";
  if (info.name) {
    const parts = info.name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  const digits = info.number.replace(/\D/g, "");
  return digits ? digits.slice(-2) : "?";
}

export default function CallingScreen() {
  const { callInfo, callPhase, hangupInfo, endCall, setMuted, setSpeaker, holdCall, resumeCall, sendDtmf } = useCall();
  const { mutateAsync: signalEndCall } = useEndCall();
  const queryClient = useQueryClient();

  const [elapsed, setElapsed] = useState(0);
  const [muted, setMutedState] = useState(false);
  const [speaker, setSpeakerState] = useState(true);
  const [onHold, setOnHold] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [dtmfBuffer, setDtmfBuffer] = useState("");

  const [showConference, setShowConference] = useState(false);
  const [confExtInput, setConfExtInput] = useState("");
  const [confRoomId, setConfRoomId] = useState<string | null>(null);
  const [confStatus, setConfStatus] = useState<string | null>(null);
  const [confBusy, setConfBusy] = useState(false);

  // Reset per-call UI state whenever a brand-new call starts (callPhase → "calling").
  // Without this, onHold/muted/DTMF state from a previous call persists into the next
  // one — e.g. the UI shows "Held" at the start of a fresh outbound call.
  const prevCallIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (callPhase === "calling" && callInfo?.callId !== prevCallIdRef.current) {
      prevCallIdRef.current = callInfo?.callId;
      setMutedState(false);
      setOnHold(false);
      setDtmfBuffer("");
      setShowKeypad(false);
      setShowConference(false);
      setConfRoomId(null);
      setConfStatus(null);
      setConfExtInput("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callPhase, callInfo?.callId]);

  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const elapsedRef   = useRef<number>(0);
  const signalledRef = useRef<boolean>(false);

  useEffect(() => {
    if (callPhase === "calling") {
      // Connecting — play a soft dial/setup pulse while the call is being established
      phoneAudio.startDialTone();
    } else if (callPhase === "ringing") {
      // Remote side is ringing — play SA ringback tone
      phoneAudio.startRingback();
    } else if (callPhase === "connected") {
      phoneAudio.stopAll();
      phoneAudio.playConnected();
    } else if (callPhase === "ended") {
      phoneAudio.stopAll();
      const icon = hangupInfo?.icon;
      if (icon === "busy") {
        // Dual-tone busy signal — remote side is engaged
        phoneAudio.playBusy();
      } else if (icon === "unavailable") {
        // SIT (Special Information Tone) — number not in service / not reachable
        phoneAudio.playSIT();
      } else if (icon === "error") {
        // Reorder / fast-busy — network or routing failure
        phoneAudio.playCongestion();
      } else if (icon === "no-answer") {
        // Soft descending ding — call was not answered, no fault
        phoneAudio.playNoAnswer();
      } else {
        // Normal end or voicemail — gentle two-note drop
        phoneAudio.playEnded();
      }
    }
    return () => {
      if (callPhase === "calling" || callPhase === "ringing") {
        phoneAudio.stopAll();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callPhase]);

  useEffect(() => {
    return () => { phoneAudio.stopAll(); };
  }, []);

  useEffect(() => {
    if (callPhase === "connected") {
      startTimeRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        setElapsed((e) => {
          const next = e + 1;
          elapsedRef.current = next;
          return next;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (callPhase === "calling") {
        setElapsed(0);
        elapsedRef.current = 0;
        // Reset so the next call's end is properly reported to the API
        signalledRef.current = false;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [callPhase]);

  useEffect(() => {
    if (callPhase !== "ended") return;
    if (signalledRef.current) return;
    if (!callInfo?.callId) return;

    signalledRef.current = true;
    const duration = elapsedRef.current;

    signalEndCall({
      callId: callInfo.callId,
      data: { duration, status: causeToEndStatus(hangupInfo?.cause) },
    })
      .catch(() => {})
      .finally(() => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callPhase]);

  const handleEndCall = useCallback(async () => {
    const durationSecs = callPhase === "connected"
      ? Math.floor((Date.now() - startTimeRef.current) / 1000)
      : elapsedRef.current;

    if (!signalledRef.current) {
      signalledRef.current = true;
      if (callInfo?.callId) {
        const endStatus: EndCallRequestStatus = callPhase === "connected" ? "completed" : "no-answer";
        try {
          await signalEndCall({
            callId: callInfo.callId,
            data: { duration: durationSecs, status: endStatus },
          });
        } catch {
          // best-effort
        } finally {
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        }
      }
    }

    endCall(durationSecs);
  }, [callInfo, callPhase, endCall, queryClient, signalEndCall]);

  const handleMute = () => {
    const next = !muted;
    setMutedState(next);
    setMuted(next);
  };

  const handleSpeaker = () => {
    const next = !speaker;
    setSpeakerState(next);
    setSpeaker(next);
  };

  const handleHold = () => {
    if (callPhase !== "connected") return;
    const next = !onHold;
    setOnHold(next);
    if (next) {
      holdCall();
    } else {
      resumeCall();
    }
  };

  const handleDtmf = (digit: string) => {
    phoneAudio.playDtmf(digit);
    sendDtmf(digit);
    setDtmfBuffer((b) => (b + digit).slice(-12));
  };

  const handleStartConference = useCallback(async () => {
    if (confBusy) return;
    const ext = confExtInput.trim();
    if (!/^\d{4}$/.test(ext) && !/^\+?\d{7,15}$/.test(ext)) {
      setConfStatus("Enter a 4-digit extension or full phone number");
      return;
    }
    setConfBusy(true);
    setConfStatus("Setting up conference…");
    try {
      let roomId = confRoomId;
      if (!roomId) {
        const createRes = await apiFetch("/api/conference", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ callId: callInfo?.callId }),
          credentials: "include",
        });
        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({})) as any;
          setConfStatus(err?.error ?? "Failed to create conference room");
          return;
        }
        const created = await createRes.json() as { roomId: string; transferred: boolean };
        roomId = created.roomId;
        setConfRoomId(roomId);
        if (!created.transferred) {
          setConfStatus("Conference created — transfer via FreeSWITCH not available. Inviting participant…");
        }
      }

      const isInternal = /^\d{4}$/.test(ext);
      const inviteRes = await apiFetch(`/api/conference/${roomId}/invite`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(isInternal ? { extension: Number(ext) } : { phone: ext }),
        credentials: "include",
      });
      if (!inviteRes.ok) {
        const err = await inviteRes.json().catch(() => ({})) as any;
        setConfStatus(err?.error ?? "Failed to invite participant");
        return;
      }
      setConfStatus(`Calling ${ext}…`);
      setConfExtInput("");
    } catch {
      setConfStatus("Network error — please try again");
    } finally {
      setConfBusy(false);
    }
  }, [confBusy, confExtInput, confRoomId, callInfo?.callId]);

  const handleEndConference = useCallback(async () => {
    if (!confRoomId) return;
    await apiFetch(`/api/conference/${confRoomId}`, {
      method: "DELETE",
      credentials: "include",
    }).catch(() => {});
    setConfRoomId(null);
    setConfStatus(null);
    setShowConference(false);
  }, [confRoomId]);

  /** Map a FreeSWITCH hangup cause to the status enum the REST API accepts */
  function causeToEndStatus(cause: string | undefined): EndCallRequestStatus {
    switch (cause) {
      case "USER_BUSY":
        return "busy";
      case "NO_ANSWER":
      case "RECOVERY_ON_TIMER_EXPIRE":
      case "RECOVERY_ON_TIMER_EXPIRY":
        return "no-answer";
      case "NORMAL_CLEARING":
      case "ALLOTTED_TIMEOUT":
      case "ATTENDED_TRANSFER":
        return "completed";
      case "ORIGINATOR_CANCEL":
      case "CALL_REJECTED":
      case "UNREGISTERED":
      case "USER_NOT_REGISTERED":
      case "SUBSCRIBER_ABSENT":
      case "DESTINATION_OUT_OF_ORDER":
      case "NO_ROUTE_DESTINATION":
      case "UNALLOCATED_NUMBER":
      case "INCOMPATIBLE_DESTINATION":
      case "MANDATORY_IE_MISSING":
      case "SERVICE_UNAVAILABLE":
      case "NETWORK_OUT_OF_ORDER":
      case "CHAN_NOT_IMPLEMENTED":
      case "FACILITY_NOT_IMPLEMENTED":
        return "failed";
      default:
        return "failed";
    }
  }

  const endedMessage = hangupInfo?.message ?? "Call Ended";

  const statusLabel =
    callPhase === "calling" ? "Calling…" :
    callPhase === "ringing" ? "Ringing…" :
    callPhase === "ended"   ? endedMessage :
    null;

  const HangupIcon =
    hangupInfo?.icon === "busy"        ? PhoneCall :
    hangupInfo?.icon === "no-answer"   ? PhoneMissed :
    hangupInfo?.icon === "unavailable" ? WifiOff :
    hangupInfo?.icon === "voicemail"   ? Voicemail :
    PhoneOff;

  const hangupColor =
    hangupInfo?.icon === "busy"        ? "#ff9f0a" :
    hangupInfo?.icon === "no-answer"   ? "#ff9f0a" :
    hangupInfo?.icon === "unavailable" ? "#ff453a" :
    hangupInfo?.icon === "voicemail"   ? "#636366" :
    "#ff3b30";

  const isInternal = callInfo?.callType === "internal";

  const controls = [
    {
      icon: muted ? MicOff : Mic,
      label: "Mute",
      active: muted,
      onPress: handleMute,
    },
    {
      icon: Keyboard,
      label: "Keypad",
      active: showKeypad,
      onPress: () => { setShowKeypad((v) => !v); setShowConference(false); },
    },
    {
      icon: speaker ? Volume2 : VolumeX,
      label: "Speaker",
      active: speaker,
      onPress: handleSpeaker,
    },
    {
      icon: onHold ? PlayCircle : PauseCircle,
      label: onHold ? "Resume" : "Hold",
      active: onHold,
      onPress: handleHold,
    },
    {
      icon: Users,
      label: confRoomId ? "Conference" : "Add",
      active: showConference,
      onPress: () => { setShowConference((v) => !v); setShowKeypad(false); },
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center animate-in fade-in duration-300"
      style={{
        background: "linear-gradient(160deg,#0d1117 0%,#091628 55%,#050f20 100%)",
        paddingTop:    "env(safe-area-inset-top,44px)",
        paddingBottom: "env(safe-area-inset-bottom,34px)",
      }}
    >
      <div className="flex flex-col items-center mt-14 mb-6">
        {statusLabel && (
          <p className={cn(
            "text-sm tracking-widest uppercase font-medium mb-3 transition-all",
            callPhase === "ended" ? "text-white/35" : "text-white/45"
          )}>
            {statusLabel}
          </p>
        )}

        <p className="text-white text-[32px] font-bold leading-tight">
          {callInfo?.name ?? (callInfo?.number || "PRaww+ User")}
        </p>

        {callInfo?.name && callInfo?.number ? (
          <p className="text-white/40 text-sm font-mono mt-1">{callInfo.number}</p>
        ) : null}

        {isInternal && (
          <span style={{
            marginTop: 6,
            fontSize: 11,
            fontWeight: 600,
            color: "#30d158",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}>
            Internal · Free
          </span>
        )}

        <p className={cn(
          "text-sm tabular-nums mt-2 transition-colors",
          callPhase === "connected" ? "text-white/70" : "text-white/30"
        )}>
          {formatDuration(elapsed)}
        </p>
      </div>

      {/* Conference panel */}
      {showConference && callPhase === "connected" && (
        <div
          style={{
            width: "100%", maxWidth: 340, margin: "0 auto 12px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 18, padding: "20px 24px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <span style={{ color: "white", fontWeight: 700, fontSize: 16 }}>
              {confRoomId ? `Conference — ${confRoomId}` : "Add Participant"}
            </span>
            {confRoomId && (
              <button
                onClick={handleEndConference}
                style={{
                  background: "#ff3b30", border: "none", borderRadius: 10,
                  color: "white", fontSize: 11, fontWeight: 700, padding: "4px 10px",
                  cursor: "pointer",
                }}
              >
                End
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              type="text"
              placeholder="Ext 1002 or +27821234567"
              value={confExtInput}
              onChange={(e) => setConfExtInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleStartConference()}
              style={{
                flex: 1, background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 10, padding: "10px 14px",
                color: "white", fontSize: 15, outline: "none",
              }}
            />
            <button
              onClick={handleStartConference}
              disabled={confBusy}
              style={{
                background: confBusy ? "rgba(10,132,255,0.4)" : "#0a84ff",
                border: "none", borderRadius: 10, padding: "10px 18px",
                color: "white", fontWeight: 700, fontSize: 14, cursor: "pointer",
                opacity: confBusy ? 0.7 : 1,
              }}
            >
              {confBusy ? "…" : "Invite"}
            </button>
          </div>

          {confStatus && (
            <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, margin: 0 }}>
              {confStatus}
            </p>
          )}
        </div>
      )}

      {/* DTMF Keypad overlay */}
      {showKeypad && callPhase === "connected" ? (
        <div className="flex-1 flex flex-col items-center justify-center w-full px-8">
          {/* DTMF display */}
          <div style={{
            height: 36, marginBottom: 16,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{
              fontSize: 24, fontWeight: 700, color: "rgba(255,255,255,0.85)",
              fontFamily: "monospace", letterSpacing: "0.12em",
              minWidth: 20,
            }}>
              {dtmfBuffer || ""}
            </span>
          </div>

          {/* 3×4 grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 72px)",
            gap: 12,
            justifyContent: "center",
          }}>
            {DTMF_KEYS.map(({ key, sub }) => (
              <button
                key={key}
                onClick={() => handleDtmf(key)}
                style={{
                  width: 72, height: 72, borderRadius: "50%",
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                  WebkitTapHighlightColor: "transparent",
                  gap: 0,
                  transition: "all 0.1s ease",
                }}
                onPointerDown={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.22)";
                  e.currentTarget.style.transform = "scale(0.93)";
                }}
                onPointerUp={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.10)";
                  e.currentTarget.style.transform = "scale(1)";
                }}
                onPointerLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.10)";
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                <span style={{ fontSize: 22, fontWeight: 600, color: "white", lineHeight: 1.1 }}>{key}</span>
                {sub && <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em", marginTop: 1 }}>{sub}</span>}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowKeypad(false)}
            style={{
              marginTop: 20, display: "flex", alignItems: "center", gap: 6,
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 20, padding: "8px 20px", cursor: "pointer",
              color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: 600,
            }}
          >
            <X className="w-3.5 h-3.5" />
            Hide keypad
          </button>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="relative flex items-center justify-center">
            {(callPhase === "calling" || callPhase === "ringing") && (
              <div
                className="absolute rounded-full animate-ping opacity-15"
                style={{ width: 170, height: 170, background: "#34c759" }}
              />
            )}
            {callPhase === "ended" && hangupInfo && (
              <div
                className="absolute rounded-full opacity-10"
                style={{ width: 200, height: 200, background: hangupColor, filter: "blur(20px)" }}
              />
            )}
            {callPhase !== "ended" && (
              <div
                className="absolute rounded-full opacity-10"
                style={{ width: 200, height: 200, background: "#34c759", filter: "blur(20px)" }}
              />
            )}

            {callPhase === "ended" ? (
              <div
                className="relative w-28 h-28 rounded-full flex items-center justify-center select-none"
                style={{
                  background: `linear-gradient(135deg,${hangupColor}38,${hangupColor}12)`,
                  border: `2px solid ${hangupColor}60`,
                  boxShadow: `0 0 40px ${hangupColor}30`,
                }}
              >
                <HangupIcon style={{ width: 36, height: 36, color: hangupColor }} />
              </div>
            ) : (
              <div
                className="relative w-28 h-28 rounded-full flex items-center justify-center text-[30px] font-bold text-white select-none"
                style={{
                  background: "linear-gradient(135deg,rgba(52,199,89,0.28),rgba(52,199,89,0.08))",
                  border: "2px solid rgba(52,199,89,0.38)",
                  boxShadow: "0 0 40px rgba(52,199,89,0.22)",
                }}
              >
                {avatarInitials(callInfo)}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-6 mb-8 flex-wrap justify-center px-4">
        {controls.map(({ icon: Icon, label, active, onPress }) => (
          <div key={label} className="flex flex-col items-center gap-2">
            <button
              onClick={callPhase === "connected" ? onPress : undefined}
              disabled={callPhase !== "connected"}
              className={cn(
                "w-[60px] h-[60px] rounded-full flex items-center justify-center transition-all",
                callPhase === "connected"
                  ? active
                    ? "bg-white/22 border border-white/28 active:scale-90"
                    : "bg-white/8 border border-white/12 active:scale-90"
                  : "bg-white/4 border border-white/6 opacity-40 cursor-not-allowed"
              )}
            >
              <Icon className="w-[22px] h-[22px] text-white" />
            </button>
            <span className="text-white/40 text-[11px] font-medium">{label}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center mb-8 gap-2">
        <button
          onClick={handleEndCall}
          disabled={callPhase === "ended"}
          className={cn(
            "flex items-center justify-center rounded-full transition-all",
            callPhase !== "ended" && "active:scale-90 hover:scale-105"
          )}
          style={{
            width: 82,
            height: 82,
            background: callPhase === "ended" ? `${hangupColor}48` : "#ff3b30",
            boxShadow: callPhase === "ended" ? "none" : "0 6px 28px rgba(255,59,48,0.45)",
          }}
        >
          <PhoneOff className="text-white" style={{ width: 30, height: 30 }} />
        </button>
        <span className="text-white/35 text-xs font-medium">
          {callPhase === "ended" ? endedMessage : "End Call"}
        </span>
      </div>
    </div>
  );
}
