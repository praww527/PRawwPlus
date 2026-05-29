import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  TextInput,
  Switch,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/context/AuthContext";
import { useCall } from "@/context/CallContext";
import { apiRequest } from "@/services/api";

// ─── Storage keys ─────────────────────────────────────────────────────────────
// DND and Call Waiting are device-local preferences. Call forwarding is the
// source-of-truth on the server (GET/PATCH /api/users/call-forwarding).

const DND_KEY = "do_not_disturb";
const CW_KEY  = "call_waiting_enabled";

// ─── Call-forwarding model ────────────────────────────────────────────────────

type FwdMode = "always" | "busy" | "noAnswer";

interface FwdState { enabled: boolean; to: string }

const FWD_MODES: { key: FwdMode; icon: string; label: string }[] = [
  { key: "always",   icon: "phone-forwarded",  label: "Always Forward" },
  { key: "busy",     icon: "phone-off",         label: "Forward When Busy" },
  { key: "noAnswer", icon: "phone-missed",      label: "Forward On No Answer" },
];

const FWD_FIELDS: Record<FwdMode, { enabled: string; to: string }> = {
  always:   { enabled: "callForwardAlwaysEnabled",   to: "callForwardAlwaysTo" },
  busy:     { enabled: "callForwardBusyEnabled",     to: "callForwardBusyTo" },
  noAnswer: { enabled: "callForwardNoAnswerEnabled", to: "callForwardNoAnswerTo" },
};

// ─── Setting row component ────────────────────────────────────────────────────

