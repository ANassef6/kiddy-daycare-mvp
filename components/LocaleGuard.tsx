"use client";

// KID-2460: layouts keep their server props across client-side navigations.
// If the account language changes somewhere else (another tab/device, the
// platform support flow, a mobile client) while this tab stays open, every
// page segment re-renders in the new language but the mounted portal shell
// does not: the sidebar and <html dir> stay on the old locale, which is the
// English-sidebar / Arabic-content screenshot in the issue.
//
// On mount, focus, visibility and bfcache restore this guard asks the server
// for the account's current locale. A mismatch reloads the document once, so
// the root layout, direction and nav labels all come back in the same
// language. The endpoint is same-origin and returns only the locale.
import { useEffect, useRef } from "react";
import type { Locale } from "@/lib/i18n";

const RELOAD_KEY = "kiddy_locale_guard_reload";

export default function LocaleGuard({ locale }: { locale: Locale }) {
  const checking = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (checking.current) return;
      checking.current = true;
      try {
        const res = await fetch("/api/locale", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { locale?: string };
        // Only attempt each transition once. If an edge node keeps returning
        // the new locale while the document cannot render it, a second reload
        // would loop; the next real navigation still re-checks.
        if (data.locale && data.locale !== locale) {
          const key = `${RELOAD_KEY}:${locale}:${data.locale}`;
          try {
            if (sessionStorage.getItem(key) === "1") return;
            sessionStorage.setItem(key, "1");
          } catch {
            // Private mode without storage: still reload, just unguarded.
          }
          window.location.reload();
        }
      } catch (err) {
        console.error("KID-2460 locale check failed:", err);
      } finally {
        checking.current = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void verify();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void verify();
    };

    void verify();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [locale]);

  return null;
}
