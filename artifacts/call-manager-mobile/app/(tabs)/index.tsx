/**
 * Dialpad screen — main calling interface.
 *
 * - Auto-registers with FreeSWITCH on mount
 * - Full ITU-T dialpad layout
 * - Respects call-forwarding and DND settings from AsyncStorage
 * - Shows network and SIP connection state
 * - Shows last call failure reason inline
 */

import React, { useState, useEffect, useCallback } from "react";
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
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCall } from "@/context/CallContext";
import { useAuth } from "@/context/AuthContext";

const DIALPAD_KEYS: [string, string][] = [
  ["1", ""],    ["2", "ABC"],  ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"],  ["6", "MNO"],
  ["7", "PQRS"],["8", "TUV"],  ["9", "WXYZ"],
  ["*", ""],    ["0", "+"],    ["#", ""],
];

const FWD_ENABLED_KEY = "call_forward_enabled";
const FWD_NUMBER_KEY  = "call_forward_number";
const DND_KEY         = "do_not_disturb";

// ─── Connection badge ─────────────────────────────────────────────────────────

function StatusBadge({ callState, networkState }: { callState: string; networkState: string }) {
  let color: string;
  let label: string;

  if (networkState === "offline") {
    color = "#FF3B30";
    label = "No Network";
  } else if (callState === "registered") {
    color = "#30D158";
    label = "Ready";
  } else if (callState === "registering") {
    color = "#FF9F0A";
    label = "Connecting…";
  } else if (callState === "error") {
    color = "#FF3B30";
    label = "Error";
  } else {
    color = "#666";
    label = "Offline";
  }

  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{label}</Text>
    </View>
  );
}

// ─── Dialpad screen ───────────────────────────────────────────────────────────

