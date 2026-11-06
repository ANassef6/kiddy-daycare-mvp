"use client";

import { useCallback, useEffect, useState } from "react";

// KID-480: parent settings card for web push permission + subscription, and
// the in-app notification sound opt-out. Degrades cleanly per device:
//   * unsupported browser → static hint, no buttons that can half-work
//   * permission denied → hint + a link-free instruction, server never called
//   * VAPID keys missing → "not configured" hint (graceful server gap)
// Every fetch failure just sets a hint — the settings page never breaks.
type Labels = {
  title: string;
  hint: string;
  enable: string;
  disable: string;
  enabled: string;
  denied: string;
  unsupported: string;
  notConfigured: string;
  testButton: string;
  testSent: string;
  soundLabel: string;
  soundHint: string;
};

type PushState = "unsupported" | "not-configured" | "default" | "denied" | "subscribed";

const SOUND_KEY = "kiddy:notificationSound";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export default function PushNotificationsCard({
  labels,
  className,
}: {
  labels: Labels;
  className?: string;
}) {
  const [state, setState] = useState<PushState>("default");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [soundOn, setSoundOn] = useState(true);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    const supported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    if (!supported) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") setState("denied");
    else setState(Notification.permission === "granted" ? "subscribed" : "default");
    setSoundOn(window.localStorage.getItem(SOUND_KEY) !== "off");
    void (async () => {
      try {
        const keyRes = await fetch("/api/push/public-key", { cache: "no-store" });
        const keyData = (await keyRes.json()) as { publicKey?: unknown };
        if (!keyData.publicKey) {
          setState("not-configured");
          return;
        }
        if (Notification.permission === "granted") {
          const reg = await navigator.serviceWorker.getRegistration("/");
          const existing = await reg?.pushManager.getSubscription();
          if (existing) setState("subscribed");
        }
      } catch (err) {
        console.error("KID-480 push card init failed:", err);
        setState("not-configured");
      }
    })();
  }, []);

  const subscribe = useCallback(async () => {
    setBusy(true);
    setHint("");
    try {
      const keyRes = await fetch("/api/push/public-key", { cache: "no-store" });
      const { publicKey } = (await keyRes.json()) as { publicKey?: unknown };
      if (typeof publicKey !== "string" || !publicKey) {
        setState("not-configured");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      if (!res.ok) throw new Error(`subscribe failed (${res.status})`);
      setState("subscribed");
    } catch (err) {
      console.error("KID-480 push subscribe failed:", err);
      setHint(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    setHint("");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch((err) => console.error("KID-480 browser unsubscribe failed:", err));
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      setState("default");
    } catch (err) {
      console.error("KID-480 push unsubscribe failed:", err);
      setHint(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  }, []);

  const sendTest = useCallback(async () => {
    setBusy(true);
    setHint("");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `test failed (${res.status})`);
      }
      setTested(true);
    } catch (err) {
      console.error("KID-480 test push failed:", err);
      setHint(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleSound = useCallback((on: boolean) => {
    setSoundOn(on);
    try {
      window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {
      // Private mode: the toggle simply does not persist.
    }
  }, []);

  return (
    <div className={className} data-testid="push-notifications-card">
      <h3 className="subtitle">{labels.title}</h3>
      <p className="small muted">{labels.hint}</p>
      {state === "unsupported" && <p className="small">{labels.unsupported}</p>}
      {state === "not-configured" && <p className="small">{labels.notConfigured}</p>}
      {state === "denied" && <p className="small">{labels.denied}</p>}
      {(state === "default" || state === "subscribed") && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {state === "default" ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={subscribe}>
              {labels.enable}
            </button>
          ) : (
            <>
              <span className="small" style={{ fontWeight: 700 }}>
                {labels.enabled}
              </span>
              <button type="button" className="btn btn-ghost small" disabled={busy} onClick={sendTest}>
                {labels.testButton}
              </button>
              {tested && (
                <span className="small" role="status">
                  {labels.testSent}
                </span>
              )}
              <button type="button" className="btn btn-ghost small" disabled={busy} onClick={unsubscribe}>
                {labels.disable}
              </button>
            </>
          )}
        </div>
      )}
      {hint && (
        <p className="small muted" role="alert">
          {hint}
        </p>
      )}
      <label className="small" style={{ display: "block", marginTop: 12 }}>
        <input
          type="checkbox"
          checked={soundOn}
          onChange={(e) => toggleSound(e.target.checked)}
          style={{ marginRight: 8 }}
        />
        {labels.soundLabel}
      </label>
      <p className="small muted">{labels.soundHint}</p>
    </div>
  );
}
