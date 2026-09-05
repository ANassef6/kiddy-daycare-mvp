import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { api, ApiError, clearSession } from "../api";
import { Card, Header, Screen, SectionLabel, StatusPill, usePalette } from "../components";
import { fullName, initials } from "../theme";
import type { BootstrapPayload, ChildSummary } from "../types";

export function HomeScreen({
  onAuthed,
  onOpenChild,
  onBilling,
}: {
  onAuthed: (boot: BootstrapPayload | null) => void;
  onOpenChild: (id: string) => void;
  onBilling: () => void;
}) {
  const p = usePalette();
  const [boot, setBoot] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.bootstrap();
      setBoot(data);
      onAuthed(data);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clearSession();
        onAuthed(null);
        return;
      }
      setError(e instanceof ApiError ? e.message : "Could not reach the Kiddy server.");
    } finally {
      setLoading(false);
    }
  }, [onAuthed]);

  useEffect(() => {
    load();
  }, [load]);

  const renderChild = ({ item }: { item: ChildSummary }) => (
    <Pressable onPress={() => onOpenChild(item.child.id)}>
      <Card style={styles.childCard}>
        <View style={[styles.avatar, { backgroundColor: p.primary }]}>
          <Text style={styles.avatarText}>
            {initials(item.child.first_name, item.child.last_name)}
          </Text>
        </View>
        <View style={styles.childInfo}>
          <Text style={[styles.childName, { color: p.text }]}>
            {fullName(item.child.first_name, item.child.last_name)}
          </Text>
          <Text style={[styles.room, { color: p.muted }]}>
            {item.child.room_name ?? "Room"}
            {item.todayReport ? "  ·  Daily report ready" : "  ·  No report today"}
          </Text>
          <View style={styles.pillRow}>
            <StatusPill status={item.status} />
          </View>
        </View>
        <Text style={[styles.chevron, { color: p.muted }]}>›</Text>
      </Card>
    </Pressable>
  );

  if (loading) {
    return (
      <Screen>
        <StatusBar style="dark" />
        <ActivityIndicator color={p.primary} style={styles.center} />
      </Screen>
    );
  }

  return (
    <Screen>
      <StatusBar style="dark" />
      <Header
        title={(boot?.branding.name ?? "Kiddy").toUpperCase()}
        right={
          <View style={styles.headerRight}>
            <Pressable onPress={onBilling} style={[styles.billingBtn, { borderColor: p.border }]}>
              <Text style={[styles.billingText, { color: p.primary }]}>Billing</Text>
            </Pressable>
            <Pressable onPress={() => { clearSession(); onAuthed(null); }}>
              <Text style={[styles.logout, { color: p.muted }]}>Sign out</Text>
            </Pressable>
          </View>
        }
      />

      {error ? (
        <View style={styles.centerPad}>
          <Text style={[styles.error, { color: p.danger }]}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={boot?.children ?? []}
          keyExtractor={c => c.child.id}
          renderItem={renderChild}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View>
              <SectionLabel>My children</SectionLabel>
              {boot?.account.fullName ? (
                <Text style={[styles.greeting, { color: p.muted }]}>
                  Hello, {boot.account.fullName.split(" ")[0]}
                </Text>
              ) : null}
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  centerPad: { padding: 24 },
  error: { fontSize: 14 },
  list: { padding: 16 },
  greeting: { fontSize: 14, marginBottom: 14 },
  childCard: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: { color: "#FFF", fontSize: 17, fontWeight: "800" },
  childInfo: { flex: 1 },
  childName: { fontSize: 17, fontWeight: "700" },
  room: { fontSize: 13, marginTop: 2 },
  pillRow: { marginTop: 8 },
  chevron: { fontSize: 26, fontWeight: "300", marginLeft: 8 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  billingBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  billingText: { fontSize: 13, fontWeight: "700" },
  logout: { fontSize: 13, fontWeight: "600" },
});