import React, { useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Vibration,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCall } from "@/context/CallContext";

export default function IncomingCallScreen() {
  const { incomingFrom, answerCall, declineCall } = useCall();

  // Vibrate while ringing
  useEffect(() => {
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
        <View style={styles.top}>
          <Text style={styles.callStatus}>Incoming Call</Text>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>📞</Text>
          </View>
          <Text style={styles.callerName}>Extension {incomingFrom ?? "Unknown"}</Text>
          <Text style={styles.callerSub}>SIP Call</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, styles.declineBtn]}
            onPress={handleDecline}
            activeOpacity={0.85}
          >
            <Text style={styles.btnIcon}>📵</Text>
            <Text style={styles.btnLabel}>Decline</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.answerBtn]}
            onPress={handleAnswer}
            activeOpacity={0.85}
          >
            <Text style={styles.btnIcon}>📞</Text>
            <Text style={styles.btnLabel}>Answer</Text>
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
    gap: 16,
  },
  callStatus: {
    fontSize: 16,
    color: "#888",
    letterSpacing: 1,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#1C3A5E",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 12,
    borderWidth: 3,
    borderColor: "#0A84FF",
  },
  avatarText: {
    fontSize: 52,
  },
  callerName: {
    fontSize: 28,
    fontWeight: "700",
    color: "#fff",
  },
  callerSub: {
    fontSize: 16,
    color: "#666",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  btn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  declineBtn: {
    backgroundColor: "#FF3B30",
  },
  answerBtn: {
    backgroundColor: "#30D158",
  },
  btnIcon: {
    fontSize: 28,
  },
  btnLabel: {
    fontSize: 12,
    color: "#fff",
    fontWeight: "600",
  },
});
