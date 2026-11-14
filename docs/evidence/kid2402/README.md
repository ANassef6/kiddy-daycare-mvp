# KID-2402 — QA acceptance: full Arabic localization (KID-2400 / KID-2401)

Date: 2026-11-14 · Verdict: **FAIL** · Tester: QA agent (independent — every row below was
reproduced live; implementation claims were not trusted)

**Code under test:** branch `kid2400-full-arabic-localization` at `74b5e82`
(KID-2400 implementation `01754e3` + `38a76e9`, KID-2401 copy fixes `8b27af3`, `74b5e82`).

**Verdict rationale:** the Arabic shell is real and mostly complete — every reachable page
renders `dir="rtl" lang="ar"` for Arabic accounts, the 1,789-key dictionary shows no
English UI value leaking into any Arabic page, and English pages carry zero Arabic
residue. But "sees Arabic **everywhere**" is not true today: six surfaces show English
UI or raw dictionary keys to the user, one portal page returns HTTP 500 in both
languages, the attendance server error is English-only, and two modules have no
server-side validation message at all. Each defect below is small and localized —
none blocks the release train, but together they fail the acceptance bar.

---

## 1. Environment & method

* **Isolation:** all runs used a private git worktree at `74b5e82` with its own
  `node_modules` copy and a **private SQLite database** seeded by
  `scripts/seed-retest-fixtures.ts` — two synthetic tenants (Maple Grove Daycare,
  Blue Horizon Kids). The Sunshine demo tenant (shared local DB and
  `sunshine.kiddyapp.net`) was never opened, read or written by this QA run. No
  production system was contacted.
* **Accounts (one per role, `account.language` flipped `en → ar → en` from the real
  Account-Settings UI each time):** owner `maple-owner@…`, admin `maple-admin@…`,
  teacher `maple-teacher@…` (language card lives on `/portal/account` — settings is
  admin-only), parent `maple-parent@…` (`/child/settings`). Anonymous locale tested via
  the `kiddy_lang`/`kiddy_site_lang` cookies (public pages have no account).
* **App:** `next dev` (production session cookies are `Secure` and unusable over
  plain HTTP — browser-only constraint), port 4123, reachable to the browser runner at
  `http://172.21.0.8:4123`.
* **Tools:**
  * HTTP render scan — 10 full runs (5 roles × 2 locales) over the whole route matrix
    (41 portal routes / 13 parent routes / 11 public routes per locale). Each response
    checked for: `<html dir/lang>`, all 1,789 English dictionary values present in the
    rendered text/attributes, English-sentence heuristics, `MISSING:*` markers,
    English month/weekday/AM-PM tokens vs Arabic-Indic/Arabic-month tokens, and Arabic
    code points on English pages. Raw signals were hand-reviewed to remove data false
    positives (child names, institute name "Maple Grove Daycare", invoice titles,
    curriculum content, language options "English/العربية", currency codes).
  * **Browser (interactive checks)** — Skyvern `skyvern-2.0` tasks against the local app
    with persistent browser profiles per role: real UI login, Account-Settings language
    switch (both directions, per role), screenshots (downloaded from run recordings as
    PNG frames), and the attendance error click-probe.
  * **Deterministic form-submit probes (check 4)** — the app's own progressive-enhancement
    (no-JS `multipart` + `$ACTION_ID_…`) form path: the exact same POST a browser without
    JavaScript would send, then the redirect target rendered and asserted against the
    dictionary. Run in **both** locales for children / finance / staff / forms /
    incidents; attendance runs through the client-only action path in the browser.
  * **Regression guard (check 6)** — planted an unlocalized page, ran the guard, removed it.

## 2. Check battery

