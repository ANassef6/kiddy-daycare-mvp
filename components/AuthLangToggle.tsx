"use client";

import { LANG_COOKIE, type Locale } from "@/lib/i18n";

// KID-443 (defect 3): the EN/AR control on the unauthenticated surfaces
// (/login, /forgot-password) — QA check 4 wanted the toggle where the parents
// land, pre-sign-in. Reuses the lib/i18n dictionary infra (KID-368's every
// string resolved from the dict, locale from the kiddy_lang cookie) and the
// KID-403 toggle pattern (aria-pressed group, both options always rendered,
// the choice persists to the cookie) — but the account surfaces have no help
// state to keep in step, so persisting the cookie and reloading is enough for
// the server pages (and the root layout's <html lang>=<dir>) to re-render in
// the chosen language. Pure styling copy of the help-lang-toggle look.
export default function AuthLangToggle({
  locale,
  label,
  en,
  ar,
}: {
  locale: Locale;
  label: string;
  en: string;
  ar: string;
}) {
  const options: { code: Locale; label: string }[] = [
    { code: "en", label: en },
    { code: "ar", label: ar },
  ];
  return (
    <div
      className="login-lang-toggle"
      role="group"
      aria-label={label}
      style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}
    >
      {options.map(({ code, label: langLabel }) => (
        <button
          key={code}
          type="button"
          className={code === locale ? "btn btn-primary" : "btn btn-ghost"}
          aria-pressed={code === locale}
          lang={code}
          dir={code === "ar" ? "rtl" : "ltr"}
          onClick={() => {
            try {
              document.cookie = `${LANG_COOKIE}=${code}; path=/; max-age=31536000; SameSite=Lax`;
              window.location.reload();
            } catch (err) {
              console.error("Could not switch the language:", err);
            }
          }}
          style={{ padding: "4px 10px", fontSize: 13 }}
        >
          {langLabel}
        </button>
      ))}
    </div>
  );
}
