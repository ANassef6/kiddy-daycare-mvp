import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Button, Screen, usePalette } from "../components";
import { api, ApiError } from "../api";
import { BRANDING_DEFAULTS } from "../config";

// KID-2439: the forced password-change screen. Login routes here before the
// home screen when the account signed in with a temporary/reset password, and
// every mobile data endpoint refuses to serve family data until the flag
// clears, so the app cannot be used around this screen.
export function ChangePasswordScreen({
  forced,
  onChanged,
}: {
  forced: boolean;
  onChanged: () => void;
}) {
  const p = usePalette();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (next.length < 8) {
      setError("The new password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    if (next === current) {
      setError("The new password must be different from the current password.");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next, confirm);
      setCurrent("");
      setNext("");
      setConfirm("");
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the Kiddy server.");
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [styles.input, { borderColor: p.border, color: p.text }];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen>
        <StatusBar style="dark" />
        <View style={styles.top}>
          <View style={[styles.logo, { backgroundColor: p.primary }]}>
            <Text style={styles.logoText}>{BRANDING_DEFAULTS.name[0]}</Text>
          </View>
          <Text style={[styles.title, { color: p.text }]}>Choose a new password</Text>
          <Text style={[styles.subtitle, { color: p.muted }]}>
            {forced
              ? "You signed in with a temporary password. Set your own password to continue."
              : "Enter your current password and choose a new one."}
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={[styles.label, { color: p.muted }]}>Current password</Text>
          <TextInput
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            autoCapitalize="none"
            placeholder="Current password"
            placeholderTextColor="#A9B0BC"
            style={inputStyle}
          />
          <Text style={[styles.label, { color: p.muted }]}>New password</Text>
          <TextInput
            value={next}
            onChangeText={setNext}
            secureTextEntry
            autoCapitalize="none"
            placeholder="At least 8 characters"
            placeholderTextColor="#A9B0BC"
            style={inputStyle}
          />
          <Text style={[styles.label, { color: p.muted }]}>Confirm new password</Text>
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
            placeholder="Repeat the new password"
            placeholderTextColor="#A9B0BC"
            style={inputStyle}
          />

          {error ? <Text style={[styles.error, { color: p.danger }]}>{error}</Text> : null}

          {busy ? (
            <ActivityIndicator color={p.primary} style={styles.spinner} />
          ) : (
            <Button
              title="Save new password"
              onPress={submit}
              color={p.primary}
              disabled={!current || !next || !confirm}
              style={styles.submit}
            />
          )}

          <Text style={[styles.hint, { color: p.muted }]}>
            Your new password cannot be the same as the current one.
          </Text>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: "center", paddingTop: 96, paddingBottom: 28, paddingHorizontal: 24 },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  logoText: { color: "#FFF", fontSize: 30, fontWeight: "800" },
  title: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  subtitle: { fontSize: 13, marginTop: 8, textAlign: "center" },
  form: { paddingHorizontal: 24 },
  label: { fontSize: 13, fontWeight: "600", marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  submit: { marginTop: 24 },
  error: { fontSize: 13, marginTop: 12 },
  spinner: { marginTop: 30 },
  hint: { fontSize: 12, textAlign: "center", marginTop: 18 },
});