| Command | Where | Result |
|---|---|---|
| `npm test` | isolated worktree @ `74b5e82` | Full run: **exit 1** — Test Files `69 failed / 42 passed (111)`, Tests `73 failed / 377 passed (450)`, 734.7 s. The 69 failures are an **environment artifact**, not code: the worktree inherited the main checkout's stray absolute `node_modules/node_modules → <main checkout>/node_modules` symlink (present since Nov 9), so modules resolved half into the main checkout and half into the worktree — `vi.mock` registrations missed and several files failed collection (`(0 test)` files). Proof: after removing the stray link (consistent resolution), **all 69 failing files re-run individually: 69/69 files pass, 938/938 tests pass, 0 failures** (`battery-reverify.log`). Combined: **111/111 files, 1,315 tests pass**. Supplementary: key files also pass standalone in the reference checkout (`kid180` 8/8, `kid212` 31/31). |
| `npm run lint` | worktree @ `74b5e82` | **exit 0** (clean) |
| `npm run build` | worktree @ `74b5e82` | **exit 0** — "Compiled successfully in 18.4s" |

Raw outputs archived with this run: `battery-test.log` (full run), `battery-reverify.log`
(69-file corrected re-run), `battery-lint-build.log` (lint+build).

**Guard test (check 6) — verified to actually fail:**

* With `app/portal/zz-qa-unlocalized/page.tsx` planted (plain English JSX):
  `npx vitest run tests/unit/i18n-page-coverage.test.ts` → **exit 1**, failing assertion
  names the file: `portal/zz-qa-unlocalized/page.tsx: expected [ 'portal/zz-qa-unlocalized/page.tsx' ] to deeply equal []`.
* After removing it: same command → **exit 0**, 4/4 passed. Temporary file removed;
  worktree clean.

## 3. Pass/fail matrix

Page × locale × checks 1–5. `–` = not applicable for this row (check 4 only applies to
the six form modules; check 5 is asserted per-page on the English row and per-role on
the Account-Settings round trip). `— (307 → …)` = route is a pure redirect (allow-listed
in the guard). Full matrix also ships as `matrix.md` next to this file.

