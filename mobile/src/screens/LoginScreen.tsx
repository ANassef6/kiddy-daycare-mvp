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

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const p = usePalette();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(email.trim().toLowerCase(), password);
      onLogin();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the Kiddy server.");
    } finally {
      setBusy(false);
    }
  };

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
          <Text style={[styles.appName, { color: p.primary }]}>{BRANDING_DEFAULTS.name}</Text>
          <Text style={[styles.tagline, { color: p.muted }]}>
            Daily care, right from your pocket.
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={[styles.label, { color: p.muted }]}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor="#A9B0BC"
            style={[styles.input, { borderColor: p.border, color: p.text }]}
          />
          <Text style={[styles.label, { color: p.muted }]}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor="#A9B0BC"
            style={[styles.input, { borderColor: p.border, color: p.text }]}
          />

          {error ? <Text style={[styles.error, { color: p.danger }]}>{error}</Text> : null}

          {busy ? (
            <ActivityIndicator color={p.primary} style={styles.spinner} />
          ) : (
            <Button
              title="Sign in"
              onPress={submit}
              color={p.primary}
              disabled={!email.trim() || !password}
              style={styles.submit}
            />
          )}

          <Text style={[styles.hint, { color: p.muted }]}>
            Use the daycare sign-in details from your child portal.
          </Text>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  top: {
    alignItems: "center",
    paddingTop: 96,
    paddingBottom: 40,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  logoText: { color: "#FFF", fontSize: 30, fontWeight: "800" },
  appName: { fontSize: 26, fontWeight: "800" },
  tagline: { fontSize: 14, marginTop: 6 },
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