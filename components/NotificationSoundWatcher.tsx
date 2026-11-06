"use client";

import { useEffect, useRef } from "react";

// KID-480: in-app notification sound. While the parent keeps the app open, a
// tiny poll notices new unread notifications and plays the bundled WAV once.
// The sound is opt-out (localStorage kiddy:notificationSound === "off") and
// every failure path degrades silently-safe: Audio errors and fetch errors are
// logged, never thrown.
const POLL_MS = 45_000;
const SOUND_KEY = "kiddy:notificationSound";
const LAST_KEY = "kiddy:unreadCount";

export default function NotificationSoundWatcher() {
  const playingRef = useRef(false);

  useEffect(() => {
    let last: number | null = null;
    if (typeof window !== "undefined" && "localStorage" in window) {
      const stored = window.localStorage.getItem(LAST_KEY);
      last = stored === null ? null : Number(stored);
    }

    const playSound = () => {
      if (playingRef.current) return;
      if (window.localStorage.getItem(SOUND_KEY) === "off") return;
      playingRef.current = true;
      try {
        const audio = new Audio("/notification-sound.wav");
        audio.onended = () => {
          playingRef.current = false;
        };
        audio.onerror = () => {
          console.error("KID-480 in-app notification sound failed to load");
          playingRef.current = false;
        };
        audio.play().catch((err) => console.error("KID-480 in-app notification sound play failed:", err));
      } catch (err) {
        console.error("KID-480 in-app notification sound failed:", err);
        playingRef.current = false;
      }
    };

    const check = async () => {
      try {
        const res = await fetch("/api/notifications/unread", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: unknown };
        const count = Number(data.count ?? 0);
        if (Number.isFinite(last) && last !== null && count > last) playSound();
        last = count;
        window.localStorage.setItem(LAST_KEY, String(count));
      } catch {
        // Offline/pause: skip this tick, keep state untouched.
      }
    };

    // First check establishes the baseline without making a sound.
    void check();
    const id = window.setInterval(check, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  return null;
}
