import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { ThemeProvider } from "./src/components";
import { hasSession } from "./src/api";
import { LoginScreen } from "./src/screens/LoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ChildScreen } from "./src/screens/ChildScreen";
import { BillingScreen } from "./src/screens/BillingScreen";
import type { BootstrapPayload } from "./src/types";
import { BRANDING_DEFAULTS } from "./src/config";

type Route = { name: "home" } | { name: "child"; id: string } | { name: "billing" };

export default function App() {
  const [boot, setBoot] = useState<BootstrapPayload | null>(null);
  const [authed, setAuthed] = useState(hasSession());
  const [checkedSession, setCheckedSession] = useState(false);
  const [route, setRoute] = useState<Route>({ name: "home" });

  useEffect(() => {
    setCheckedSession(true);
  }, []);

  if (!checkedSession) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator />
      </View>
    );
  }

  const branding = boot?.branding ?? BRANDING_DEFAULTS;
  const goHome = (next: BootstrapPayload | null) => {
    setBoot(next);
    setAuthed(next !== null);
    setRoute({ name: "home" });
  };

  return (
    <ThemeProvider branding={branding}>
      {!authed ? (
        <LoginScreen onLogin={() => setAuthed(true)} />
      ) : route.name === "child" ? (
        <ChildScreen
          childId={route.id}
          onBack={() => setRoute({ name: "home" })}
          onAuthed={goHome}
        />
      ) : route.name === "billing" ? (
        <BillingScreen onBack={() => setRoute({ name: "home" })} onAuthed={goHome} />
      ) : (
        <HomeScreen
          onAuthed={goHome}
          onOpenChild={id => setRoute({ name: "child", id })}
          onBilling={() => setRoute({ name: "billing" })}
        />
      )}
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: "center", justifyContent: "center" },
});