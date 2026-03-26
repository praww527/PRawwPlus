import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";

function SettingRow({
  icon,
  label,
  value,
  onPress,
  destructive = false,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={styles.rowLeft}>
        <Feather name={icon as any} size={20} color={destructive ? "#FF3B30" : "#888"} />
        <Text style={[styles.rowLabel, destructive && { color: "#FF3B30" }]}>{label}</Text>
      </View>
      {value && <Text style={styles.rowValue}>{value}</Text>}
      {onPress && <Feather name="chevron-right" size={18} color="#444" />}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { user, logout, pushEnabled, enablePush, disablePush } = useAuth();
  const { callState, unregister }                              = useCall();

  async function handleLogout() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await unregister().catch(() => {});
          await logout();
        },
      },
    ]);
  }

  async function handleTogglePush() {
    if (pushEnabled) {
      await disablePush();
    } else {
      const ok = await enablePush();
      if (!ok) Alert.alert("Permission Required", "Please enable notifications in device settings.");
    }
  }

  const sipStatus = callState === "registered" ? "Connected" : callState === "registering" ? "Connecting…" : "Offline";
  const sipColor  = callState === "registered" ? "#30D158" : callState === "registering" ? "#FF9F0A" : "#666";

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
        </View>

        {user && (
          <View style={styles.profile}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {user.name?.[0] ?? user.username?.[0] ?? "?"}
              </Text>
            </View>
            <View>
              <Text style={styles.profileName}>{user.name ?? user.username}</Text>
              <Text style={styles.profileSub}>Signed in</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connection</Text>
          <SettingRow icon="wifi" label="SIP Status" value={sipStatus} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <SettingRow
            icon="bell"
            label={pushEnabled ? "Push Enabled" : "Push Disabled"}
            onPress={handleTogglePush}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <SettingRow icon="log-out" label="Sign Out" onPress={handleLogout} destructive />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#0A0A0A" },
  scroll:       { paddingBottom: 100 },
  header:       { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  title:        { fontSize: 28, fontWeight: "700", color: "#fff" },
  profile:      { flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 24, paddingVertical: 20 },
  avatar:       { width: 56, height: 56, borderRadius: 28, backgroundColor: "#0A84FF", alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 24, fontWeight: "700", color: "#fff", textTransform: "uppercase" },
  profileName:  { fontSize: 18, fontWeight: "600", color: "#fff" },
  profileSub:   { fontSize: 13, color: "#666", marginTop: 2 },
  section:      { marginTop: 24, paddingHorizontal: 24 },
  sectionTitle: { fontSize: 12, fontWeight: "600", color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  row:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#1C1C1E" },
  rowLeft:      { flexDirection: "row", alignItems: "center", gap: 12 },
  rowLabel:     { fontSize: 16, color: "#fff" },
  rowValue:     { fontSize: 14, color: "#888" },
});
