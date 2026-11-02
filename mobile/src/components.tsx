import React, { createContext, useContext } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { makeTheme, type Palette } from "./theme";
import type { Branding, CheckInStatus } from "./types";
import { isoTime } from "./format";

const ThemeContext = createContext<Palette>(makeTheme({ primaryColor: "#3B82F6", accentColor: "#10B981", name: "Kiddy", logoUrl: null, brandImageUrl: null, font: "Inter" }));

export function ThemeProvider({ branding, children }: { branding: Branding; children: React.ReactNode }) {
  return <ThemeContext.Provider value={makeTheme(branding)}>{children}</ThemeContext.Provider>;
}

export function usePalette(): Palette {
  return useContext(ThemeContext);
}

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const p = usePalette();
  return <View style={[styles.screen, { backgroundColor: p.background }, style]}>{children}</View>;
}

export function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  const p = usePalette();
  return (
    <View style={[styles.header, { borderBottomColor: p.border }]}>
      <Text style={[styles.headerTitle, { color: p.primary }]}>{title}</Text>
      {right}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const p = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: p.card, borderColor: p.border }, style]}>
      {children}
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  const p = usePalette();
  return <Text style={[styles.sectionLabel, { color: p.muted }]}>{children}</Text>;
}

type PillProps = {
  color: string;
  label: string;
};

export function Pill({ color, label }: PillProps) {
  return (
    <View style={[styles.pill, { backgroundColor: `${color}1A` }]}>
      <View style={[styles.pillDot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function StatusPill({ status }: { status: CheckInStatus }) {
  const p = usePalette();
  if (status.checkedIn && !status.checkedOut) {
    return <Pill color={p.ok} label={`Checked in · ${isoTime(status.checkedIn)}`} />;
  }
  if (status.checkedIn && status.checkedOut) {
    return <Pill color={p.muted} label={`In ${isoTime(status.checkedIn)} · Out ${isoTime(status.checkedOut)}`} />;
  }
  return <Pill color={p.muted} label="At home" />;
}

export function Button({
  title,
  onPress,
  color,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  color: string;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: disabled ? p.muted : color, opacity: pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 22, fontWeight: "800" },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  pillText: { fontSize: 12, fontWeight: "700" },
  button: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
});