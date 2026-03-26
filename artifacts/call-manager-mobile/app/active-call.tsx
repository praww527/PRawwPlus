import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCall } from "@/context/CallContext";

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
  return `${mins}:${secs}`;
}

export default function ActiveCallScreen() {
  const {
    activeCall,
    isMuted,
    isSpeakerOn,
    hangup,
    toggleMute,
    toggleSpeaker,
  } = useCall();

  const duration = useCallTimer(activeCall?.startedAt ?? null);

  const remoteLabel = activeCall
    ? `Ext. ${activeCall.remoteNumber}`
    : "Unknown";

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.top}>
          <Text style={styles.callStatus}>
            {activeCall?.direction === "inbound" ? "Incoming Call" : "Outgoing Call"}
          </Text>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>👤</Text>
          </View>
          <Text style={styles.callerName}>{remoteLabel}</Text>
          <Text style={styles.duration}>{duration}</Text>
        </View>

        <View style={styles.controls}>
          <View style={styles.controlRow}>
            <TouchableOpacity
              style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
              onPress={toggleMute}
              activeOpacity={0.8}
            >
              <Text style={styles.controlIcon}>{isMuted ? "🔇" : "🎤"}</Text>
              <Text style={styles.controlLabel}>{isMuted ? "Unmute" : "Mute"}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.controlBtn, isSpeakerOn && styles.controlBtnActive]}
              onPress={toggleSpeaker}
              activeOpacity={0.8}
            >
              <Text style={styles.controlIcon}>🔊</Text>
              <Text style={styles.controlLabel}>{isSpeakerOn ? "Earpiece" : "Speaker"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.hangupRow}>
          <TouchableOpacity
            style={styles.hangupBtn}
            onPress={hangup}
            activeOpacity={0.85}
          >
            <Text style={styles.hangupIcon}>📵</Text>
            <Text style={styles.hangupLabel}>End Call</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0A0A0A",
  },
  container: {
    flex: 1,
    justifyContent: "space-between",
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  top: {
    alignItems: "center",
    gap: 12,
  },
  callStatus: {
    fontSize: 14,
    color: "#30D158",
    letterSpacing: 1,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#1C1C1E",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 8,
    borderWidth: 2,
    borderColor: "#333",
  },
  avatarText: {
    fontSize: 44,
  },
  callerName: {
    fontSize: 26,
    fontWeight: "700",
    color: "#fff",
  },
  duration: {
    fontSize: 20,
    color: "#30D158",
    fontWeight: "600",
    letterSpacing: 2,
    fontVariant: ["tabular-nums"],
  },
  controls: {
    gap: 24,
  },
  controlRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 32,
  },
  controlBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#1C1C1E",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderWidth: 1,
    borderColor: "#333",
  },
  controlBtnActive: {
    backgroundColor: "#0A84FF",
    borderColor: "#0A84FF",
  },
  controlIcon: {
    fontSize: 24,
  },
  controlLabel: {
    fontSize: 10,
    color: "#fff",
    fontWeight: "500",
  },
  hangupRow: {
    alignItems: "center",
  },
  hangupBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#FF3B30",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  hangupIcon: {
    fontSize: 30,
  },
  hangupLabel: {
    fontSize: 11,
    color: "#fff",
    fontWeight: "600",
  },
});