export default function DialpadScreen() {
  const { user }                                    = useAuth();
  const { callState, networkState, lastFailureReason, register, makeCall } = useCall();
  const [digits,      setDigits]      = useState("");
  const [registering, setRegistering] = useState(false);
  const [fwdEnabled,  setFwdEnabled]  = useState(false);
  const [fwdNumber,   setFwdNumber]   = useState("");
  const [dndEnabled,  setDndEnabled]  = useState(false);

  // Auto-register on user login
  useEffect(() => {
    if (!user || callState !== "idle") return;
    setRegistering(true);
    register().catch(console.error).finally(() => setRegistering(false));
  }, [user]);

  // Load call settings
  useEffect(() => {
    (async () => {
      const [fwdE, fwdN, dnd] = await Promise.all([
        AsyncStorage.getItem(FWD_ENABLED_KEY),
        AsyncStorage.getItem(FWD_NUMBER_KEY),
        AsyncStorage.getItem(DND_KEY),
      ]);
      setFwdEnabled(fwdE === "true");
      setFwdNumber(fwdN ?? "");
      setDndEnabled(dnd === "true");
    })();
  }, []);

  function pressKey(key: string) {
    Vibration.vibrate(5);
    setDigits((d) => d + key);
  }

  const handleCall = useCallback(async () => {
    const target = digits.trim();
    if (!target) {
      Alert.alert("Enter Number", "Please enter an extension or phone number.");
      return;
    }
    if (networkState === "offline") {
      Alert.alert("No Connection", "You are not connected to the internet.");
      return;
    }
    if (callState !== "registered") {
      Alert.alert("Not Ready", "Still connecting to the server. Please wait a moment.");
      return;
    }
    if (dndEnabled) {
      Alert.alert("Do Not Disturb", "Do Not Disturb is active. Disable it in Settings first.");
      return;
    }

    // Apply call forwarding: dial the forwarding number instead
    const destination = (fwdEnabled && fwdNumber) ? fwdNumber : target;

    try {
      await makeCall(destination);
    } catch (err: any) {
      Alert.alert("Call Failed", err?.message ?? "Could not place the call. Please try again.");
    }
  }, [digits, callState, networkState, dndEnabled, fwdEnabled, fwdNumber, makeCall]);

  const canCall = callState === "registered" && networkState !== "offline" && !dndEnabled;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Dialpad</Text>
          {registering ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color="#FF9F0A" />
              <Text style={[styles.statusText, { color: "#FF9F0A" }]}>Connecting…</Text>
            </View>
          ) : (
            <StatusBadge callState={callState} networkState={networkState} />
          )}
        </View>

        {/* DND / Forward banners */}
        {dndEnabled && (
          <View style={styles.infoBanner}>
            <Feather name="moon" size={14} color="#FF9F0A" />
            <Text style={styles.infoBannerText}>Do Not Disturb is active</Text>
          </View>
        )}
        {fwdEnabled && fwdNumber ? (
          <View style={styles.infoBanner}>
            <Feather name="phone-forwarded" size={14} color="#0A84FF" />
            <Text style={styles.infoBannerText}>Forwarding to {fwdNumber}</Text>
          </View>
        ) : null}

        {/* Last failure reason */}
        {lastFailureReason && (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={14} color="#FF3B30" />
            <Text style={styles.errorText}>{lastFailureReason}</Text>
          </View>
        )}

        {/* Number display */}
        <View style={styles.display}>
          <Text style={styles.displayText} numberOfLines={1}>
            {digits || " "}
          </Text>
          {digits.length > 0 && (
            <TouchableOpacity
              onPress={() => setDigits((d) => d.slice(0, -1))}
              onLongPress={() => setDigits("")}
              activeOpacity={0.6}
              style={styles.backspace}
            >
              <Feather name="delete" size={22} color="#888" />
            </TouchableOpacity>
          )}
        </View>

        {/* Key grid */}
        <View style={styles.grid}>
          {DIALPAD_KEYS.map(([key, sub]) => (
            <TouchableOpacity
              key={key}
              style={styles.key}
              onPress={() => pressKey(key)}
              activeOpacity={0.7}
            >
              <Text style={styles.keyMain}>{key}</Text>
              {sub ? <Text style={styles.keySub}>{sub}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>

        {/* Call button */}
        <View style={styles.callRow}>
          <TouchableOpacity
            style={[styles.callBtn, !canCall && styles.callBtnDisabled]}
            onPress={handleCall}
            disabled={!canCall}
            activeOpacity={0.85}
          >
            <Feather name="phone" size={30} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: "#0A0A0A" },
  container:       { flex: 1, paddingHorizontal: 24, paddingTop: 12 },
  header:          { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title:           { fontSize: 28, fontWeight: "700", color: "#fff" },
  statusRow:       { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot:       { width: 8, height: 8, borderRadius: 4 },
  statusText:      { fontSize: 13, fontWeight: "600" },
  infoBanner:      { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#141414", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginBottom: 6 },
  infoBannerText:  { fontSize: 13, color: "#aaa" },
  errorBanner:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#2A0000", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginBottom: 6, borderWidth: 1, borderColor: "#FF3B3033" },
  errorText:       { flex: 1, fontSize: 13, color: "#FF3B30" },
  display:         { flexDirection: "row", alignItems: "center", justifyContent: "center", minHeight: 64, marginBottom: 4, paddingHorizontal: 16 },
  displayText:     { flex: 1, textAlign: "center", fontSize: 36, fontWeight: "300", color: "#fff", letterSpacing: 4, fontVariant: ["tabular-nums"] },
  backspace:       { padding: 8 },
  grid:            { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", marginBottom: 4 },
  key:             { width: "33.33%", height: 80, alignItems: "center", justifyContent: "center", gap: 2 },
  keyMain:         { fontSize: 28, fontWeight: "400", color: "#fff" },
  keySub:          { fontSize: 10, color: "#666", letterSpacing: 1 },
  callRow:         { alignItems: "center", paddingVertical: 12 },
  callBtn:         { width: 72, height: 72, borderRadius: 36, backgroundColor: "#30D158", alignItems: "center", justifyContent: "center" },
  callBtnDisabled: { backgroundColor: "#1E3A26", opacity: 0.5 },
});
