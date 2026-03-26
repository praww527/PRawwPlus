import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useCall } from "@/context/CallContext";
import { apiRequest } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CallRecord {
  id:              string;
  callerNumber?:   string;
  recipientNumber: string;
  callType:        "internal" | "external";
  status:          "initiated" | "in-progress" | "completed" | "missed" | "failed" | "no-answer";
  duration:        number;
  direction?:      "inbound" | "outbound";
  createdAt:       string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(secs: number): string {
  if (secs <= 0) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isSameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (isSameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function callIcon(call: CallRecord): { name: string; color: string } {
  const missed = call.status === "missed" || call.status === "no-answer" || call.status === "failed";
  if (missed) return { name: "phone-missed", color: "#FF3B30" };
  if (call.direction === "inbound") return { name: "phone-incoming", color: "#30D158" };
  return { name: "phone-outgoing", color: "#0A84FF" };
}

// ─── Call row ─────────────────────────────────────────────────────────────────

function CallRow({
  call,
  onCallBack,
}: {
  call: CallRecord;
  onCallBack: (number: string) => void;
}) {
  const { name, color } = callIcon(call);
  const number = call.direction === "inbound"
    ? (call.callerNumber ?? "Unknown")
    : call.recipientNumber;

  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Feather name={name as any} size={18} color={color} />
      </View>
      <View style={styles.rowMiddle}>
        <Text style={styles.rowNumber} numberOfLines={1}>{number}</Text>
        <Text style={styles.rowMeta}>
          {call.callType === "external" ? "External" : "Internal"} ·{" "}
          {formatDuration(call.duration)} · {formatTime(call.createdAt)}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.rowCallBtn}
        onPress={() => onCallBack(call.recipientNumber)}
        activeOpacity={0.7}
      >
        <Feather name="phone" size={18} color="#0A84FF" />
      </TouchableOpacity>
    </View>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <View style={styles.empty}>
      <Feather name="phone-missed" size={48} color="#444" />
      <Text style={styles.emptyTitle}>No recent calls</Text>
      <Text style={styles.emptyText}>Your call history will appear here</Text>
    </View>
  );
}

// ─── Recents screen ───────────────────────────────────────────────────────────

export default function RecentsScreen() {
  const { makeCall, callState } = useCall();
  const [calls,      setCalls]      = useState<CallRecord[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const fetchCalls = useCallback(async () => {
    try {
      const res  = await apiRequest("/calls?limit=50");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load call history");
      setCalls(data.calls ?? []);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load calls");
    }
  }, []);

  useEffect(() => {
    fetchCalls().finally(() => setLoading(false));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchCalls();
    setRefreshing(false);
  }, [fetchCalls]);

  async function handleCallBack(number: string) {
    if (callState !== "registered") return;
    try {
      await makeCall(number);
    } catch (err: any) {
      // Error is handled by CallContext
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Recents</Text>
      </View>

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#0A84FF" />
        </View>
      ) : error ? (
        <View style={styles.empty}>
          <Feather name="alert-circle" size={40} color="#FF3B30" />
          <Text style={styles.emptyTitle}>Failed to load</Text>
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); fetchCalls().finally(() => setLoading(false)); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={calls}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<EmptyState />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#0A84FF"
            />
          }
          renderItem={({ item }) => (
            <CallRow call={item} onCallBack={handleCallBack} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#0A0A0A" },
  header:      { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  title:       { fontSize: 28, fontWeight: "700", color: "#fff" },
  list:        { flexGrow: 1 },
  loaderWrap:  { flex: 1, alignItems: "center", justifyContent: "center" },
  empty:       { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyTitle:  { fontSize: 18, fontWeight: "600", color: "#888" },
  emptyText:   { fontSize: 14, color: "#555", textAlign: "center", paddingHorizontal: 40 },
  retryBtn:    { marginTop: 8, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: "#1C1C1E", borderRadius: 10 },
  retryText:   { fontSize: 14, color: "#0A84FF", fontWeight: "600" },
  row:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#141414" },
  rowIcon:     { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1C1C1E", alignItems: "center", justifyContent: "center", marginRight: 12 },
  rowMiddle:   { flex: 1, gap: 3 },
  rowNumber:   { fontSize: 16, color: "#fff", fontWeight: "500" },
  rowMeta:     { fontSize: 12, color: "#555" },
  rowCallBtn:  { padding: 10 },
});
