# KID-368 (DEF-004) — Arabic locale: hardcoded English on /login and five parent tabs

Run stamp: 2026-10-30, local dev server (`next dev`, seeded demo daycare
Sunshine Daycare, parent session `parent@example.test`), head of the KID-368
branch (master aa91dbf + DEF-004 fix). Viewport 320×640 CSS px, deviceScaleFactor 2.

## Defect (from the KID-257 live mobile audit, docs/evidence/kid253qa/defects.md)

With the app language switched to العربية (`dir=rtl`), hardcoded English
literals remained on:

- `/login` — the entire screen: "Sign in", "Welcome back …", "Email",
  "Password", "Forgot your password?", "Have an invite code? Activate your
  account"; plus RTL bidi artifacts ("(?Forgot your password" wrap, broken
  "daycare's day" wrap)
- `/child/newsfeed` — h1 "Newsfeed", "Comment" / "Add a comment", "N likes · N comments"
- `/child/events` — h1 "Events", subtitle, "Upcoming events", "Videos"
- `/child/drive` — h1 "Parent drive", subtitle, "Nothing shared yet."
- `/child/forms` — h1 "Forms & surveys" + subtitle
- `/child/consents` — h1 "Consents & approvals"

Already translated and untouched here: nav menu, /child dashboard, child
detail, learning, messages, support, settings, footer.

## Fix

- `lib/i18n.ts`: new EN/AR dict sections `login`, `newsfeed`, `events`,
  `drive`, `forms`, `consents` (parity-checked by tests/unit/i18n.test.ts:
  both locales expose identical leaf keys, ar non-empty, no MISSING markers).
  Includes the login guard-redirect wording (withdrawn / disabled /
  operator-entry-invalid / wrong-tenant with + without daycare name / host
  gate with URL) so the whole /login surface ships in Arabic.
- `app/login/page.tsx`: restructured as a localized server component — the
  same locale precedence as app/layout.tsx (`kiddy_lang` cookie wins; no
  session exists pre-login). Interactive pieces stay client-side islands:
  `login-brand.tsx` (the /api/branding fetch — brand name/logo are the
  daycare's own proper nouns, not translated) and `login-form.tsx` (submit
  error state). Guard/conf notices render from dict with `dir="auto"` and a
  `<bdi>` wrap, isolating the interpolated daycare name and the platform
  email so the RTL bidi wrap artifacts cannot recur. Bidi artifacts
  ("?Forgot your password") are also gone because those literals themselves
  are Arabic now.
- `lib/actions.ts`: `loginAction` error returns (bad credentials / withdrawn
  access / disabled daysare no_access) are worded in the visitor's language
  via `gateMessage` (cookie -> account preference -> EN), so even the
  post-submit error state on /login is Arabic.
- `lib/tenant.ts`: the login HOST gate (loginAction path) returns localized
  wording (`login.wrongTenantHome` / `wrongTenantOwn` / `wrongTenant`).
- `app/child/newsfeed|events|drive|forms|consents/page.tsx`: every user-facing
  string routed through `tr(dict, …)` via `i18nForAccount` (exact same
  mechanism as the already-translated dashboard/detail pages). Details:
  - newsfeed: empty state, "for {name}" badge, "{n} likes · {m} comments",
    comment placeholder/button, like/unlike button titles reused from
    `child.like`/`child.unlike`, author · timestamp line localized with
    `ar-EG` date formatting in Arabic (`toLocaleString("ar-EG")`).
  - events: title/subtitle/empty/"Videos" plus fixed the long-standing
    "Invalid Date – Invalid Date" render (bare `HH:MM` wall-clock strings
    cannot be parsed by `new Date`; `prettyEventTime` handles them).
  - drive: title/subtitle/empty/Open/all-children and the file-kind labels
    (file|pdf|photo|video portal enum; unknown kinds keep the capitalized
    raw value).
  - forms: title/subtitle/sent/empty/response count/Fill in/Submit/Cancel/
    Yes/My submissions/no-submissions/Submitted and the template-kind labels
    (form|survey|list; unknown kinds fall back).
  - consents: title/empty/Approve/Deny and localized status badges for the
    DB enum (pending|approved|denied).
- EN rendering: unchanged word-for-word (pinned by tests/unit/kid368-def004-ar-i18n.test.tsx).
  The only visual deltas in EN are the INVALID-DATE fix on events (previously
  it literally rendered "Invalid Date – Invalid Date") and newsfeed timestamps
  still using the default EN format.

## Verification

- `tests/unit/i18n.test.ts` — dict parity (green).
- `tests/unit/kid368-def004-ar-i18n.test.tsx` (new, follows the kid254
  request-scope mock + seeded SQLite style): dict EN/AR pins for every
  DEF-004 string, /login renders AR with no English leftovers, guard
  redirects localized + bidi-isolated (dir=auto + bdi), loginAction errors
  localized via the kiddy_lang cookie, and the five tab pages rendered
  EN (unchanged) and AR (no English literals in the DOM beyond DB data).
- Full suite, build and lint: see the issue fix report (post-run gate).

## Screenshots (this directory)

All at 320px, headed dev server, demo seed, parent session:

- `login-ar-320.png` — /login fully Arabic, RTL, no bidi artifacts.
- `login-en-320.png` — /login EN unchanged (no cookie -> EN default).
- `newsfeed-ar-320.png` — h1 الأخبار, AR date, "0 إعجاب · 0 تعليق",
  "أضف تعليقًا…" placeholder, تعليق button, "لـ Ella" badge.
- `events-ar-320.png` — h1 الفعاليات + subtitle + الفعاليات القادمة +
  الفيديوهات; times now render as "09:30 – 11:00" (no Invalid Date).
- `events-en-320.png` — EN events unchanged (except the time fix above).
- `drive-ar-320.png` — h1 الملفات المشتركة, subtitle, PDF kind labels,
  "كل الأطفال", فتح buttons.
- `forms-ar-320.png` — h1 النماذج والاستبيانات, kind labels
  (استبيان/قائمة), "N رد حتى الآن", تعبئة buttons, إرسالاتي empty state.
- `consents-ar-320.png` — h1 الموافقات والأذونات, معلّق badge, موافقة/رفض.

Remaining non-UI English in the screenshots is DATABASE CONTENT (demo post
bodies, event titles/descriptions, form titles the daycare writes itself),
which is operator data, not app literals.
