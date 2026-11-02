import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { api, ApiError, clearSession } from "../api";
import { Card, Header, Pill, Screen, SectionLabel, usePalette } from "../components";
import { isoDate, moneyCents, maskMethod, planPeriod } from "../format";
import type { BillingChild, BillingPayload, Invoice } from "../types";

export function BillingScreen({
  onBack,
  onAuthed,
}: {
  onBack: () => void;
  onAuthed: (boot: import("../types").BootstrapPayload | null) => void;
}) {
  const p = usePalette();
  const [data, setData] = useState<BillingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.billing());
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

  const renderChild = ({ item }: { item: BillingChild }) => (
    <Card>
      <View style={styles.childRow}>
        <Text style={[styles.childName, { color: p.text }]}>
          {item.child.firstName} {item.child.lastName}
        </Text>
        {item.child.roomName ? (
          <Text style={[styles.roomTag, { color: p.muted }]}>{item.child.roomName}</Text>
        ) : null}
      </View>

      {item.plan ? (
        <View style={styles.planRow}>
          <Text style={[styles.planName, { color: p.text }]}>{item.plan.planName}</Text>
          <Text style={[styles.planAmount, { color: p.primary }]}>
            {moneyCents(item.plan.amountCents, item.plan.currency)}
            {item.plan.billingPeriod ? ` / ${planPeriod(item.plan.billingPeriod)}` : ""}
          </Text>
        </View>
      ) : null}

      <SectionLabel>Invoices</SectionLabel>
      {item.invoices.length === 0 ? (
        <Text style={[styles.empty, { color: p.muted }]}>No invoices yet.</Text>
      ) : (
        item.invoices.map((inv: Invoice, idx: number) => (
          <View key={inv.id} style={styles.invoiceRow}>
            <View style={styles.invoiceLeft}>
              <Text style={[styles.invoiceNum, { color: p.text }]}>{inv.number}</Text>
              <Text style={[styles.invoiceMeta, { color: p.muted }]}>
                {inv.dueDate ? `Due ${isoDate(inv.dueDate)}` : "No due date"}
                {inv.description ? `  ·  ${inv.description}` : ""}
              </Text>
            </View>
            <View style={styles.invoiceRight}>
              <Text style={[styles.invoiceAmount, { color: p.text }]}>
                {moneyCents(inv.amountCents, inv.currency)}
              </Text>
              {inv.status === "paid" ? (
                <Pill color={p.ok} label="Paid" />
              ) : inv.status === "issued" ? (
                <Pill color={p.primary} label="Due" />
              ) : (
                <Pill color={p.muted} label={inv.status} />
              )}
            </View>
            {idx < item.invoices.length - 1 ? <View style={[styles.sep, { backgroundColor: p.border }]} /> : null}
          </View>
        ))
      )}

      {item.payments.length > 0 ? (
        <View style={styles.payments}>
          <Text style={[styles.payTitle, { color: p.muted }]}>Payments</Text>
          {item.payments.map(payment => (
            <View key={payment.id} style={styles.payRow}>
              <Text style={[styles.payText, { color: p.text }]}>
                {payment.invoiceNumber}{" "}
                <Text style={{ color: p.muted }}>· {payment.method ?? "card"}</Text>
              </Text>
              <Text style={[styles.payAmt, { color: p.text }]}>
                {moneyCents(payment.amountCents, null)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );

  return (
    <Screen>
      <StatusBar style="dark" />
      <Header
        title="BILLING"
        right={
          <Pressable onPress={onBack}>
            <Text style={[styles.back, { color: p.primary }]}>‹ Back</Text>
          </Pressable>
        }
      />

      {loading ? (
        <ActivityIndicator color={p.primary} style={styles.center} />
      ) : error ? (
        <View style={styles.pad}>
          <Text style={[styles.error, { color: p.danger }]}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={data?.children ?? []}
          keyExtractor={c => c.child.id}
          renderItem={renderChild}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            data && data.paymentMethods.length > 0 ? (
              <Card style={styles.methods}>
                <SectionLabel>Saved payment method</SectionLabel>
                <Text style={[styles.methodText, { color: p.text }]}>
                  {maskMethod(data.paymentMethods[0].label, data.paymentMethods[0].last4)}
                </Text>
                <Text style={[styles.methodHint, { color: p.muted }]}>
                  Used for tuition invoices. Managed by the daycare.
                </Text>
              </Card>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  pad: { padding: 24 },
  error: { fontSize: 14 },
  list: { padding: 16, paddingBottom: 40 },
  back: { fontSize: 15, fontWeight: "700" },
  childRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  childName: { fontSize: 17, fontWeight: "800", flex: 1 },
  roomTag: { fontSize: 13, fontWeight: "600" },
  planRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  planName: { fontSize: 14, fontWeight: "600" },
  planAmount: { fontSize: 15, fontWeight: "800" },
  empty: { fontSize: 13 },
  invoiceRow: { paddingVertical: 6 },
  invoiceLeft: { flex: 1 },
  invoiceNum: { fontSize: 14, fontWeight: "700" },
  invoiceMeta: { fontSize: 12, marginTop: 1 },
  invoiceRight: { marginTop: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  invoiceAmount: { fontSize: 15, fontWeight: "800" },
  sep: { height: 1, marginTop: 10 },
  payments: { marginTop: 14 },
  payTitle: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 },
  payRow: { flexDirection: "row", justifyContent: "space-between", marginVertical: 2 },
  payText: { fontSize: 13 },
  payAmt: { fontSize: 13, fontWeight: "700" },
  methods: {},
  methodText: { fontSize: 15, fontWeight: "700" },
  methodHint: { fontSize: 12, marginTop: 3 },
});