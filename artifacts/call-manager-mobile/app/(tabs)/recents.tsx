import React from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

// Placeholder recents screen — wire to call history API in a future iteration
function EmptyState() {
  return (
    <View style={styles.empty}>
      <Feather name="phone-missed" size={48} color="#444" />
      <Text style={styles.emptyTitle}>No recent calls</Text>
      <Text style={styles.emptyText}>Your call history will appear here</Text>
    </View>
  );
}

export default function RecentsScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Recents</Text>
      </View>
      <FlatList
        data={[]}
        ListEmptyComponent={<EmptyState />}
        contentContainerStyle={styles.list}
        renderItem={() => null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#0A0A0A" },
  header:     { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
  title:      { fontSize: 28, fontWeight: "700", color: "#fff" },
  list:       { flex: 1 },
  empty:      { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: "#888" },
  emptyText:  { fontSize: 14, color: "#555", textAlign: "center", paddingHorizontal: 40 },
});