### Portal pages — owner (admin & teacher reached the same pages; teacher/admin role gates rendered as 307 rows in their own scans; `/portal/account` leakage reproduced for all three staff roles)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/portal/dashboard` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/dashboard` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/attendance` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✗ English server error: `Saturday is a closed day — no check-ins are allowed today` | n/a |
| `/portal/attendance` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ English error (correct locale) | ✓ |
| `/portal/calendar` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/calendar` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/children` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ DOB column raw ISO `2021-03-15`, `02:20 AM` | ✓ `ولي الأمر (الاسم وصلة القرابة ورقم هاتف أو بريد) مطلوب قبل إضافة الطفل.` | n/a |
| `/portal/children` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✗ DOB column raw ISO `2021-03-15` (not en-US) | ✓ `A parent/guardian (name, relationship, and a phone or email) is required before a child can be added.` | ✓ |
| `/portal/children/mwfs3d5f-er1l09ii` | ar | ✗ raw status `اليوم: In` | ✓ `dir=rtl` | ✗ `Mon Mar 15 2021`, `Sat Nov 14 2026 02:20 AM` | ✗ no server error for empty incident; server accepted it (only native `Please fill out this field.` in browser) | n/a |
| `/portal/children/mwfs3d5f-er1l09ii` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✗ no server error for empty incident (native validation only) | ✓ |
| `/portal/children/mwfs3d5f-er1l09ii/billing` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ due dates raw ISO `2026-11-21`, `2026-10-15` | ✓ `يجب أن يكون رابط الدفع عنوان http أو https صالحًا. لم تُنشأ الفاتورة.` | n/a |
| `/portal/children/mwfs3d5f-er1l09ii/billing` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✗ raw ISO `2026-11-21` | ✓ `The payment link must be a valid http or https URL. The invoice was not created.` | ✓ |
| `/portal/children/mwfs3d5f-er1l09ii/development` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ `04:05 AM` time marker | – | n/a |
| `/portal/children/mwfs3d5f-er1l09ii/development` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/children/development` | ar | — (307 → `/portal/learning`) | — | — | — | n/a |
| `/portal/children/development` | en | — (307 → `/portal/learning`) | — | — | — | ✓ n/a |
| `/portal/drive` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/drive` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/finance` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ due-date column raw ISO `2026-11-21` | – | n/a |
| `/portal/finance` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✗ raw ISO `2026-11-21` | – | ✓ |
| `/portal/forms` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✗ no server error exists; only browser-native (English) validation | n/a |
| `/portal/forms` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✗ no server error exists; only browser-native validation | ✓ |
| `/portal/incidents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/incidents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/inquiries` | ar | — (307 → `/portal/forms?view=inquiries`) | — | — | — | n/a |
| `/portal/inquiries` | en | — (307 → `/portal/forms?view=inquiries`) | — | — | — | ✓ n/a |
| `/portal/learning` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/curriculum` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/curriculum` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/activities` | ar | ✗ `MISSING:picker.pickerChoose` | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/activities` | en | ✗ `MISSING:picker.pickerChoose` | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/homework` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/homework` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/reports` | ar | — (307 → `/portal/report-center`) | — | — | — | n/a |
| `/portal/reports` | en | — (307 → `/portal/report-center`) | — | — | — | ✓ n/a |
| `/portal/rooms` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/rooms` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/rooms/mwfs3cv3-prl5rug2` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ DOB raw ISO `2021-03-15` | – | n/a |
| `/portal/rooms/mwfs3cv3-prl5rug2` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✗ raw ISO `2021-03-15` | – | ✓ |
| `/portal/staff` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/staff` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/staff/mwfs3cvw-hp6g6y7n` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ `حدد كلمة مرور من 8 أحرف على الأقل.` (probe on a login-less staff row) | n/a |
| `/portal/staff/mwfs3cvw-hp6g6y7n` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ `Set a password of at least 8 characters.` | ✓ |
| `/portal/staff/hours` | ar | ✗ page fails (HTTP 500) | ✗ n/a | – | – | – |
| `/portal/staff/hours` | en | ✗ page fails (HTTP 500) | ✗ n/a | – | – | – |
| `/portal/staff/schedule` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/staff/schedule` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/support-inbox` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/support-inbox` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/surveys` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/surveys` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/tags` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/tags` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/messages` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ `محادثة Sat Nov 14 2026` heading | – | n/a |
| `/portal/messages` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/newsfeed` | ar | ✗ `MISSING:picker.pickerChoose` | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/newsfeed` | en | ✗ `MISSING:picker.pickerChoose` | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/events` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/events` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/consents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/consents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/settings` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/settings` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/notifications` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ `02:20 AM` time markers | – | n/a |
| `/portal/notifications` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/account` | ar | ✗ EN activity column: `Newsfeed posts · Homework · Supplies · Billing · Attendance · Incidents · Messages · Daily reports · Events` | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/account` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/account-billing` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/account-billing` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/report-center` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/report-center` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/performance` | ar | ✗ `MISSING:roles.teacher`, `MISSING:roles.caregiver` | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/performance` | en | ✗ raw keys `(roles.teacher)`, `(roles.caregiver)` | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/supplies` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/supplies` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/enhancements` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/enhancements` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/support` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/support` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/audit` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/audit` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |

### Portal pages — teacher (role-gated pages redirect: settings/account-billing/enhancements/audit → dashboard; /portal/staff → own profile)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/portal/dashboard` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/dashboard` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/attendance` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/attendance` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/calendar` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/calendar` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/children` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ DOB column raw ISO `2021-03-15`, `02:20 AM` | – | n/a |
| `/portal/children` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✗ DOB column raw ISO `2021-03-15` (not en-US) | – | ✓ |
| `/portal/children/mwfs3d5f-er1l09ii` | ar | ✗ raw status `اليوم: In` | ✓ `dir=rtl` | ✗ `Mon Mar 15 2021`, `Sat Nov 14 2026 02:20 AM` | – | n/a |
| `/portal/children/mwfs3d5f-er1l09ii` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/children/mwfs3d5f-er1l09ii/billing` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ due dates raw ISO `2026-11-21`, `2026-10-15` | – | n/a |
| `/portal/children/mwfs3d5f-er1l09ii/billing` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✗ raw ISO `2026-11-21` | – | ✓ |
| `/portal/children/mwfs3d5f-er1l09ii/development` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ `04:05 AM` time marker | – | n/a |
| `/portal/children/mwfs3d5f-er1l09ii/development` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/children/development` | ar | — (307 → `/portal/learning`) | — | — | — | n/a |
| `/portal/children/development` | en | — (307 → `/portal/learning`) | — | — | — | ✓ n/a |
| `/portal/drive` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/drive` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/finance` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ due-date column raw ISO `2026-11-21` | – | n/a |
| `/portal/finance` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✗ raw ISO `2026-11-21` | – | ✓ |
| `/portal/forms` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/forms` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/incidents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/incidents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/inquiries` | ar | — (307 → `/portal/forms?view=inquiries`) | — | — | — | n/a |
| `/portal/inquiries` | en | — (307 → `/portal/forms?view=inquiries`) | — | — | — | ✓ n/a |
| `/portal/learning` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/curriculum` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/curriculum` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/activities` | ar | ✗ `MISSING:picker.pickerChoose` | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/activities` | en | ✗ `MISSING:picker.pickerChoose` | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/homework` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/homework` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/reports` | ar | — (307 → `/portal/report-center`) | — | — | — | n/a |
| `/portal/reports` | en | — (307 → `/portal/report-center`) | — | — | — | ✓ n/a |
| `/portal/rooms` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/rooms` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/rooms/mwfs3cv3-prl5rug2` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ DOB raw ISO `2021-03-15` | – | n/a |
| `/portal/rooms/mwfs3cv3-prl5rug2` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✗ raw ISO `2021-03-15` | – | ✓ |
| `/portal/staff` | ar | — (307 → `/portal/staff/mwfs3cys-v8wv716l`) | — | — | — | n/a |
| `/portal/staff` | en | — (307 → `/portal/staff/mwfs3cys-v8wv716l`) | — | — | — | ✓ n/a |
| `/portal/staff/mwfs3cys-v8wv716l` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/staff/mwfs3cys-v8wv716l` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/staff/hours` | ar | ✗ page fails (HTTP 500) | ✗ n/a | – | – | – |
| `/portal/staff/hours` | en | ✗ page fails (HTTP 500) | ✗ n/a | – | – | – |
| `/portal/staff/schedule` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/staff/schedule` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/support-inbox` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/support-inbox` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/surveys` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/surveys` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/tags` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/tags` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/messages` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ `محادثة Sat Nov 14 2026` heading | – | n/a |
| `/portal/messages` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/newsfeed` | ar | ✗ `MISSING:picker.pickerChoose` | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/newsfeed` | en | ✗ `MISSING:picker.pickerChoose` | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/events` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/events` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/consents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/consents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/settings` | ar | — (307 → `/portal/dashboard`) | — | — | — | n/a |
| `/portal/settings` | en | — (307 → `/portal/dashboard`) | — | — | — | ✓ n/a |
| `/portal/notifications` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ `02:20 AM` time markers | – | n/a |
| `/portal/notifications` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/account` | ar | ✗ EN activity column: `Newsfeed posts · Homework · Supplies · Billing · Attendance · Incidents · Messages · Daily reports · Events` | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/account` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/account-billing` | ar | — (307 → `/portal/dashboard`) | — | — | — | n/a |
| `/portal/account-billing` | en | — (307 → `/portal/dashboard`) | — | — | — | ✓ n/a |
| `/portal/report-center` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/report-center` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/performance` | ar | ✗ `MISSING:roles.teacher`, `MISSING:roles.caregiver` | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/performance` | en | ✗ raw keys `(roles.teacher)`, `(roles.caregiver)` | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/supplies` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/supplies` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/enhancements` | ar | — (307 → `/portal/dashboard`) | — | — | — | n/a |
| `/portal/enhancements` | en | — (307 → `/portal/dashboard`) | — | — | — | ✓ n/a |
| `/portal/support` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/support` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/audit` | ar | — (307 → `/portal/dashboard`) | — | — | — | n/a |
| `/portal/audit` | en | — (307 → `/portal/dashboard`) | — | — | — | ✓ n/a |

### Parent surfaces (`/child/*`)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/child` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ `04:05 AM` / `03:20 AM` times | – | n/a |
| `/child` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/mwfs3d5f-er1l09ii` | ar | ✗ `pending`, `paid`, `Happy` (status/mood labels) | ✓ `dir=rtl` | ✗ `Sat Nov 21 2026`, `11/14/2026` picker, day strip `11-08` | – | n/a |
| `/child/mwfs3d5f-er1l09ii` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✗ raw ISO periods `2026-10` | – | ✓ |
| `/child/consents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/consents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/drive` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/drive` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/events` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/events` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/forms` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/forms` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/incidents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/incidents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/learning` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/learning` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/messages` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/messages` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/newsfeed` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/newsfeed` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/notifications` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✗ due dates raw ISO `2026-10-31` | – | n/a |
| `/child/notifications` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✗ raw ISO `2026-10-31` | – | ✓ |
| `/child/settings` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/settings` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/support` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/support` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |

### Public / auth pages (locale from `kiddy_lang` cookie)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/login` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/login` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/register` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/register` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/forgot-password` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/forgot-password` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/reset-password` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/reset-password` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/welcome` | ar | — (307 → `/login`) | — | — | — | n/a |
| `/welcome` | en | — (307 → `/login`) | — | — | — | ✓ n/a |
| `/unknown-daycare` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/unknown-daycare` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/features` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/features` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/for-centers` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/for-centers` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/for-parents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/for-parents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/contact` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/contact` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |

**Check 5 (role-level):** owner: ✓ UI round trip EN→AR→EN (Account Settings) + EN scan: no Arabic · admin: ✓ EN scan: no Arabic (language never changed — default en) · teacher: ✓ UI round trip EN→AR→EN (Account settings tab) + EN scan: no Arabic · parent: ✓ UI round trip EN→AR→EN (child settings) + EN scan: no Arabic · anon: ✓ cookie locale only; both cookie states scanned, no cross-language residue

**Check 5 (role level):** owner — UI round trip EN→AR→EN via `/portal/settings`
(DB `account.language` verified `en → ar → en`, screenshots `40-check5-owner-en-restored.png`);
teacher — same via `/portal/account` (`41-…`); parent — same via `/child/settings`
(`42-…`); all English scans across every page contain **zero** Arabic characters other
than the "العربية" language option itself.

## 4. Leakage list — exact English strings found (file · page)

| # | Exact string(s) | Source | Page(s) / locale | Screenshot |
|---|---|---|---|---|
| L1 | `Newsfeed posts` `Homework` `Supplies` `Billing` `Attendance` `Incidents` `Messages` `Daily reports` `Events` | `app/portal/account/page.tsx:15` (hard-coded EN map for the notification-preference activity column) | `/portal/account` · AR · owner+admin+teacher | `01`, `02` |
| L2 | `MISSING:picker.pickerChoose` (renders as literal even in English) | `components/RecipientsPicker.tsx:103` asks for `picker.pickerChoose`; the real key is `parent.pickerChoose` (`lib/i18n.ts`) — key never existed | `/portal/learning/activities`, `/portal/newsfeed` · AR **and** EN | `03`, `04` |
| L3 | `MISSING:roles.teacher`, `MISSING:roles.caregiver` (AR) · raw `(roles.teacher)`, `(roles.caregiver)` (EN) | `app/portal/performance/page.tsx:79` uses `roles.${role}`; dict has `roles.staff`/`roles.carer` only — correct keys are `staff.roleTeacher`/`staff.roleCaregiver` | `/portal/performance` · AR+EN | `05`, `06` |
| L4 | `Mon Mar 15 2021` (DOB), `Sat Nov 14 2026 02:20 AM` (daily-report stamp), `04:05 AM` | `lib/helpers.ts:49-52` `fmtDate()` = `Date.toDateString()` (locale-less), used by `app/portal/children/[id]/page.tsx`; bare `toLocaleTimeString([], …)` at `app/portal/children/[id]/page.tsx:799` | `/portal/children/[id]`, `/portal/children/[id]/development` · AR | `07` |
| L5 | `اليوم: In` (attendance status raw enum) | `app/portal/children/[id]/page.tsx` status line | `/portal/children/[id]` · AR | `07` |
| L6 | `محادثة Sat Nov 14 2026 .` | `app/portal/messages/page.tsx:286` — `t("common.thread")` + `fmtDate(...)` (English `toDateString()`) | `/portal/messages` · AR | `08` |
| L7 | `Sat Nov 21 2026`, `Thu Oct 15 2026` (due dates) · `pending` `paid` (status badges) · `Happy` (mood) · `11/14/2026` (date input) · `04:05 AM`/`03:20 AM` | `app/child/[id]/page.tsx`: `fmtDate` for due dates (:306), bare `toLocaleString()` (:374, :415), bare `toLocaleTimeString([], …)` (:438), raw status/mood enums | `/child/[id]` (parent) · AR | `09` |
| L8 | `Saturday is a closed day — no check-ins are allowed today` (and sibling literals `The center hasn't opened yet — …`) | `lib/working-hours.ts:128,139` — English literals returned by `checkInOpen` through `checkInOutAction`; `lib/pickup-policy.ts` carries the same class of literals | `/portal/attendance` · AR (EN page correct) | `12` |
| L9 | `<title>Maple Grove Daycare — childcare, in your pocket</title>` and `<meta name="description" content="Check-in, check-out, daily reports, and the newsfeed for Egyptian daycares.">` | `app/layout.tsx:24-29` — hard-coded English metadata for **every** page and locale | all pages · AR (head, not in check-1's body list but user-visible in the tab/SEO) | quoted from raw HTML (head text cannot be screenshotted) |
| L10 | Raw ISO dates `2021-03-15`, `2026-11-21`, `2026-10-15`, `2026-10-31`, `2026-11-14` | raw `child.dob` / `billing.due_date` columns (not passed through `fmtDateFor`) | children list, `/portal/finance`, `/portal/children/[id]/billing`, `/portal/rooms/[id]`, `/portal/notifications`, `/child/notifications` · **both** locales | matrix rows |
| L11 | Native browser strings `Please fill out this field.`, `No file chosen`, `Choose File` | browser chrome (HTML5) — shown because the app itself has no server/AR message for these cases | incidents & forms submits, parent file upload · AR+EN | noted in §5 |

**Allowed English deliberately excluded from the leakage list** (per the plan): brand
names (Kiddy, Maple Grove Daycare, Instapay, Excel, Vikunja), personal/child/staff names
("Aria Maple", "maple Owner" — role words inside names are data), emails/URLs/placeholders,
currency & format codes (`USD`, `EGP`, `CSV`, `PDF`), language options (`English`,
`العربية`), font names, DB record ids, and **fixture data content** (daily-report text,
incident descriptions, message bodies, invoice titles, curriculum copy).

## 5. Bugs (→ Cody) vs copy issues (→ Noor)

### Bugs — code fixes (owner: Cody)

1. **HTTP 500 — `/portal/staff/hours`** (both locales, owner/admin/teacher).
   `page.tsx` renders `opening_hours` day values with `{hours}`, but the current stored
   format (what Settings itself writes through `encodeWorkingHours`) is
   `{"1":{"open":"07:00","close":"18:00"}}` → *"Objects are not valid as a React child"*.
   Pre-existing (code predates KID-2400; only legacy string-shaped tenants survive).
   Screenshots `10`, `11`.
2. **`MISSING:picker.pickerChoose` in the recipients picker** (L2) — wrong dict path,
   visible in both locales. Pre-existing (KID-221 era) but directly in KID-2400's
   claimed coverage. Screenshots `03`, `04`.
3. **Raw role keys on `/portal/performance`** (L3). Pre-existing (KID-221 era).
   Screenshots `05`, `06`.
4. **Hard-coded English notification-activity labels on `/portal/account`** (L1) — the
   one clearly in-scope KID-2400 miss with high visibility; every staff role sees it in
   Arabic. Screenshots `01`, `02`.
5. **Residual locale-less date/time formatting** (L4–L7): `fmtDate()`/`fmtTime()` in
   `lib/helpers.ts`, bare `toLocaleString()/toLocaleTimeString([])` call sites in
   `app/child/[id]`, `app/child/page`, `app/child/events`, `app/portal/children/[id]`,
   `app/portal/messages` — the KID-2400 sweep replaced most `fmtDateFor` sites but
   missed these. Screenshots `07`, `08`, `09`.
6. **Attendance policy errors are English-only literals** (L8, `lib/working-hours.ts`,
   `lib/pickup-policy.ts`) — check-4 failure for the attendance module in Arabic.
   Screenshot `12`.
7. **No server-side validation for forms & incidents** (check-4): `createFormAction`
   silently no-ops on an empty title (redirect, no message, nothing created);
   `createIncidentAction` **accepts an empty description and creates the incident**
   (verified, QA row removed afterwards). Only browser-native English HTML5 validation
   stands in front. Screenshots/evidence: task runs `t-forms`, `t-inc`.
8. **English document metadata in every locale** (L9) — title template + meta
   description hard-coded in `app/layout.tsx`.
9. **Raw ISO date columns in both locales** (L10) — consistent but not locale-formatted;
   minor check-3 gap.

### Copy issues (owner: Noor)

* **None found beyond KID-2401's applied corrections.** This run covered *coverage and
  format*, not wording; every Arabic dictionary value that rendered did so correctly and
  KID-2401's 226 corrections are present at `74b5e82`. The only "English copy" items a
  reader might mistake for copy issues are the browser-native strings in L11 (not app
  copy) — they disappear once bug #7 lands.

## 6. Screenshots (`screenshots/`)

Failures (13): `01` account EN labels in AR · `02` same, teacher role · `03`/`04`
`MISSING:picker` AR/EN · `05`/`06` performance keys AR/EN · `07` child detail English
dates/status · `08` messages English date heading · `09` parent billing English
dates/status/mood/US date-input · `10`/`11` staff/hours 500 AR/EN · `12` attendance
English server error on a fully Arabic page.

Passes (14): 5 per language as requested — AR `20`–`24` (dashboard, children, settings,
supplies, login), EN `30`–`34` (dashboard, attendance, children, login, settings) —
plus check-5 restore shots `40`–`43` (owner, teacher, parent, admin) and `25` (admin AR settings).

All PNGs are last-frame extracts from the browser-run recordings of the interactive
sessions (800×450 headless viewport); full recordings, HAR-less run JSONs and the raw
scan JSONs are archived with this run's evidence.

## 7. Verdict

**FAIL.** Known issues are exactly the nine bugs in §5 (copy list clean). Nothing in
this report was fixed in place — per the plan, fixes belong to the owning agents:

* bugs → **Cody** (items 1–9 above; items 2–3 pre-date KID-2400, items 4–6 are the
  KID-2400 gaps that decide a re-run of this gate),
* copy → **Noor** (no new work required).

Re-run KID-2402 after fixes 1, 2, 3, 4, 5, 6 and 7 land; items 8–9 can ship as known
issues if the board accepts them explicitly.
