import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { api, ApiError, clearSession } from "../api";
import { Button, Card, Header, Screen, SectionLabel, usePalette } from "../components";
import { fullName, initials } from "../theme";
import { isoDate, isoDateTime, isoTime, mealSummary } from "../format";
import type { ChildDetailPayload } from "../types";

export function ChildScreen({
  childId,
  onBack,
  onAuthed,
}: {
  childId: string;
  onBack: () => void;
  onAuthed: (boot: import("../types").BootstrapPayload | null) => void;
}) {
  const p = usePalette();
  const [detail, setDetail] = useState<ChildDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api.child(childId));
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
  }, [childId, onAuthed]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async () => {
    if (busy || !detail) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.checkInOut(childId, detail.status.checkedIn && !detail.status.checkedOut ? "out" : "in");
      setDetail({ ...detail, status: next.status, todayReport: next.todayReport ?? detail.todayReport });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update check-in.");
    } finally {
      setBusy(false);
    }
  };

  const report = detail?.todayReport;

  return (
    <Screen>
      <StatusBar style="dark" />
      <Header
        title={detail ? fullName(detail.child.first_name, detail.child.last_name) : "Child"}
        right={
          <Pressable onPress={onBack}>
            <Text style={[styles.back, { color: p.primary }]}>‹ Back</Text>
          </Pressable>
        }
      />

      {loading ? (
        <ActivityIndicator color={p.primary} style={styles.center} />
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {error ? <Text style={[styles.error, { color: p.danger }]}>{error}</Text> : null}

          <Card style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={[styles.avatar, { backgroundColor: p.primary }]}>
                <Text style={styles.avatarText}>
                  {detail ? initials(detail.child.first_name, detail.child.last_name) : "?"}
                </Text>
              </View>
              <View style={styles.statusInfo}>
                <Text style={[styles.room, { color: p.muted }]}>
                  {detail?.child.room_name ?? "Room"}
                </Text>
                <Text style={[styles.statusLine, { color: p.text }]}>
                  {detail?.status.checkedIn
                    ? detail.status.checkedOut
                      ? `Was in at ${isoTime(detail.status.checkedIn)} · out at ${isoTime(detail.status.checkedOut)}`
                      : `With us today · in at ${isoTime(detail.status.checkedIn)}`
                    : "At home today"}
                </Text>
              </View>
            </View>
            <Button
              title={
                detail?.status.checkedIn && !detail?.status.checkedOut
                  ? "Check out"
                  : "Check in"
              }
              onPress={toggle}
              color={detail?.status.checkedIn && !detail?.status.checkedOut ? p.accent : p.primary}
              disabled={busy}
              style={styles.checkBtn}
            />
          </Card>

          {report ? (
            <Card>
              <SectionLabel>Daily report · {isoDate(report.reportDate)}</SectionLabel>
              {report.mood ? (
                <View style={styles.reportRow}>
                  <Text style={[styles.reportKey, { color: p.muted }]}>Mood</Text>
                  <Text style={[styles.reportValue, { color: p.text }]}>{report.mood}</Text>
                </View>
              ) : null}
              {report.summary ? (
                <Text style={[styles.reportText, { color: p.text }]}>{report.summary}</Text>
              ) : null}
              {report.observation ? (
                <View style={styles.reportBlock}>
                  <Text style={[styles.reportKey, { color: p.muted }]}>Teacher's note</Text>
                  <Text style={[styles.reportValue, { color: p.text }]}>{report.observation}</Text>
                </View>
              ) : null}
              {mealSummary(report.meal) ? (
                <View style={styles.reportBlock}>
                  <Text style={[styles.reportKey, { color: p.muted }]}>Meals</Text>
                  <Text style={[styles.reportValue, { color: p.text }]}>{mealSummary(report.meal)}</Text>
                </View>
              ) : null}
              <View style={styles.reportGrid}>
                {typeof report.sleep === "object" && report.sleep && Object.keys(report.sleep).length > 0 ? (
                  <View style={styles.reportBlock}>
                    <Text style={[styles.reportKey, { color: p.muted }]}>Sleep</Text>
                    <Text style={[styles.reportValue, { color: p.text }]}>
                      {formatSleep(report.sleep)}
                    </Text>
                  </View>
                ) : null}
                {report.diaper ? (
                  <View style={styles.reportBlock}>
                    <Text style={[styles.reportKey, { color: p.muted }]}>Diapers</Text>
                    <Text style={[styles.reportValue, { color: p.text }]}>{report.diaper}</Text>
                  </View>
                ) : null}
                {report.sick ? (
                  <View style={styles.reportBlock}>
                    <Text style={[styles.reportKey, { color: p.danger }]}>Feeling unwell</Text>
                    <Text style={[styles.reportValue, { color: p.text }]}>
                      {report.note || "Keep an eye out."}
                    </Text>
                  </View>
                ) : report.note ? (
                  <View style={styles.reportBlock}>
                    <Text style={[styles.reportKey, { color: p.muted }]}>Note</Text>
                    <Text style={[styles.reportValue, { color: p.text }]}>{report.note}</Text>
                  </View>
                ) : null}
              </View>
            </Card>
          ) : (
            <Card>
              <Text style={[styles.empty, { color: p.muted }]}>
                No daily report yet today — teachers post it after pickup.
              </Text>
            </Card>
          )}

          {detail && detail.incidents.length > 0 ? (
            <Card>
              <SectionLabel>Incidents</SectionLabel>
              {detail.incidents.map(inc => (
                <View key={inc.id} style={styles.listRow}>
                  <Text style={[styles.listTitle, { color: p.text }]}>
                    {inc.type}
                    {inc.acknowledged ? "" : "  ·  needs your review"}
                  </Text>
                  <Text style={[styles.reportKey, { color: p.muted }]}>{inc.description}</Text>
                  <Text style={[styles.listMeta, { color: p.muted }]}>{isoDateTime(inc.createdAt)}</Text>
                </View>
              ))}
            </Card>
          ) : null}

          {detail && detail.contacts.length > 0 ? (
            <Card>
              <SectionLabel>Pickup & emergency contacts</SectionLabel>
              {detail.contacts.map(c => (
                <View key={c.id} style={styles.listRow}>
                  <Text style={[styles.listTitle, { color: p.text }]}>{c.fullName}</Text>
                  <Text style={[styles.reportKey, { color: p.muted }]}>
                    {c.relationship}
                    {c.isPickup ? "  ·  pickup" : ""}
                    {c.isEmergency ? "  ·  emergency" : ""}
                  </Text>
                  {c.phone ? (
                    <Text style={[styles.listMeta, { color: p.muted }]}>{c.phone}</Text>
                  ) : null}
                </View>
              ))}
            </Card>
          ) : null}

          {detail && detail.newsfeed.length > 0 ? (
            <Card>
              <SectionLabel>From the classroom</SectionLabel>
              {detail.newsfeed.map(post => (
                <View key={post.id} style={styles.listRow}>
                  <Text style={[styles.listTitle, { color: p.text }]}>
                    {post.authorName ?? "Teacher"}
                  </Text>
                  <Text style={[styles.reportValue, { color: p.text }]}>{post.body}</Text>
                  <Text style={[styles.listMeta, { color: p.muted }]}>{isoDateTime(post.createdAt)}</Text>
                </View>
              ))}
            </Card>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

function formatSleep(sleep: Record<string, unknown>): string {
  const parts = Object.entries(sleep).map(([k, v]) => `${titleCase(k)}: ${String(v)}`);
  return parts.length ? parts.join("  ·  ") : "";
}

function titleCase(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : "";
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  error: { fontSize: 13, marginBottom: 12 },
  back: { fontSize: 15, fontWeight: "700" },
  statusCard: { alignItems: "stretch" },
  statusRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: { color: "#FFF", fontSize: 18, fontWeight: "800" },
  statusInfo: { flex: 1 },
  room: { fontSize: 13, fontWeight: "600" },
  statusLine: { fontSize: 15, fontWeight: "700", marginTop: 2 },
  checkBtn: { marginTop: 4 },
  reportRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  reportBlock: { marginTop: 10 },
  reportGrid: {},
  reportKey: { fontSize: 13, fontWeight: "600", marginBottom: 3 },
  reportValue: { fontSize: 14, color: "#333" },
  reportText: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  empty: { fontSize: 13, lineHeight: 19 },
  listRow: { marginBottom: 12 },
  listTitle: { fontSize: 15, fontWeight: "700" },
  listMeta: { fontSize: 12, marginTop: 2 },
});