"use client";

// KID-1826 deliverable 3: the public marketing EN/AR switcher. The choice
// persists through the existing kiddy_lang device cookie; the page then
// reloads so the server re-renders every surface in the chosen language
// (browsers restore the scroll position on reload, so switching mid-page
// does not jump back to the top). No router dependency keeps the toggle
// renderable in static/test contexts. Signed-in accounts are out of scope
// for this control by design: their canonical language is account.language
// (set in Account Settings), which the root layout prefers over this cookie;
// the switcher always writes the cookie so anonymous visitors' choices
// persist across pages and reloads.
import { LANG_COOKIE, type Locale } from "@/lib/i18n";

export type SiteLangToggleProps = {
  current: Locale;
  label: string;
  labels: Record<Locale, string>;
};

export default function SiteLangToggle({ current, label, labels }: SiteLangToggleProps) {
  const select = (next: Locale) => {
    if (next === current) return;
    try {
      document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`;
    } catch (err) {
      console.error("Could not persist the site language preference:", err);
    }
    window.location.reload();
  };

  return (
    <div className="site-lang-toggle" role="group" aria-label={label}>
      {(["en", "ar"] as Locale[]).map((code) => (
        <button
          key={code}
          type="button"
          className={code === current ? "site-lang-btn site-lang-btn-active" : "site-lang-btn"}
          aria-pressed={code === current}
          lang={code}
          dir={code === "ar" ? "rtl" : "ltr"}
          onClick={() => select(code)}
        >
          {labels[code]}
        </button>
      ))}
    </div>
  );
}
