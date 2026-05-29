import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { useFocusEffect } from "@react-navigation/native";
import { useCall } from "@/context/CallContext";
import { apiRequest } from "@/services/api";

interface Voicemail {
  _id: string;
  fromNumber?: string;
  callerName?: string;
  duration?: number;
  read?: boolean;
  createdAt: string;
  audioUrl?: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDuration(secs?: number): string {
  if (!secs) return "";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function VoicemailScreen() {
  const { startCall } = useCall();
  const [messages, setMessages] = useState<Voicemail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playingProgress, setPlayingProgress] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("/voicemail");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages(data.messages ?? data.data ?? data ?? []);
    } catch (e: any) {
      setError(e.message ?? "Failed to load voicemail");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    return () => { stopPlayback(); };
  }, [load]));

  async function stopPlayback() {
    if (soundRef.current) {
      await soundRef.current.stopAsync().catch(() => {});
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    setPlayingId(null);
    setPlayingProgress(0);
  }

  async function togglePlay(vm: Voicemail) {
    if (playingId === vm._id) { await stopPlayback(); return; }
    await stopPlayback();

    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: vm.audioUrl ?? `/api/voicemail/${vm._id}/download` },
        { shouldPlay: true },
        (status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) { setPlayingId(null); setPlayingProgress(0); }
          else if (status.durationMillis) {
            setPlayingProgress(status.positionMillis / status.durationMillis);
          }
        },
      );
      soundRef.current = sound;
      setPlayingId(vm._id);

      if (!vm.read) {
        apiRequest(`/voicemail/${vm._id}/read`, { method: "POST" }).catch(() => {});
        setMessages((prev) => prev.map((m) => m._id === vm._id ? { ...m, read: true } : m));
      }
    } catch {
      Alert.alert("Playback error", "Could not play voicemail. Check your audio settings.");
    }
  }

  async function deleteMessage(id: string) {
    Alert.alert("Delete voicemail", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (playingId === id) await stopPlayback();
          try {
            await apiRequest(`/voicemail/${id}`, { method: "DELETE" });
            setMessages((prev) => prev.filter((m) => m._id !== id));
          } catch {
            Alert.alert("Error", "Could not delete voicemail.");
          }
        },
      },
    ]);
  }

  function callBack(vm: Voicemail) {
    const num = vm.fromNumber;
    if (!num) { Alert.alert("No number", "Caller number not available."); return; }
    Alert.alert(`Call back ${vm.callerName ?? num}?`, num, [
      { text: "Cancel", style: "cancel" },
      { text: "Call", onPress: () => startCall(num) },
    ]);
  }

  const unread = messages.filter((m) => !m.read).length;

  function renderItem({ item }: { item: Voicemail }) {
    const isPlaying = playingId === item._id;
    const label = item.callerName ?? item.fromNumber ?? "Unknown";

    return (
      <View style={[styles.row, !item.read && styles.rowUnread]}>
        <TouchableOpacity style={styles.playBtn} onPress={() => togglePlay(item)} activeOpacity={0.7}>
          <Feather name={isPlaying ? "pause" : "play"} size={20} color="#fff" />
        </TouchableOpacity>

        <View style={styles.info}>
          <View style={styles.infoTop}>
            <Text style={[styles.from, !item.read && styles.fromUnread]} numberOfLines={1}>
              {label}
            </Text>
            <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
          </View>
          <Text style={styles.meta}>
            {[formatDuration(item.duration), item.read ? "Heard" : "New"]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {isPlaying && (
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${Math.round(playingProgress * 100)}%` }]} />
            </View>
          )}
        </View>

        <View style={styles.actions}>
          {item.fromNumber && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => callBack(item)}>
              <Feather name="phone-call" size={16} color="#30D158" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.actionBtn} onPress={() => deleteMessage(item._id)}>
            <Feather name="trash-2" size={16} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Voicemail</Text>
          {unread > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={load} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="refresh-cw" size={18} color="#666" />
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Feather name="alert-circle" size={15} color="#FF3B30" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#0A84FF" />
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.center}>
          <Feather name="voicemail" size={44} color="#333" />
          <Text style={styles.emptyText}>No voicemail messages</Text>
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#0A0A0A" },
  header:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12 },
  headerLeft:    { flexDirection: "row", alignItems: "center", gap: 10 },
  title:         { fontSize: 28, fontWeight: "700", color: "#fff" },
  badge:         { backgroundColor: "#FF3B30", borderRadius: 12, minWidth: 24, height: 24, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText:     { fontSize: 13, fontWeight: "700", color: "#fff" },
  errorBanner:   { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 8, backgroundColor: "#2A0000", padding: 10, borderRadius: 10 },
  errorText:     { flex: 1, fontSize: 13, color: "#FF3B30" },
  center:        { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyText:     { fontSize: 15, color: "#555" },
  list:          { paddingBottom: 100 },
  row:           { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowUnread:     { backgroundColor: "rgba(10,132,255,0.05)" },
  sep:           { height: 1, backgroundColor: "#1C1C1E" },
  playBtn:       { width: 44, height: 44, borderRadius: 22, backgroundColor: "#0A84FF", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  info:          { flex: 1, minWidth: 0 },
  infoTop:       { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 },
  from:          { fontSize: 16, color: "#aaa", fontWeight: "400", flex: 1 },
  fromUnread:    { color: "#fff", fontWeight: "600" },
  time:          { fontSize: 12, color: "#555", marginLeft: 8, flexShrink: 0 },
  meta:          { fontSize: 13, color: "#555" },
  progressBar:   { height: 3, backgroundColor: "#333", borderRadius: 2, marginTop: 8, overflow: "hidden" },
  progressFill:  { height: "100%", backgroundColor: "#0A84FF", borderRadius: 2 },
  actions:       { flexDirection: "row", gap: 4, flexShrink: 0 },
  actionBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1C1C1E", alignItems: "center", justifyContent: "center" },
});
