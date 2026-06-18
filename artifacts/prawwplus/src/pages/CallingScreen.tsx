import { useState, useEffect, useRef, useCallback } from "react";
import {
  PhoneOff, Mic, MicOff, Keyboard, Volume2, VolumeX, X,
  PhoneMissed, PhoneCall, WifiOff, Voicemail, Users, PauseCircle, PlayCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCall } from "@/context/CallContext";
import { useEndCall, getGetMeQueryKey, type EndCallRequestStatus } from "@workspace/api-client-react";
import { phoneAudio } from "@/lib/phoneAudio";
import { apiFetch } from "@/lib/apiFetch";

const DTMF_KEYS = [
  { key: "1", sub: "" },   { key: "2", sub: "ABC" },  { key: "3", sub: "DEF" },
  { key: "4", sub: "GHI" },{ key: "5", sub: "JKL" },  { key: "6", sub: "MNO" },
  { key: "7", sub: "PQRS"},{ key: "8", sub: "TUV" },  { key: "9", sub: "WXYZ" },
  { key: "*", sub: "" },   { key: "0", sub: "+" },     { key: "#", sub: "" },
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

function causeToEndStatus(cause: string | undefined): EndCallRequestStatus {
  switch (cause) {
    case "USER_BUSY": return "busy";
    case "NO_ANSWER":
    case "RECOVERY_ON_TIMER_EXPIRE":
    case "RECOVERY_ON_TIMER_EXPIRY": return "no-answer";
    case "NORMAL_CLEARING":
    case "ALLOTTED_TIMEOUT":
    case "ATTENDED_TRANSFER": return "completed";
    default: return "failed";
  }
}

type DirUser = { id: string; name: string; username: string | null; did: string | null };

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

  const [dirResults, setDirResults] = useState<DirUser[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirOpen, setDirOpen] = useState(false);
  const dirDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prevCallIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (callPhase === "calling" && callInfo?.callId !== prevCallIdRef.current) {
      prevCallIdRef.current = callInfo?.callId;
      setMutedState(false); setOnHold(false); setDtmfBuffer("");
      setShowKeypad(false); setShowConference(false);
      setConfRoomId(null); setConfStatus(null); setConfExtInput("");
      setDirResults([]); setDirOpen(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callPhase, callInfo?.callId]);

  useEffect(() => {
    if (dirDebounceRef.current) clearTimeout(dirDebounceRef.current);
    const hasLetters = /[a-zA-Z]/.test(confExtInput);
    if (!hasLetters || confExtInput.trim().length < 2) { setDirResults([]); setDirOpen(false); return; }
    dirDebounceRef.current = setTimeout(async () => {
      setDirLoading(true);
      try {
        const res = await apiFetch(`/api/users/directory?q=${encodeURIComponent(confExtInput.trim())}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json() as { users: DirUser[] };
          setDirResults(data.users ?? []); setDirOpen(true);
        }
      } catch { /* silent */ }
      finally { setDirLoading(false); }
    }, 280);
    return () => { if (dirDebounceRef.current) clearTimeout(dirDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confExtInput]);

  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const elapsedRef   = useRef<number>(0);
  const signalledRef = useRef<boolean>(false);

  useEffect(() => {
    if (callPhase === "calling") {
      phoneAudio.startDialTone();
    } else if (callPhase === "ringing") {
      phoneAudio.startRingback();
    } else if (callPhase === "connected") {
      phoneAudio.stopAll(); phoneAudio.playConnected();
    } else if (callPhase === "ended") {
      phoneAudio.stopAll();
      const icon = hangupInfo?.icon;
      if (icon === "busy") phoneAudio.playBusy();
      else if (icon === "unavailable") phoneAudio.playSIT();
      else if (icon === "error") phoneAudio.playCongestion();
      else if (icon === "no-answer") phoneAudio.playNoAnswer();
      else phoneAudio.playEnded();
    }
    return () => { if (callPhase === "calling" || callPhase === "ringing") phoneAudio.stopAll(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callPhase]);

  useEffect(() => { return () => { phoneAudio.stopAll(); }; }, []);

  useEffect(() => {
    if (callPhase === "connected") {
      startTimeRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        setElapsed((e) => { const next = e + 1; elapsedRef.current = next; return next; });
      }, 1000);
    } else {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      if (callPhase === "calling") { setElapsed(0); elapsedRef.current = 0; signalledRef.current = false; }
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [callPhase]);

  useEffect(() => {
    if (callPhase !== "ended" || signalledRef.current || !callInfo?.callId) return;
    signalledRef.current = true;
    const duration = elapsedRef.current;
    signalEndCall({ callId: callInfo.callId, data: { duration, status: causeToEndStatus(hangupInfo?.cause) } })
      .catch(() => {})
      .finally(() => { queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }); });
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
          await signalEndCall({ callId: callInfo.callId, data: { duration: durationSecs, status: endStatus } });
        } catch { /* best-effort */ }
        finally { queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }); }
      }
    }
    endCall(durationSecs);
  }, [callInfo, callPhase, endCall, queryClient, signalEndCall]);

  const handleMute    = () => { const next = !muted; setMutedState(next); setMuted(next); };
  const handleSpeaker = () => { const next = !speaker; setSpeakerState(next); setSpeaker(next); };
  const handleHold    = () => {
    if (callPhase !== "connected") return;
    const next = !onHold; setOnHold(next);
    if (next) holdCall(); else resumeCall();
  };
  const handleDtmf = (digit: string) => {
    phoneAudio.playDtmf(digit); sendDtmf(digit);
    setDtmfBuffer((b) => (b + digit).slice(-12));
  };

  const handleStartConference = useCallback(async () => {
    if (confBusy) return;
    const phone = confExtInput.trim();
    if (!/^\+?\d{7,15}$/.test(phone)) {
      setConfStatus("Select a colleague from the list, or enter a full phone number (e.g. +27821234567)");
      return;
    }
    setConfBusy(true); setDirOpen(false); setConfStatus("Setting up conference…");
    try {
      let roomId = confRoomId;
      if (!roomId) {
        const createRes = await apiFetch("/api/conference", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callId: callInfo?.callId }), credentials: "include",
        });
        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({})) as any;
          setConfStatus(err?.error ?? "Failed to create conference room"); return;
        }
        const created = await createRes.json() as { roomId: string; transferred: boolean };
        roomId = created.roomId; setConfRoomId(roomId);
        if (!created.transferred) setConfStatus("Conference created — inviting participant…");
      }
      const inviteRes = await apiFetch(`/api/conference/${roomId}/invite`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }), credentials: "include",
      });
      if (!inviteRes.ok) {
        const err = await inviteRes.json().catch(() => ({})) as any;
        setConfStatus(err?.error ?? "Failed to invite participant"); return;
      }
      setConfStatus(`Calling ${phone}…`); setConfExtInput("");
    } catch { setConfStatus("Network error — please try again"); }
    finally { setConfBusy(false); }
  }, [confBusy, confExtInput, confRoomId, callInfo?.callId]);

  const handleEndConference = useCallback(async () => {
    if (!confRoomId) return;
    await apiFetch(`/api/conference/${confRoomId}`, { method: "DELETE", credentials: "include" }).catch(() => {});
    setConfRoomId(null); setConfStatus(null); setShowConference(false);
  }, [confRoomId]);

  const hangupColor =
    hangupInfo?.icon === "busy"        ? "#FF9500" :
    hangupInfo?.icon === "no-answer"   ? "#FF9500" :
    hangupInfo?.icon === "unavailable" ? "#FF3B30" :
    hangupInfo?.icon === "voicemail"   ? "#8E8E93" :
    "#FF3B30";

  const HangupIcon =
    hangupInfo?.icon === "busy"        ? PhoneCall :
    hangupInfo?.icon === "no-answer"   ? PhoneMissed :
    hangupInfo?.icon === "unavailable" ? WifiOff :
    hangupInfo?.icon === "voicemail"   ? Voicemail :
    PhoneOff;

  const isInternal = callInfo?.callType === "internal";
  const endedMessage = hangupInfo?.message ?? "Call Ended";
  const statusLabel =
    callPhase === "calling" ? "Calling…" :
    callPhase === "ringing" ? "Ringing…" :
    callPhase === "ended"   ? endedMessage :
    null;

  const callerDisplay = callInfo?.name ?? (callInfo?.number || "PRaww+ User");

  const controls = [
    { icon: muted ? MicOff : Mic,        label: muted ? "Unmute" : "Mute", active: muted,          onPress: handleMute },
    { icon: Keyboard,                     label: "Keypad",                   active: showKeypad,    onPress: () => { setShowKeypad((v) => !v); setShowConference(false); } },
    { icon: speaker ? Volume2 : VolumeX, label: "Speaker",                  active: speaker,        onPress: handleSpeaker },
    { icon: onHold ? PlayCircle : PauseCircle, label: onHold ? "Resume" : "Hold", active: onHold,  onPress: handleHold },
    { icon: Users,                        label: confRoomId ? "Conf" : "Add", active: showConference, onPress: () => { setShowConference((v) => !v); setShowKeypad(false); } },
  ];

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "#000000",
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingTop: "env(safe-area-inset-top, 44px)",
        paddingBottom: "env(safe-area-inset-bottom, 34px)",
        fontFamily: "-apple-system, 'SF Pro Text', 'Inter', sans-serif",
      }}
    >
      {/* ── Caller info ── */}
      <div style={{
        width: "100%", maxWidth: 390,
        padding: "20px 24px 0",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      }}>
        {statusLabel && (
          <p style={{
            fontSize: 13, fontWeight: 500, margin: 0,
            color: callPhase === "ended" ? "rgba(235,235,245,0.4)" : "rgba(235,235,245,0.55)",
          }}>
            {statusLabel}
          </p>
        )}

        <h1 style={{
          fontSize: callerDisplay.length > 22 ? 26 : 34, fontWeight: 700,
          color: "#FFFFFF", margin: 0, lineHeight: 1.1,
          textAlign: "center", letterSpacing: "-0.5px",
          fontFamily: "-apple-system, 'SF Pro Display', sans-serif",
        }}>
          {callerDisplay}
        </h1>

        {callInfo?.name && callInfo?.number && (
          <p style={{ fontSize: 15, color: "rgba(235,235,245,0.45)", margin: 0 }}>
            {callInfo.number}
          </p>
        )}
        {isInternal && (
          <span style={{
            fontSize: 11, fontWeight: 600, color: "#30D158",
            letterSpacing: "0.05em", textTransform: "uppercase",
          }}>
            Internal · Free
          </span>
        )}
        {callPhase === "connected" && (
          <p style={{
            fontSize: 16, fontWeight: 400, color: "rgba(235,235,245,0.55)",
            fontVariantNumeric: "tabular-nums", margin: 0,
          }}>
            {formatDuration(elapsed)}
          </p>
        )}
      </div>

      {/* ── Conference panel ── */}
      {showConference && callPhase === "connected" && (
        <div style={{
          width: "calc(100% - 32px)", maxWidth: 358,
          margin: "14px auto 0",
          background: "rgba(28,28,30,1)", borderRadius: 16,
          padding: "16px 20px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ color: "#fff", fontWeight: 600, fontSize: 15 }}>
              {confRoomId ? `Conference · ${confRoomId}` : "Add Participant"}
            </span>
            {confRoomId && (
              <button onClick={handleEndConference} style={{
                background: "rgba(255,59,48,0.18)", border: "none", borderRadius: 8,
                color: "#FF3B30", fontSize: 12, fontWeight: 600,
                padding: "4px 10px", cursor: "pointer",
              }}>
                End
              </button>
            )}
          </div>

          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder="Search or enter number…"
                value={confExtInput}
                onChange={(e) => { setConfExtInput(e.target.value); setConfStatus(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleStartConference(); if (e.key === "Escape") setDirOpen(false); }}
                onFocus={() => dirResults.length > 0 && setDirOpen(true)}
                style={{
                  flex: 1, background: "rgba(118,118,128,0.24)",
                  border: "none", borderRadius: 10, padding: "10px 14px",
                  color: "#fff", fontSize: 14, outline: "none", fontFamily: "inherit",
                }}
              />
              <button
                onClick={handleStartConference}
                disabled={confBusy}
                style={{
                  background: confBusy ? "rgba(0,122,255,0.4)" : "#007AFF",
                  border: "none", borderRadius: 10, padding: "10px 18px",
                  color: "white", fontWeight: 600, fontSize: 14,
                  cursor: confBusy ? "default" : "pointer",
                  opacity: confBusy ? 0.7 : 1, flexShrink: 0,
                }}
              >
                {confBusy ? "…" : "Invite"}
              </button>
            </div>

            {dirOpen && dirResults.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 56, zIndex: 200,
                marginTop: 4, borderRadius: 10, overflow: "hidden",
                background: "rgba(44,44,46,1)",
                border: "0.5px solid rgba(84,84,88,0.65)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              }}>
                {dirResults.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => {
                      if (u.did) { setConfExtInput(u.did); setDirOpen(false); setConfStatus(null); }
                      else { setConfStatus(`${u.name} has no DID assigned`); setDirOpen(false); }
                    }}
                    style={{
                      width: "100%", display: "flex", alignItems: "center",
                      justifyContent: "space-between", padding: "10px 14px",
                      background: "none", border: "none",
                      borderBottom: "0.5px solid rgba(84,84,88,0.65)",
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 14, color: "rgba(235,235,245,0.85)", fontWeight: 500 }}>
                      {u.name}
                    </span>
                    {u.did && (
                      <span style={{ fontSize: 12, color: "rgba(235,235,245,0.45)" }}>{u.did}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {dirLoading && (
              <p style={{ fontSize: 11, color: "rgba(235,235,245,0.35)", margin: "4px 0 0" }}>Searching…</p>
            )}
          </div>
          {confStatus && (
            <p style={{ color: "rgba(235,235,245,0.55)", fontSize: 12, margin: "8px 0 0" }}>{confStatus}</p>
          )}
        </div>
      )}

      {/* ── Avatar / DTMF keypad ── */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", width: "100%",
      }}>
        {showKeypad && callPhase === "connected" ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "0 24px" }}>
            {/* DTMF buffer */}
            <div style={{ height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{
                fontSize: 26, fontWeight: 300, color: "rgba(235,235,245,0.85)",
                fontFamily: "monospace", letterSpacing: "0.14em", minWidth: 20,
              }}>
                {dtmfBuffer || ""}
              </span>
            </div>

            {/* 3×4 grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 76px)", gap: 10 }}>
              {DTMF_KEYS.map(({ key, sub }) => (
                <button
                  key={key}
                  onClick={() => handleDtmf(key)}
                  style={{
                    width: 76, height: 76, borderRadius: "50%",
                    background: "rgba(118,118,128,0.24)", border: "none",
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    cursor: "pointer", gap: 2,
                    WebkitTapHighlightColor: "transparent",
                  }}
                  onPointerDown={(e) => { e.currentTarget.style.background = "rgba(118,118,128,0.48)"; }}
                  onPointerUp={(e) => { e.currentTarget.style.background = "rgba(118,118,128,0.24)"; }}
                  onPointerLeave={(e) => { e.currentTarget.style.background = "rgba(118,118,128,0.24)"; }}
                >
                  <span style={{ fontSize: 24, fontWeight: 300, color: "#fff", lineHeight: 1 }}>{key}</span>
                  {sub && <span style={{ fontSize: 8, fontWeight: 600, color: "rgba(235,235,245,0.45)", letterSpacing: "0.1em" }}>{sub}</span>}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowKeypad(false)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "rgba(118,118,128,0.24)", border: "none",
                borderRadius: 20, padding: "8px 22px",
                cursor: "pointer", color: "rgba(235,235,245,0.6)",
                fontSize: 13, fontWeight: 500, fontFamily: "inherit",
                marginTop: 4,
              }}
            >
              <X style={{ width: 14, height: 14 }} />
              Hide
            </button>
          </div>
        ) : (
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {(callPhase === "calling" || callPhase === "ringing") && (
              <>
                <div
                  className="absolute rounded-full animate-ping"
                  style={{ width: 180, height: 180, background: "#30D158", opacity: 0.09, animationDuration: "1.8s" }}
                />
                <div
                  className="absolute rounded-full animate-ping"
                  style={{ width: 145, height: 145, background: "#30D158", opacity: 0.14, animationDuration: "1.4s" }}
                />
              </>
            )}

            {callPhase === "ended" ? (
              <div style={{
                position: "absolute", width: 200, height: 200, borderRadius: "50%",
                background: hangupColor, opacity: 0.07, filter: "blur(20px)",
              }} />
            ) : (
              <div style={{
                position: "absolute", width: 200, height: 200, borderRadius: "50%",
                background: "#30D158", opacity: 0.07, filter: "blur(20px)",
              }} />
            )}

            {callPhase === "ended" ? (
              <div style={{
                position: "relative", width: 110, height: 110, borderRadius: "50%",
                background: `${hangupColor}20`,
                border: `2px solid ${hangupColor}44`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <HangupIcon style={{ width: 40, height: 40, color: hangupColor }} />
              </div>
            ) : (
              <div style={{
                position: "relative", width: 110, height: 110, borderRadius: "50%",
                background: "rgba(118,118,128,0.24)",
                border: "2px solid rgba(84,84,88,0.5)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 34, fontWeight: 700, color: "#fff",
              }}>
                {avatarInitials(callInfo)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Control buttons (5 × circle + label) ── */}
      <div style={{
        display: "flex", gap: 20, flexWrap: "wrap",
        justifyContent: "center", padding: "0 24px",
        marginBottom: 28, width: "100%", maxWidth: 390,
      }}>
        {controls.map(({ icon: Icon, label, active, onPress }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
            <button
              onClick={callPhase === "connected" ? onPress : undefined}
              disabled={callPhase !== "connected"}
              style={{
                width: 64, height: 64, borderRadius: "50%", border: "none",
                background: active ? "rgba(235,235,245,0.24)" : "rgba(118,118,128,0.24)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: callPhase !== "connected" ? "default" : "pointer",
                opacity: callPhase !== "connected" ? 0.38 : 1,
                transition: "background 0.15s",
                WebkitTapHighlightColor: "transparent",
              }}
              onPointerDown={(e) => { if (callPhase === "connected") e.currentTarget.style.background = active ? "rgba(235,235,245,0.32)" : "rgba(118,118,128,0.40)"; }}
              onPointerUp={(e) => { e.currentTarget.style.background = active ? "rgba(235,235,245,0.24)" : "rgba(118,118,128,0.24)"; }}
              onPointerLeave={(e) => { e.currentTarget.style.background = active ? "rgba(235,235,245,0.24)" : "rgba(118,118,128,0.24)"; }}
            >
              <Icon style={{ width: 22, height: 22, color: active ? "#fff" : "rgba(235,235,245,0.85)" }} />
            </button>
            <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(235,235,245,0.45)" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* ── End Call button ── */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <button
          onClick={handleEndCall}
          disabled={callPhase === "ended"}
          style={{
            width: 80, height: 80, borderRadius: "50%", border: "none",
            background: callPhase === "ended" ? `${hangupColor}28` : "#FF3B30",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: callPhase === "ended" ? "default" : "pointer",
            boxShadow: callPhase === "ended" ? "none" : "0 4px 22px rgba(255,59,48,0.45)",
            WebkitTapHighlightColor: "transparent",
            transition: "transform 0.1s",
          }}
          onPointerDown={(e) => { if (callPhase !== "ended") e.currentTarget.style.transform = "scale(0.93)"; }}
          onPointerUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          onPointerLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
        >
          <PhoneOff style={{ width: 30, height: 30, color: "white" }} />
        </button>
        <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(235,235,245,0.4)" }}>
          {callPhase === "ended" ? endedMessage : "End Call"}
        </span>
      </div>
    </div>
  );
}
