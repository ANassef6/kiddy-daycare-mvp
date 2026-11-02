"use client";

// KID-403: the Help Center EN/AR control. The choice persists through
// localStorage + a (non-httpOnly) cookie so the server-rendered list, detail
// and chrome all re-render in the language the user picked.
//
// KID-428: the toggle keeps its exact contract while the article set it
// controls moved from the bundled 96-record data file to the Chatwoot help
// center (server-fetched on the flight the toggle triggers).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { HELP_LANG_COOKIE, type HelpLanguage } from "@/lib/help-lang";

export function persistHelpLanguage(language: HelpLanguage) {
  try {
    window.localStorage.setItem(HELP_LANG_COOKIE, language);
    document.cookie = `${HELP_LANG_COOKIE}=${language}; path=/; max-age=31536000; SameSite=Lax`;
  } catch (err) {
    console.error("Could not persist the help language preference:", err);
  }
}

export type HelpLanguageToggleProps = {
  current: HelpLanguage;
  basePath: string;
  // KID-403 chrome copy, resolved server-side from the current language so the
  // labels flip together with the article set.
  label: string;
  labels: Record<HelpLanguage, string>;
  // KID-428: on the article detail view the toggle also must change the
  // article (Chatwoot stores one article per language). When provided, the
  // switch navigates straight to the other-language article instead of
  // re-rendering the same id in a new language shell.
  alternateHref?: string;
};

export default function HelpLanguageToggle({
  current,
  basePath,
  label,
  labels,
  alternateHref,
}: HelpLanguageToggleProps) {
  const router = useRouter();
  const [active, setActive] = useState<HelpLanguage>(current);

  const select = (next: HelpLanguage) => {
    if (next === active) return;
    setActive(next);
    persistHelpLanguage(next);
    if (alternateHref) {
      router.replace(alternateHref, { scroll: false });
      return;
    }
    // Keep the URL in step with the chosen help language so the server chrome
    // and article set re-resolve on the same value (extra params — like the
    // search ?q= — survive untouched).
    const params = new URLSearchParams(window.location.search);
    params.set("lang", next);
    router.replace(`${basePath}?${params.toString()}`, { scroll: false });
  };

  return (
    <div
      className="help-lang-toggle"
      role="group"
      aria-label={label}
      data-alternate-href={alternateHref ?? ""}
      style={{ display: "flex", gap: 6, flexShrink: 0 }}
    >
      {(["en", "ar"] as HelpLanguage[]).map((code) => (
        <button
          key={code}
          type="button"
          className={code === active ? "btn btn-primary" : "btn btn-ghost"}
          aria-pressed={code === active}
          lang={code}
          dir={code === "ar" ? "rtl" : "ltr"}
          onClick={() => select(code)}
          style={{ padding: "4px 10px", fontSize: 13 }}
        >
          {labels[code]}
        </button>
      ))}
    </div>
  );
}