function SettingRow({
  icon,
  label,
  value,
  onPress,
  rightElement,
  destructive = false,
  disabled = false,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={disabled ? undefined : onPress}
      activeOpacity={onPress && !disabled ? 0.7 : 1}
    >
      <View style={styles.rowLeft}>
        <Feather
          name={icon as any}
          size={20}
          color={disabled ? "#444" : destructive ? "#FF3B30" : "#888"}
        />
        <Text style={[styles.rowLabel, destructive && { color: "#FF3B30" }, disabled && { color: "#444" }]}>
          {label}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {rightElement ?? null}
        {onPress && !rightElement ? <Feather name="chevron-right" size={18} color="#444" /> : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

// ─── Settings screen ──────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { user, logout, pushEnabled, enablePush, disablePush } = useAuth();
  const { callState, unregister, networkState, lastFailureReason } = useCall();

  const [fwd, setFwd] = useState<Record<FwdMode, FwdState>>({
    always:   { enabled: false, to: "" },
    busy:     { enabled: false, to: "" },
    noAnswer: { enabled: false, to: "" },
  });
  const [fwdLoading, setFwdLoading] = useState(true);
  const [fwdError,   setFwdError]   = useState<string | null>(null);
  const [editing,    setEditing]    = useState<FwdMode | null>(null);
  const [editInput,  setEditInput]  = useState("");
  const [saving,     setSaving]     = useState(false);

  const [dndEnabled, setDndEnabled] = useState(false);
  const [cwEnabled,  setCwEnabled]  = useState(true);

  // ── Load forwarding state from the server + device-local prefs ──
  const loadForwarding = useCallback(async () => {
    setFwdLoading(true);
    setFwdError(null);
    try {
      const res = await apiRequest("/users/call-forwarding");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setFwd({
        always:   { enabled: !!d.callForwardAlwaysEnabled,   to: d.callForwardAlwaysTo ?? "" },
        busy:     { enabled: !!d.callForwardBusyEnabled,     to: d.callForwardBusyTo ?? "" },
        noAnswer: { enabled: !!d.callForwardNoAnswerEnabled, to: d.callForwardNoAnswerTo ?? "" },
      });
    } catch (e: any) {
      setFwdError(e?.message ?? "Failed to load call forwarding");
    } finally {
      setFwdLoading(false);
    }
  }, []);

  useEffect(() => {
    loadForwarding();
    (async () => {
      const [dnd, cw] = await Promise.all([
        AsyncStorage.getItem(DND_KEY),
        AsyncStorage.getItem(CW_KEY),
      ]);
      setDndEnabled(dnd === "true");
      setCwEnabled(cw !== "false"); // default on
    })();
  }, [loadForwarding]);

  // ── Persist a forwarding change to the server ──
  async function patchForwarding(mode: FwdMode, next: FwdState) {
    const fields = FWD_FIELDS[mode];
    const body: Record<string, unknown> = {
      [fields.enabled]: next.enabled,
      [fields.to]: next.to || null,
    };
    setSaving(true);
    const prev = fwd[mode];
    setFwd((s) => ({ ...s, [mode]: next })); // optimistic
    try {
      const res = await apiRequest("/users/call-forwarding", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json()).error ?? msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
    } catch (e: any) {
      setFwd((s) => ({ ...s, [mode]: prev })); // rollback
      Alert.alert("Could not save", e?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function toggleFwd(mode: FwdMode, val: boolean) {
    const current = fwd[mode];
    // Enabling a mode with no destination yet → open the number editor first.
    if (val && !current.to) {
      setEditing(mode);
      setEditInput("");
      return;
    }
    patchForwarding(mode, { ...current, enabled: val });
  }

  function saveFwdNumber() {
    if (!editing) return;
    const num = editInput.trim();
    if (!num) {
      Alert.alert("Invalid Number", "Please enter a valid destination number.");
      return;
    }
    const mode = editing;
    setEditing(null);
    patchForwarding(mode, { enabled: true, to: num });
  }

  // ── DND / Call waiting (device-local) ──

  async function toggleDnd(val: boolean) {
    setDndEnabled(val);
    await AsyncStorage.setItem(DND_KEY, String(val));
  }

  async function toggleCw(val: boolean) {
    setCwEnabled(val);
    await AsyncStorage.setItem(CW_KEY, String(val));
  }

  // ── Push ──

  async function handleTogglePush() {
    if (pushEnabled) {
      await disablePush();
    } else {
      const ok = await enablePush();
      if (!ok) Alert.alert("Permission Required", "Please enable notifications in device settings.");
    }
  }

  // ── Logout ──

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

  const sipColor  = callState === "registered"
    ? "#30D158"
    : callState === "registering"
      ? "#FF9F0A"
      : "#666";
  const sipStatus = callState === "registered"
    ? "Connected"
    : callState === "registering"
      ? "Connecting…"
      : "Offline";

  const netColor  = networkState === "online" ? "#30D158" : networkState === "offline" ? "#FF3B30" : "#666";
  const netLabel  = networkState === "online" ? "Online" : networkState === "offline" ? "Offline" : "Unknown";

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
        </View>

        {/* Profile */}
        {user && (
          <View style={styles.profile}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(user.name?.[0] ?? user.username?.[0] ?? "?").toUpperCase()}
              </Text>
            </View>
            <View>
              <Text style={styles.profileName}>{user.name ?? user.username}</Text>
              <Text style={styles.profileSub}>Signed in</Text>
            </View>
          </View>
        )}

        {/* Last failure reason */}
        {lastFailureReason && (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={16} color="#FF3B30" />
            <Text style={styles.errorText}>{lastFailureReason}</Text>
          </View>
        )}

        {/* Connection */}
        <View style={styles.section}>
          <SectionHeader title="Connection" />
          <SettingRow
            icon="wifi"
            label="Network"
            value={netLabel}
            rightElement={<View style={[styles.dot, { backgroundColor: netColor }]} />}
          />
          <SettingRow
            icon="phone"
            label="SIP Status"
            value={sipStatus}
            rightElement={<View style={[styles.dot, { backgroundColor: sipColor }]} />}
          />
        </View>

        {/* Call forwarding */}
        <View style={styles.section}>
          <SectionHeader title="Call Forwarding" />

          {fwdLoading ? (
            <View style={styles.fwdLoading}>
              <ActivityIndicator size="small" color="#0A84FF" />
              <Text style={styles.fwdLoadingText}>Loading…</Text>
            </View>
          ) : fwdError ? (
            <SettingRow
              icon="alert-circle"
              label={fwdError}
              value="Retry"
              onPress={loadForwarding}
              destructive
            />
          ) : (
            FWD_MODES.map(({ key, icon, label }) => {
              const state = fwd[key];
              return (
                <View key={key}>
                  <SettingRow
                    icon={icon}
                    label={label}
                    disabled={saving}
                    rightElement={
                      <Switch
                        value={state.enabled}
                        onValueChange={(v) => toggleFwd(key, v)}
                        disabled={saving}
                        trackColor={{ false: "#333", true: "#0A84FF" }}
                        thumbColor="#fff"
                      />
                    }
                  />
                  {state.enabled && editing !== key && state.to ? (
                    <SettingRow
                      icon="corner-right-down"
                      label="Forward to"
                      value={state.to}
                      onPress={() => { setEditing(key); setEditInput(state.to); }}
                    />
                  ) : null}
                  {editing === key && (
                    <View style={styles.fwdInputWrap}>
                      <TextInput
                        style={styles.fwdInput}
                        value={editInput}
                        onChangeText={setEditInput}
                        placeholder="Enter destination number"
                        placeholderTextColor="#555"
                        keyboardType="phone-pad"
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={saveFwdNumber}
                      />
                      <TouchableOpacity style={styles.fwdSaveBtn} onPress={saveFwdNumber}>
                        <Text style={styles.fwdSaveText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>

        {/* Other call features */}
        <View style={styles.section}>
          <SectionHeader title="Call Features" />

          {/* Call Waiting */}
          <SettingRow
            icon="phone-incoming"
            label="Call Waiting"
            rightElement={
              <Switch
                value={cwEnabled}
                onValueChange={toggleCw}
                trackColor={{ false: "#333", true: "#0A84FF" }}
                thumbColor="#fff"
              />
            }
          />

          {/* Do Not Disturb */}
          <SettingRow
            icon="moon"
            label="Do Not Disturb"
            rightElement={
              <Switch
                value={dndEnabled}
                onValueChange={toggleDnd}
                trackColor={{ false: "#333", true: "#FF9F0A" }}
                thumbColor="#fff"
              />
            }
          />
        </View>

        {/* Notifications */}
        <View style={styles.section}>
          <SectionHeader title="Notifications" />
          <SettingRow
            icon="bell"
            label={pushEnabled ? "Push Notifications" : "Push Disabled"}
            value={pushEnabled ? "On" : "Off"}
            onPress={handleTogglePush}
          />
        </View>

        {/* Account */}
        <View style={styles.section}>
          <SectionHeader title="Account" />
          <SettingRow
            icon="log-out"
            label="Sign Out"
            onPress={handleLogout}
            destructive
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#0A0A0A" },
  scroll:       { paddingBottom: 120 },
  header:       { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  title:        { fontSize: 28, fontWeight: "700", color: "#fff" },
  profile:      { flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 24, paddingVertical: 20 },
  avatar:       { width: 56, height: 56, borderRadius: 28, backgroundColor: "#0A84FF", alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 24, fontWeight: "700", color: "#fff" },
  profileName:  { fontSize: 18, fontWeight: "600", color: "#fff" },
  profileSub:   { fontSize: 13, color: "#666", marginTop: 2 },
  errorBanner:  { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#2A0000", marginHorizontal: 24, marginBottom: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#FF3B3044" },
  errorText:    { flex: 1, fontSize: 13, color: "#FF3B30" },
  section:      { marginTop: 24, paddingHorizontal: 24 },
  sectionTitle: { fontSize: 12, fontWeight: "600", color: "#666", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  row:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1C1C1E" },
  rowDisabled:  { opacity: 0.4 },
  rowLeft:      { flexDirection: "row", alignItems: "center", gap: 12 },
  rowRight:     { flexDirection: "row", alignItems: "center", gap: 8 },
  rowLabel:     { fontSize: 16, color: "#fff" },
  rowValue:     { fontSize: 14, color: "#888" },
  dot:          { width: 10, height: 10, borderRadius: 5 },
  fwdLoading:   { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  fwdLoadingText: { fontSize: 14, color: "#888" },
  fwdInputWrap: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: "#1C1C1E" },
  fwdInput:     { flex: 1, backgroundColor: "#1C1C1E", color: "#fff", fontSize: 16, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  fwdSaveBtn:   { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#0A84FF", borderRadius: 10 },
  fwdSaveText:  { fontSize: 14, fontWeight: "700", color: "#fff" },
});
