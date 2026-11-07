"use client";

import { useEffect, useRef } from "react";

// KID-480: in-app notification sound. While the app stays open, a tiny poll
// notices new unread notifications and plays the bundled WAV once. The sound
// is opt-out (localStorage kiddy:notificationSound === "off") and every
// failure path degrades silently-safe: Audio errors and fetch errors are
// logged, never thrown.
// KID-685: the loop lives in startNotificationSoundWatcher so both shells
// mount the same watcher and the one-sound-attempt behavior stays testable;
// note a browser will only actually play audio after a prior user interaction
// on the page, and a hidden/background tab may stay silent regardless.
const POLL_MS = 45_000;

export function startNotificationSoundWatcher(deps: {
  audioFactory: () => Pick<HTMLAudioElement, "play" | "onended" | "onerror">;
  fetchFn: typeof fetch;
  getSoundPref: () => string | null;
  setLastUnread: (count: string) => void;
  getLastUnread: () => string | null;
}): () => void {
  const { audioFactory, fetchFn, getSoundPref, setLastUnread, getLastUnread } = deps;
  let playing = false;
  let last: number | null = null;
  const stored = getLastUnread();
  last = stored === null ? null : Number(stored);

  const playSound = () => {
    if (playing) return;
    if (getSoundPref() === "off") return;
    playing = true;
    try {
      const audio = audioFactory();
      audio.onended = () => {
        playing = false;
      };
      audio.onerror = () => {
        console.error("KID-480 in-app notification sound failed to load");
        playing = false;
      };
      audio.play().catch((err) => console.error("KID-480 in-app notification sound play failed:", err));
    } catch (err) {
      console.error("KID-480 in-app notification sound failed:", err);
      playing = false;
    }
  };

  const check = async () => {
    try {
      const res = await fetchFn("/api/notifications/unread", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { count?: unknown };
      const count = Number(data.count ?? 0);
      if (Number.isFinite(last) && last !== null && count > last) playSound();
      last = count;
      setLastUnread(String(count));
    } catch {
      // Offline/pause: skip this tick, keep state untouched.
    }
  };

  // First check establishes the baseline without making a sound.
  void check();
  const id = setInterval(check, POLL_MS);
  return () => clearInterval(id);
}

export default function NotificationSoundWatcher() {
  const playingRef = useRef(false);

  useEffect(() => {
    return startNotificationSoundWatcher({
      audioFactory: () => new Audio("/notification-sound.wav"),
      fetchFn: (input, init) => fetch(input, init),
      getSoundPref: () =>
        typeof window !== "undefined" && "localStorage" in window
          ? window.localStorage.getItem("kiddy:notificationSound")
          : null,
      getLastUnread: () =>
        typeof window !== "undefined" && "localStorage" in window
          ? window.localStorage.getItem("kiddy:unreadCount")
          : null,
      setLastUnread: (count) => {
        if (typeof window !== "undefined" && "localStorage" in window) {
          window.localStorage.setItem("kiddy:unreadCount", count);
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
