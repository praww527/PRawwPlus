import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Vibration,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useCall } from "@/context/CallContext";

// ─── Pulsing avatar animation ─────────────────────────────────────────────────

function PulsingAvatar({ name }: { name: string }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.12, duration: 700, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [scale]);

  const initial = name.replace(/\D/g, "").slice(0, 3) || name.slice(0, 2).toUpperCase() || "??";

  return (
    <Animated.View style={[styles.avatarOuter, { transform: [{ scale }] }]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
    </Animated.View>
  );
}

// ─── Incoming call screen ─────────────────────────────────────────────────────

export default function IncomingCallScreen() {
  const { incomingFrom, answerCall, declineCall, networkState } = useCall();

  const callerLabel = incomingFrom ?? "Unknown";

  useEffect(() => {
    // Vibrate: 500ms on, 300ms off, repeat
    const pattern = [0, 500, 300, 500];
    Vibration.vibrate(pattern, true);
    return () => Vibration.cancel();
  }, []);

  const handleAnswer = async () => {
    Vibration.cancel();
    await answerCall();
  };

  const handleDecline = () => {
    Vibration.cancel();
    declineCall();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Top info */}
        <View style={styles.top}>
          {networkState === "offline" && (
            <View style={styles.offlineBanner}>
              <Feather name="wifi-off" size={14} color="#FF9F0A" />
              <Text style={styles.offlineText}>No internet connection</Text>
            </View>
          )}

          <Text style={styles.callStatus}>Incoming Call</Text>
          <PulsingAvatar name={callerLabel} />
          <Text style={styles.callerName}>{callerLabel}</Text>
          <Text style={styles.callerSub}>VoIP Call</Text>
        </View>

        {/* Slide-to-answer hint */}
        <View style={styles.hint}>
          <Text style={styles.hintText}>Swipe up to answer</Text>
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <View style={styles.actionCol}>
            <TouchableOpacity
              style={[styles.btn, styles.declineBtn]}
              onPress={handleDecline}
              activeOpacity={0.85}
            >
              <Feather name="phone-off" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.btnLabel}>Decline</Text>
          </View>

          <View style={styles.actionCol}>
            <TouchableOpacity
              style={[styles.btn, styles.answerBtn]}
              onPress={handleAnswer}
              activeOpacity={0.85}
            >
              <Feather name="phone" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.btnLabel}>Answer</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#0A0A0A" },
  container:      { flex: 1, justifyContent: "space-between", paddingVertical: 60, paddingHorizontal: 32 },
  top:            { alignItems: "center", gap: 16 },
  offlineBanner:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#1C1C1E", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  offlineText:    { fontSize: 13, color: "#FF9F0A" },
  callStatus:     { fontSize: 16, color: "#aaa", letterSpacing: 1, textTransform: "uppercase", fontWeight: "600" },
  avatarOuter:    { padding: 6 },
  avatar:         { width: 120, height: 120, borderRadius: 60, backgroundColor: "#1C3A5E", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#0A84FF" },
  avatarText:     { fontSize: 38, fontWeight: "700", color: "#fff" },
  callerName:     { fontSize: 28, fontWeight: "700", color: "#fff" },
  callerSub:      { fontSize: 16, color: "#555" },
  hint:           { alignItems: "center" },
  hintText:       { fontSize: 13, color: "#444" },
  actions:        { flexDirection: "row", justifyContent: "space-around", alignItems: "flex-end" },
  actionCol:      { alignItems: "center", gap: 10 },
  btn:            { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  declineBtn:     { backgroundColor: "#FF3B30" },
  answerBtn:      { backgroundColor: "#30D158" },
  btnLabel:       { fontSize: 13, color: "#fff", fontWeight: "600" },
});
