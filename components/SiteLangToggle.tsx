// KID-1826 deliverable 3 / KID-2072: the public marketing EN/AR switcher.
// The switch is a no-JavaScript-first server round trip: the buttons submit a
// GET form to /switch-lang, which sets the site language cookie server-side
// and redirects (303) back to the exact path + query the visitor was on. That
// fixes the silent no-op behind the KID-215 report: the switch now works with
// JavaScript disabled or blocked, and before hydration attaches anything.
// No client JS is needed at all, so this is a plain server component that
// stays renderable in static/test contexts.
//
// Signed-in accounts remain out of scope for the ACCOUNT-level preference
// (Account Settings → language) by design; the site choice itself always
// wins on the public marketing pages (kiddy_site_lang, last explicit choice).
import type { Locale } from "@/lib/i18n";

export type SiteLangToggleProps = {
  current: Locale;
  label: string;
  labels: Record<Locale, string>;
  // KID-2072: the return trip for the server redirect. Null (static test
  // renders without a request scope) omits the field and the endpoint
  // defaults to "/".
  nextPath?: string | null;
};

export default function SiteLangToggle({ current, label, labels, nextPath }: SiteLangToggleProps) {
  return (
    // KID-1826 carry-over: role=group + aria-label names the control pair;
    // aria-pressed stays on buttons (links would lose the pressed state
    // vocabulary). lang/dir keep each button's own language and direction.
    <form className="site-lang-toggle" role="group" aria-label={label} method="get" action="/switch-lang">
      {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
      {(["en", "ar"] as Locale[]).map((code) => (
        <button
          key={code}
          type="submit"
          name="lang"
          value={code}
          className={code === current ? "site-lang-btn site-lang-btn-active" : "site-lang-btn"}
          aria-pressed={code === current}
          lang={code}
          dir={code === "ar" ? "rtl" : "ltr"}
        >
          {labels[code]}
        </button>
      ))}
    </form>
  );
}
