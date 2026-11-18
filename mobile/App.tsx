import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { ThemeProvider } from "./src/components";
import { hasSession, restoreSession } from "./src/api";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ChangePasswordScreen } from "./src/screens/ChangePasswordScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ChildScreen } from "./src/screens/ChildScreen";
import { BillingScreen } from "./src/screens/BillingScreen";
import type { BootstrapPayload } from "./src/types";
import { BRANDING_DEFAULTS } from "./src/config";

type Route = { name: "home" } | { name: "child"; id: string } | { name: "billing" };

export default function App() {
  const [boot, setBoot] = useState<BootstrapPayload | null>(null);
  const [authed, setAuthed] = useState(false);
  const [checkedSession, setCheckedSession] = useState(false);
  // KID-2439: a temporary/reset password must be replaced before the app
  // surface. The server also refuses data endpoints while this is set.
  const [mustChange, setMustChange] = useState(false);
  const [route, setRoute] = useState<Route>({ name: "home" });

  useEffect(() => {
    // KID-686: restore the persisted 30-day session token before the first
    // auth decision, so a cold start resumes the previous session instead of
    // always rendering the login screen.
    let cancelled = false;
    restoreSession().then(() => {
      if (!cancelled) {
        setAuthed(hasSession());
        setCheckedSession(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Stable callbacks: HomeScreen lists these in its fetch effect's deps, and
  // an inline identity would re-run the bootstrap request on every render.
  // They must stay above the boot early return so the hook order is stable.
  const goHome = useCallback((next: BootstrapPayload | null) => {
    setBoot(next);
    setAuthed(next !== null);
    if (next === null) setMustChange(false);
    setRoute({ name: "home" });
  }, []);
  const requirePasswordChange = useCallback(() => setMustChange(true), []);

  if (!checkedSession) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator />
      </View>
    );
  }

  const branding = boot?.branding ?? BRANDING_DEFAULTS;

  return (
    <ThemeProvider branding={branding}>
      {!authed ? (
        <LoginScreen
          onLogin={body => {
            setMustChange(!!body.account.mustChangePassword);
            setAuthed(true);
          }}
        />
      ) : mustChange ? (
        <ChangePasswordScreen
          forced
          onChanged={() => {
            setMustChange(false);
            setRoute({ name: "home" });
          }}
        />
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
          onPasswordChangeRequired={requirePasswordChange}
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
