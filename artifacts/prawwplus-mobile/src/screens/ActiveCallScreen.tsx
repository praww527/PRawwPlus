import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Vibration,
  Modal,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useCall } from "@/context/CallContext";
import { apiRequest } from "@/services/api";

// ─── Call timer ───────────────────────────────────────────────────────────────

function useCallTimer(startedAt: Date | null) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!startedAt) { setElapsed(0); return; }
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000));
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [startedAt]);

  const mins = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const secs = (elapsed % 60).toString().padStart(2, "0");
  return { label: `${mins}:${secs}`, elapsedSecs: elapsed };
}

function resolveRateForNumber(number: string, plan: any): number {
  const defaultRate = Number(plan?.defaultCoinsPerMinute) || 1;
  const digits = String(number ?? "").replace(/\D/g, "");
  const rates = Array.isArray(plan?.rates) ? plan.rates : [];
  if (!digits || rates.length === 0) return defaultRate;
  let best = defaultRate;
  let bestLen = 0;
  for (const r of rates) {
    const prefix = String(r?.prefix ?? "").replace(/\D/g, "");
    if (!prefix) continue;
    if (digits.startsWith(prefix) && prefix.length > bestLen) {
      best = Number(r?.coinsPerMinute) || defaultRate;
      bestLen = prefix.length;
    }
  }
  return best;
}

// ─── DTMF Keypad ──────────────────────────────────────────────────────────────

const DTMF_KEYS: [string, string][] = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
];

