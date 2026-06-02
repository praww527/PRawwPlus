import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCall } from "@/context/CallContext";
import { apiRequest } from "@/services/api";
import { displayCaller } from "@/utils/callerIdentity";

interface Contact {
  _id: string;
  name: string;
  phone?: string;
  extension?: string;
  email?: string;
  company?: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function AvatarCircle({ name }: { name: string }) {
  const colors = ["#0A84FF", "#30D158", "#FF9F0A", "#FF453A", "#BF5AF2", "#64D2FF"];
  const idx = name.charCodeAt(0) % colors.length;
  return (
    <View style={[styles.avatar, { backgroundColor: colors[idx] }]}>
      <Text style={styles.avatarText}>{getInitials(name)}</Text>
    </View>
  );
}

export default function ContactsScreen() {
  const { makeCall } = useCall();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filtered, setFiltered] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("/contacts?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: Contact[] = data.contacts ?? data.data ?? data ?? [];
      list.sort((a, b) => a.name.localeCompare(b.name));
      setContacts(list);
      setFiltered(list);
    } catch (e: any) {
      setError(e.message ?? "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function handleSearch(text: string) {
    setSearch(text);
    const q = text.toLowerCase();
    if (!q) { setFiltered(contacts); return; }
    setFiltered(
      contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone?.includes(q) ||
          c.extension?.includes(q) ||
          c.company?.toLowerCase().includes(q),
      ),
    );
  }

  function callContact(c: Contact) {
    const dest = c.extension ?? c.phone;
    if (!dest) { Alert.alert("No number", "This contact has no phone or extension."); return; }
    Alert.alert(
      `Call ${c.name}`,
      displayCaller(dest),
      [
        { text: "Cancel", style: "cancel" },
        { text: "Call", onPress: () => makeCall(dest) },
      ],
    );
  }

  function renderItem({ item }: { item: Contact }) {
    const sub = [item.phone, item.company]
      .filter(Boolean)
      .join(" · ");
    return (
      <TouchableOpacity style={styles.row} onPress={() => callContact(item)} activeOpacity={0.7}>
        <AvatarCircle name={item.name} />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          {sub ? <Text style={styles.sub} numberOfLines={1}>{sub}</Text> : null}
        </View>
        <TouchableOpacity style={styles.callBtn} onPress={() => callContact(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="phone" size={18} color="#0A84FF" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Contacts</Text>
        <TouchableOpacity onPress={load} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="refresh-cw" size={18} color="#666" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Feather name="search" size={16} color="#555" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={handleSearch}
          placeholder="Search name, number, extension…"
          placeholderTextColor="#555"
          clearButtonMode="while-editing"
          autoCapitalize="none"
          autoCorrect={false}
        />
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
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Feather name="users" size={48} color="#3A3A3C" />
          <Text style={styles.emptyTitle}>
            {search ? "No matches" : "No contacts yet"}
          </Text>
          <Text style={styles.emptyText}>
            {search ? "Try a different name or number" : "Your contacts will appear here"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#0A0A0A" },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  title:       { fontSize: 28, fontWeight: "700", color: "#fff" },
  searchWrap:  { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 8, backgroundColor: "#1C1C1E", borderRadius: 12, paddingHorizontal: 12, height: 40 },
  searchIcon:  { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: "#fff", height: "100%" },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 8, backgroundColor: "#2A0000", padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "#FF3B3033" },
  errorText:   { flex: 1, fontSize: 13, color: "#FF3B30" },
  center:      { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingBottom: 60 },
  emptyTitle:  { fontSize: 18, fontWeight: "600", color: "#8E8E93" },
  emptyText:   { fontSize: 14, color: "#636366", textAlign: "center", paddingHorizontal: 40 },
  list:        { paddingBottom: 100 },
  row:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  sep:         { height: 1, backgroundColor: "#1C1C1E", marginLeft: 72 },
  avatar:      { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarText:  { fontSize: 16, fontWeight: "700", color: "#fff" },
  info:        { flex: 1, minWidth: 0 },
  name:        { fontSize: 16, fontWeight: "500", color: "#fff" },
  sub:         { fontSize: 13, color: "#666", marginTop: 2 },
  callBtn:     { padding: 8 },
});
