import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { useCall } from "@/context/CallContext";
import { apiRequest, getBaseUrl, getToken } from "@/services/api";
import { useFocusEffect } from "@react-navigation/native";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CallRecord {
  id:              string;
  callerNumber?:   string;
  recipientNumber: string;
  callType:        "internal" | "external";
  /** Server uses answered, ringing, cancelled, etc.; legacy clients may send in-progress / no-answer */
  status:          string;
  duration:        number;
  cost?:           number;
  direction?:      "inbound" | "outbound";
  fsCallId?:       string;
  hangupCause?:    string;
  failReason?:     string;
  startedAt?:      string;
  endedAt?:        string;
  createdAt:       string;
}

interface RecordingEntry {
  id:        string;
  path:      string;
  uuid:      string;
  createdAt: string;
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

function formatFullTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isMissedOrFailedStatus(status: string): boolean {
  return (
    status === "missed" ||
    status === "no-answer" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function callIcon(call: CallRecord): { name: string; color: string } {
  if (isMissedOrFailedStatus(call.status)) {
    return { name: "phone-missed", color: "#FF3B30" };
  }
  if (call.direction === "inbound") return { name: "phone-incoming", color: "#30D158" };
  return { name: "phone-outgoing", color: "#0A84FF" };
}

function remoteNumber(call: CallRecord): string {
  return call.direction === "inbound"
    ? (call.callerNumber ?? "Unknown")
    : call.recipientNumber;
}

function directionLabel(call: CallRecord): string {
  if (isMissedOrFailedStatus(call.status)) return "Missed";
  if (call.direction === "inbound") return "Incoming";
  return "Outgoing";
}

// ─── Call row ─────────────────────────────────────────────────────────────────

function CallRow({
  call,
  onCallBack,
  onOpen,
}: {
  call: CallRecord;
  onCallBack: (number: string) => void;
  onOpen: (call: CallRecord) => void;
}) {
  const { name, color } = callIcon(call);
  const number = remoteNumber(call);

  return (
    <TouchableOpacity style={styles.row} onPress={() => onOpen(call)} activeOpacity={0.6}>
      <View style={styles.rowIcon}>
        <Feather name={name as any} size={18} color={color} />
      </View>
      <View style={styles.rowMiddle}>
        <Text style={styles.rowNumber} numberOfLines={1}>{number}</Text>
        <Text style={styles.rowMeta}>
          {call.callType === "external" ? "External" : "Internal"} ·{" "}
          {formatDuration(call.duration)}
          {call.callType === "external" && typeof call.cost === "number" ? ` · ${call.cost} coins` : ""}
          {" "}· {formatTime(call.createdAt)}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.rowCallBtn}
        onPress={() => {
          if (number === "Unknown") return;
          onCallBack(number);
        }}
        activeOpacity={0.7}
      >
        <Feather name="phone" size={18} color="#0A84FF" />
      </TouchableOpacity>
    </TouchableOpacity>
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

// ─── Detail modal ─────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function CallDetailModal({
  call,
  onClose,
  onCallBack,
}: {
  call: CallRecord | null;
  onClose: () => void;
  onCallBack: (number: string) => void;
}) {
  const [recording,  setRecording]  = useState<RecordingEntry | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [playing,    setPlaying]    = useState(false);
  const [progress,   setProgress]   = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);

  const stopPlayback = useCallback(async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync().catch(() => {});
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    setPlaying(false);
    setProgress(0);
  }, []);

  // Look up a matching recording for this call (by FreeSWITCH leg uuid).
  useEffect(() => {
    let cancelled = false;
    setRecording(null);
    setProgress(0);
    if (!call) return;

    (async () => {
      setRecLoading(true);
      try {
        const res = await apiRequest("/recordings");
        if (!res.ok) return;
        const data = await res.json();
        const list: RecordingEntry[] = data.recordings ?? [];
        const norm = (s: string) => s.trim().toLowerCase();
        const wanted = call.fsCallId ? norm(call.fsCallId) : "";
        const match = wanted
          ? list.find((r) => r.uuid && norm(r.uuid) === wanted)
          : undefined;
        if (!cancelled) setRecording(match ?? null);
      } catch {
        /* no recording available */
      } finally {
        if (!cancelled) setRecLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      stopPlayback();
    };
  }, [call, stopPlayback]);

  async function togglePlay() {
    if (!recording) return;
    if (playing) { await stopPlayback(); return; }
    await stopPlayback();
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const token = await getToken();
      const uri = `${getBaseUrl()}/api/recordings/file?path=${encodeURIComponent(recording.path)}`;
      const { sound } = await Audio.Sound.createAsync(
        { uri, headers: token ? { Authorization: `Bearer ${token}` } : undefined },
        { shouldPlay: true },
        (status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) { setPlaying(false); setProgress(0); }
          else if (status.durationMillis) {
            setProgress(status.positionMillis / status.durationMillis);
          }
        },
      );
      soundRef.current = sound;
      setPlaying(true);
    } catch {
      /* swallow — playback errors surface via the button state */
    }
  }