function DtmfKeypad({
  visible,
  onKey,
  onClose,
}: {
  visible: boolean;
  onKey: (key: string) => void;
  onClose: () => void;
}) {
  const [digits, setDigits] = useState("");

  function pressKey(key: string) {
    Vibration.vibrate(5);
    setDigits((d) => d + key);
    onKey(key);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={dtmfStyles.safe}>
        <View style={dtmfStyles.header}>
          <Text style={dtmfStyles.title}>Keypad</Text>
          <TouchableOpacity onPress={onClose} style={dtmfStyles.closeBtn}>
            <Feather name="x" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text style={dtmfStyles.display} numberOfLines={1}>{digits || " "}</Text>
        <View style={dtmfStyles.grid}>
          {DTMF_KEYS.map(([key, sub]) => (
            <TouchableOpacity
              key={key}
              style={dtmfStyles.key}
              onPress={() => pressKey(key)}
              activeOpacity={0.7}
            >
              <Text style={dtmfStyles.keyMain}>{key}</Text>
              {sub ? <Text style={dtmfStyles.keySub}>{sub}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const dtmfStyles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: "#0A0A0A" },
  header:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  title:   { fontSize: 20, fontWeight: "700", color: "#fff" },
  closeBtn:{ padding: 8 },
  display: { textAlign: "center", fontSize: 34, fontWeight: "300", color: "#fff", letterSpacing: 4, paddingVertical: 16, fontVariant: ["tabular-nums"] },
  grid:    { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  key:     { width: "33.33%", height: 80, alignItems: "center", justifyContent: "center", gap: 2 },
  keyMain: { fontSize: 28, fontWeight: "400", color: "#fff" },
  keySub:  { fontSize: 10, color: "#666", letterSpacing: 1 },
});

// ─── Control button ───────────────────────────────────────────────────────────

function ControlBtn({
  icon,
  label,
  active = false,
  danger = false,
  onPress,
}: {
  icon: string;
  label: string;
  active?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const bg = danger ? "#FF3B30" : active ? "#0A84FF" : "#1C1C1E";
  return (
    <TouchableOpacity
      style={[styles.controlBtn, { backgroundColor: bg }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Feather name={icon as any} size={22} color="#fff" />
      <Text style={styles.controlLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Avatar initials ──────────────────────────────────────────────────────────

function Avatar({ name }: { name: string }) {
  const initial = name.replace(/\D/g, "").slice(0, 3) || name.slice(0, 2).toUpperCase() || "??";
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initial}</Text>
    </View>
  );
}

// ─── Active call screen ───────────────────────────────────────────────────────

export default function ActiveCallScreen() {
  const {
    activeCall,
    callState,
    isMuted,
    isSpeakerOn,
    isOnHold,
    waitingCall,
    hangup,
    holdCall,
    unholdCall,
    toggleMute,
    toggleSpeaker,
    sendDTMF,
    answerWaitingCall,
    dismissWaitingCall,
  } = useCall();

  const [dtmfVisible, setDtmfVisible] = useState(false);

  const { label: duration, elapsedSecs } = useCallTimer(activeCall?.startedAt ?? null);
  const remoteLabel = activeCall?.remoteNumber ?? "Unknown";
  const isOutbound  = activeCall?.direction === "outbound";

  const [coinsPerMinute, setCoinsPerMinute] = useState<number | null>(null);
  const [walletCoins, setWalletCoins] = useState<number | null>(null);

  useEffect(() => {
    if (!activeCall) {
      setCoinsPerMinute(null);
      setWalletCoins(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [rateRes, billingRes] = await Promise.all([
          apiRequest("/rate-plans/current"),
          apiRequest("/billing/summary"),
        ]);
        if (!cancelled && rateRes.ok) {
          const plan = await rateRes.json().catch(() => ({} as any));
          const rate = resolveRateForNumber(activeCall.remoteNumber, plan);
          setCoinsPerMinute(rate);
        }
        if (!cancelled && billingRes.ok) {
          const billing = await billingRes.json().catch(() => ({} as any));
          const c = typeof billing?.coins === "number" ? billing.coins : null;
          setWalletCoins(c);
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [activeCall?.uuid]);

  const estCoins =
    isOutbound && typeof coinsPerMinute === "number"
      ? Math.ceil((elapsedSecs / 60) * coinsPerMinute)
      : null;

  const statusText = isOnHold
    ? "On Hold"
    : callState === "in-call"
      ? "Connected"
      : callState === "calling"
        ? (isOutbound ? "Calling…" : "Ringing…")
        : isOutbound
          ? "Connected"
          : "Incoming";

  return (
    <SafeAreaView style={styles.safe}>
      <DtmfKeypad
        visible={dtmfVisible}
        onKey={sendDTMF}
        onClose={() => setDtmfVisible(false)}
      />

      <View style={styles.container}>
        {/* Header */}
        <View style={styles.top}>
          <Text style={[styles.callStatus, isOnHold && styles.holdStatus]}>
            {statusText}
          </Text>
          <Avatar name={remoteLabel} />
          <Text style={styles.callerName}>{remoteLabel}</Text>
          {!isOnHold && <Text style={styles.duration}>{duration}</Text>}
          {estCoins != null && (
            <Text style={styles.costLine}>
              Est. {estCoins} coins
              {typeof walletCoins === "number" ? ` · Balance ${walletCoins}` : ""}
            </Text>
          )}
          {isOnHold && <Text style={styles.holdNote}>Call is on hold</Text>}
        </View>

        {/* Call waiting banner */}
        {waitingCall && (
          <View style={styles.waitingBanner}>
            <Text style={styles.waitingText}>
              Incoming call from {waitingCall.fromNumber}
            </Text>
            <View style={styles.waitingBtns}>
              <TouchableOpacity
                style={[styles.waitingBtn, styles.waitingDecline]}
                onPress={dismissWaitingCall}
              >
                <Text style={styles.waitingBtnText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.waitingBtn, styles.waitingAnswer]}
                onPress={answerWaitingCall}
              >
                <Text style={styles.waitingBtnText}>Answer</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Controls grid */}
        <View style={styles.controls}>
          <View style={styles.controlRow}>
            <ControlBtn
              icon={isMuted ? "mic-off" : "mic"}
              label={isMuted ? "Unmute" : "Mute"}
              active={isMuted}
              onPress={toggleMute}
            />
            <ControlBtn
              icon="volume-2"
              label={isSpeakerOn ? "Earpiece" : "Speaker"}
              active={isSpeakerOn}
              onPress={toggleSpeaker}
            />
          </View>
          <View style={styles.controlRow}>
            <ControlBtn
              icon={isOnHold ? "play-circle" : "pause-circle"}
              label={isOnHold ? "Resume" : "Hold"}
              active={isOnHold}
              onPress={isOnHold ? unholdCall : holdCall}
            />
            <ControlBtn
              icon="grid"
              label="Keypad"
              onPress={() => setDtmfVisible(true)}
            />
          </View>
        </View>

        {/* End call */}
        <View style={styles.hangupRow}>
          <TouchableOpacity
            style={styles.hangupBtn}
            onPress={hangup}
            activeOpacity={0.85}
          >
            <Feather name="phone-off" size={30} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#0A0A0A" },
  container:      { flex: 1, justifyContent: "space-between", paddingVertical: 60, paddingHorizontal: 32 },
  top:            { alignItems: "center", gap: 12 },
  callStatus:     { fontSize: 14, color: "#30D158", letterSpacing: 1, textTransform: "uppercase", fontWeight: "600" },
  holdStatus:     { color: "#FF9F0A" },
  avatar:         { width: 100, height: 100, borderRadius: 50, backgroundColor: "#1C3A5E", alignItems: "center", justifyContent: "center", marginVertical: 8, borderWidth: 2, borderColor: "#0A84FF" },
  avatarText:     { fontSize: 30, fontWeight: "700", color: "#fff" },
  callerName:     { fontSize: 26, fontWeight: "700", color: "#fff" },
  duration:       { fontSize: 20, color: "#30D158", fontWeight: "600", letterSpacing: 2, fontVariant: ["tabular-nums"] },
  costLine:       { fontSize: 13, color: "#30D158", fontWeight: "700" },
  holdNote:       { fontSize: 14, color: "#FF9F0A", fontWeight: "500" },
  waitingBanner:  { backgroundColor: "#1C1C1E", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#0A84FF" },
  waitingText:    { fontSize: 14, color: "#fff", textAlign: "center", marginBottom: 12 },
  waitingBtns:    { flexDirection: "row", gap: 12, justifyContent: "center" },
  waitingBtn:     { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  waitingDecline: { backgroundColor: "#FF3B30" },
  waitingAnswer:  { backgroundColor: "#30D158" },
  waitingBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  controls:       { gap: 16 },
  controlRow:     { flexDirection: "row", justifyContent: "center", gap: 24 },
  controlBtn:     { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: "#333" },
  controlLabel:   { fontSize: 10, color: "#fff", fontWeight: "500" },
  hangupRow:      { alignItems: "center" },
  hangupBtn:      { width: 80, height: 80, borderRadius: 40, backgroundColor: "#FF3B30", alignItems: "center", justifyContent: "center" },
});
