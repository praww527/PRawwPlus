/**
 * Dialpad screen — the main calling interface.
 * - Auto-registers with FreeSWITCH on mount
 * - Lets users enter an extension and call
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Vibration,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCall } from "@/context/CallContext";
import { useAuth } from "@/context/AuthContext";

const DIALPAD_KEYS: [string, string][] = [
  ["1", ""],    ["2", "ABC"],  ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"],  ["6", "MNO"],
  ["7", "PQRS"],["8", "TUV"],  ["9", "WXYZ"],
  ["*", ""],    ["0", "+"],    ["#", ""],
];

function StatusBadge({ state }: { state: string }) {
  const color  = state === "registered" ? "#30D158" : state === "registering" ? "#FF9F0A" : state === "error" ? "#FF3B30" : "#666";
  const label  = state === "registered" ? "Ready" : state === "registering" ? "Connecting…" : state === "error" ? "Error" : "Offline";
  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{label}</Text>
    </View>
  );
}

export default function DialpadScreen() {
  const { user }                          = useAuth();
  const { callState, register, makeCall } = useCall();
  const [digits, setDigits]               = useState("");
  const [registering, setRegistering]     = useState(false);

  useEffect(() => {
    if (!user || callState !== "idle") return;
    setRegistering(true);
    register().catch(console.error).finally(() => setRegistering(false));
  }, [user]);

  function pressKey(key: string) {
    Vibration.vibrate(5);
    setDigits((d) => d + key);
  }

  async function handleCall() {
    if (!digits.trim()) { Alert.alert("Enter number", "Please enter an extension or number"); return; }
    if (callState !== "registered") { Alert.alert("Not ready", "Still connecting to the server. Please wait."); return; }
    try {
      await makeCall(digits.trim());
    } catch (err: any) {
      Alert.alert("Call Failed", err?.message ?? "Could not place the call");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Dialpad</Text>
          {registering ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color="#FF9F0A" />
              <Text style={[styles.statusText, { color: "#FF9F0A" }]}>Connecting…</Text>
            </View>
          ) : (
            <StatusBadge state={callState} />
          )}
        </View>

        <View style={styles.display}>
          <Text style={styles.displayText} numberOfLines={1}>{digits || " "}</Text>
          {digits.length > 0 && (
            <TouchableOpacity onPress={() => setDigits((d) => d.slice(0, -1))} activeOpacity={0.6} style={styles.backspace}>
              <Text style={styles.backspaceIcon}>⌫</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.grid}>
          {DIALPAD_KEYS.map(([key, sub]) => (
            <TouchableOpacity key={key} style={styles.key} onPress={() => pressKey(key)} activeOpacity={0.7}>
              <Text style={styles.keyMain}>{key}</Text>
              {sub ? <Text style={styles.keySub}>{sub}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.callRow}>
          <TouchableOpacity
            style={[styles.callBtn, callState !== "registered" && styles.callBtnDisabled]}
            onPress={handleCall}
            disabled={callState !== "registered"}
            activeOpacity={0.85}
          >
            <Text style={styles.callIcon}>📞</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#0A0A0A" },
  container:      { flex: 1, paddingHorizontal: 24, paddingTop: 12 },
  header:         { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title:          { fontSize: 28, fontWeight: "700", color: "#fff" },
  statusRow:      { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot:      { width: 8, height: 8, borderRadius: 4 },
  statusText:     { fontSize: 13, fontWeight: "600" },
  display:        { flexDirection: "row", alignItems: "center", justifyContent: "center", minHeight: 64, marginBottom: 8, paddingHorizontal: 16 },
  displayText:    { flex: 1, textAlign: "center", fontSize: 36, fontWeight: "300", color: "#fff", letterSpacing: 4, fontVariant: ["tabular-nums"] },
  backspace:      { padding: 8 },
  backspaceIcon:  { fontSize: 24, color: "#888" },
  grid:           { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", marginBottom: 8 },
  key:            { width: "33.33%", height: 80, alignItems: "center", justifyContent: "center", gap: 2 },
  keyMain:        { fontSize: 28, fontWeight: "400", color: "#fff" },
  keySub:         { fontSize: 10, color: "#666", letterSpacing: 1 },
  callRow:        { alignItems: "center", paddingVertical: 16 },
  callBtn:        { width: 72, height: 72, borderRadius: 36, backgroundColor: "#30D158", alignItems: "center", justifyContent: "center" },
  callBtnDisabled:{ backgroundColor: "#1E3A26", opacity: 0.6 },
  callIcon:       { fontSize: 28 },
});