  const number = call ? remoteNumber(call) : "";

  return (
    <Modal
      visible={!!call}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHandle} />

          {call && (
            <>
              <View style={styles.modalHeader}>
                <View style={[styles.rowIcon, styles.modalIcon]}>
                  <Feather name={callIcon(call).name as any} size={22} color={callIcon(call).color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalNumber} numberOfLines={1}>{number}</Text>
                  <Text style={styles.modalSub}>{directionLabel(call)} call</Text>
                </View>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Feather name="x" size={22} color="#888" />
                </TouchableOpacity>
              </View>

              <View style={styles.detailBox}>
                <DetailRow label="Type"     value={call.callType === "external" ? "External" : "Internal"} />
                <DetailRow label="Status"   value={call.status} />
                <DetailRow label="Duration" value={formatDuration(call.duration)} />
                {call.callType === "external" && typeof call.cost === "number" && (
                  <DetailRow label="Cost" value={`${call.cost} coins`} />
                )}
                <DetailRow label="When" value={formatFullTime(call.startedAt ?? call.createdAt)} />
                {call.hangupCause ? <DetailRow label="Hangup" value={call.hangupCause} /> : null}
                {call.failReason ? <DetailRow label="Reason" value={call.failReason} /> : null}
              </View>

              {/* Recording playback */}
              {recLoading ? (
                <View style={styles.recRow}>
                  <ActivityIndicator size="small" color="#0A84FF" />
                  <Text style={styles.recText}>Checking for recording…</Text>
                </View>
              ) : recording ? (
                <TouchableOpacity style={styles.recRow} onPress={togglePlay} activeOpacity={0.7}>
                  <Feather name={playing ? "pause-circle" : "play-circle"} size={26} color="#0A84FF" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recText}>{playing ? "Playing recording…" : "Play recording"}</Text>
                    {playing && (
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ) : (
                <View style={styles.recRow}>
                  <Feather name="mic-off" size={20} color="#555" />
                  <Text style={[styles.recText, { color: "#555" }]}>No recording available</Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.callBackBtn, number === "Unknown" && styles.callBackBtnDisabled]}
                disabled={number === "Unknown"}
                onPress={() => { onClose(); onCallBack(number); }}
                activeOpacity={0.8}
              >
                <Feather name="phone" size={18} color="#fff" />
                <Text style={styles.callBackText}>Call back</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Recents screen ───────────────────────────────────────────────────────────

export default function RecentsScreen() {
  const { makeCall, callState, clearMissedBadges } = useCall();
  const [calls,      setCalls]      = useState<CallRecord[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [selected,   setSelected]   = useState<CallRecord | null>(null);

  const fetchCalls = useCallback(async () => {
    try {
      const res = await apiRequest("/calls?limit=50");
      let data: { calls?: CallRecord[]; error?: string } = {};
      try {
        data = await res.json();
      } catch {
        throw new Error("Invalid response from server");
      }
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

  useFocusEffect(
    useCallback(() => {
      clearMissedBadges();
    }, [clearMissedBadges]),
  );

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
            <CallRow call={item} onCallBack={handleCallBack} onOpen={setSelected} />
          )}
        />
      )}

      <CallDetailModal
        call={selected}
        onClose={() => setSelected(null)}
        onCallBack={handleCallBack}
      />
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

  // Detail modal
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard:     { backgroundColor: "#161618", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 24, paddingTop: 10, paddingBottom: 36 },
  modalHandle:   { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#3A3A3C", marginBottom: 16 },
  modalHeader:   { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  modalIcon:     { width: 44, height: 44, borderRadius: 22 },
  modalNumber:   { fontSize: 20, fontWeight: "700", color: "#fff" },
  modalSub:      { fontSize: 13, color: "#888", marginTop: 2 },
  closeBtn:      { padding: 4 },
  detailBox:     { backgroundColor: "#0A0A0A", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 6, marginBottom: 14 },
  detailRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1F1F1F" },
  detailLabel:   { fontSize: 14, color: "#888" },
  detailValue:   { fontSize: 14, color: "#fff", fontWeight: "500", maxWidth: "60%", textAlign: "right" },
  recRow:        { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#0A0A0A", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 14 },
  recText:       { fontSize: 14, color: "#ddd", fontWeight: "500" },
  progressTrack: { height: 3, borderRadius: 2, backgroundColor: "#2A2A2C", marginTop: 8, overflow: "hidden" },
  progressFill:  { height: 3, borderRadius: 2, backgroundColor: "#0A84FF" },
  callBackBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#0A84FF", borderRadius: 14, paddingVertical: 15 },
  callBackBtnDisabled: { backgroundColor: "#1C1C1E" },
  callBackText:  { fontSize: 16, color: "#fff", fontWeight: "600" },
});
