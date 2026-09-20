"use client";

import { useState } from "react";
import { saveLanguageAction } from "@/lib/actions";
import { tr, type Dict, type Locale } from "@/lib/i18n";

// KID-57: App language card for Account Settings. Two options — English and
// العربية — persisted per user via a server action. The locale is re-read on
// the next navigation so the whole app (including RTL) flips immediately.
export default function LanguageSettingsCard({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dict;
}) {
  const [current, setCurrent] = useState<Locale>(locale);

  return (
    <div className="card mb-4">
      <h3 className="subtitle">{tr(dict, "account.appLanguage")}</h3>
      <p className="small muted">{tr(dict, "account.appLanguageHint")}</p>
      <form action={saveLanguageAction} className="row mt-3" style={{ alignItems: "center", gap: 12 }}>
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