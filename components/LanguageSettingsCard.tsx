"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { tr, type Dict, type Locale } from "@/lib/i18n";

// KID-57: App language card for Account Settings. Two options — English and
// العربية — persisted per user.
//
// KID-2460: the switch is a native POST to /switch-app-lang, not a server
// action. A server-action redirect is a client-side navigation: the App Router
// keeps the already-mounted layouts, so the root <html lang dir> and the portal
// sidebar could stay in the old language while the page segment re-rendered in
// the new one (the mixed English-sidebar / Arabic-content screenshot). A POST
// route that answers 303 forces a full document load, so every shell and
// direction re-resolves from the saved account language.
export default function LanguageSettingsCard({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dict;
}) {
  const [current, setCurrent] = useState<Locale>(locale);
  const pathname = usePathname();

  return (
    <div className="card mb-4">
      <h3 className="subtitle">{tr(dict, "account.appLanguage")}</h3>
      <p className="small muted">{tr(dict, "account.appLanguageHint")}</p>
      <form
        method="post"
        action="/switch-app-lang"
        className="row mt-3"
        style={{ alignItems: "center", gap: 12 }}
      >
        <input type="hidden" name="next" value={pathname} />
        <label
          className="choice"
          style={{
            borderColor: current === "en" ? "var(--brand-primary)" : undefined,
            background: current === "en" ? "color-mix(in srgb, var(--brand-primary) 6%, var(--color-surface))" : undefined,
            fontWeight: current === "en" ? 600 : 500,
          }}
        >
          <input
            type="radio"
            name="locale"
            value="en"
            checked={current === "en"}
            onChange={() => setCurrent("en")}
            style={{ accentColor: "var(--brand-primary)" }}
          />
          {tr(dict, "account.english")}
        </label>
        <label
          className="choice"
          style={{
            borderColor: current === "ar" ? "var(--brand-primary)" : undefined,
            background: current === "ar" ? "color-mix(in srgb, var(--brand-primary) 6%, var(--color-surface))" : undefined,
            fontWeight: current === "ar" ? 600 : 500,
          }}
        >
          <input
            type="radio"
            name="locale"
            value="ar"
            checked={current === "ar"}
            onChange={() => setCurrent("ar")}
            style={{ accentColor: "var(--brand-primary)" }}
          />
          {tr(dict, "account.arabic")}
        </label>
        <button className="btn btn-primary" type="submit">
          {tr(dict, "common.save")}
        </button>
      </form>
    </div>
  );
}