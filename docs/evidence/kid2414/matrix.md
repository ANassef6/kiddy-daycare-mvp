# KID-2414 pass/fail matrix — Arabic localization gate re-run after KID-2413

Code under test: branch `kid2400-full-arabic-localization` at `0d4ffa8` (KID-2413 fixes for bugs 1–7).
Same check battery as KID-2402. Known issues excluded per board: bug 8 (hard-coded `<title>`/meta) and bug 9 (raw ISO date columns).
Fixture-data English (invoice titles, message bodies, incident text, curriculum copy, consent/form titles) is excluded per the KID-2402 allowlist.

### Portal pages — owner (EN)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/portal/dashboard` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/attendance` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ English closed-day error «Sunday is a closed day — no check-ins are allowed today.» (screenshot bug6-attendance-closed-day-en) | ✓ |
| `/portal/calendar` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/children` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ missing guardian: `?error=guardian` localized banner; no child created | ✓ |
| `/portal/children/mwhq5xia-kjvq8yap` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ empty description rejected: `?error=incident-description` banner; no incident created | ✓ |
| `/portal/children/mwhq5xia-kjvq8yap/billing` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ invalid payment link: `?error=paymentlink` localized banner; no invoice created | ✓ |
| `/portal/children/mwhq5xia-kjvq8yap/development` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/children/development` | en | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) |
| `/portal/drive` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/finance` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/forms` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ empty title no-ops: redirect `?error=form-title` + localized banner; no form created | ✓ |
| `/portal/incidents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/inquiries` | en | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) |
| `/portal/learning` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/curriculum` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/activities` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/homework` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/reports` | en | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) |
| `/portal/rooms` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/rooms/mwhq5x84-n0hd3b9j` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/staff` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/staff/mwhq5x8x-3pa685dd` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ short password: `?error=password` localized banner; no account created | ✓ |
| `/portal/staff/hours` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/staff/schedule` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/support-inbox` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/surveys` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/tags` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/messages` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/newsfeed` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/events` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/consents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/settings` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/notifications` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/account` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/account-billing` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/report-center` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/performance` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/supplies` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/enhancements` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/support` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/audit` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |

### Portal pages — owner (AR)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/portal/dashboard` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/attendance` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ localized closed-day error «الأحد يوم عطلة — لا يُسمح بتسجيل الحضور اليوم.» (screenshot bug6-attendance-closed-day-ar) | n/a |
| `/portal/calendar` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/children` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ missing guardian: `?error=guardian` localized banner; no child created | n/a |
| `/portal/children/mwhq5xia-kjvq8yap` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ empty description rejected: `?error=incident-description` banner; no incident created | n/a |
| `/portal/children/mwhq5xia-kjvq8yap/billing` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ invalid payment link: `?error=paymentlink` localized banner; no invoice created | n/a |
| `/portal/children/mwhq5xia-kjvq8yap/development` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/children/development` | ar | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) |
| `/portal/drive` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/finance` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/forms` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ empty title no-ops: redirect `?error=form-title` + localized banner; no form created | n/a |
| `/portal/incidents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/inquiries` | ar | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) |
| `/portal/learning` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/curriculum` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/activities` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/homework` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/reports` | ar | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) |
| `/portal/rooms` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/rooms/mwhq5x84-n0hd3b9j` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/staff` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/staff/mwhq5x8x-3pa685dd` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ short password: `?error=password` localized banner; no account created | n/a |
| `/portal/staff/hours` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/staff/schedule` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/support-inbox` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/surveys` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/tags` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/messages` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/newsfeed` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/events` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/consents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/settings` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/notifications` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/account` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/account-billing` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/report-center` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/performance` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/supplies` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/enhancements` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/support` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/audit` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |

### Portal pages — admin (EN)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/portal/dashboard` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/attendance` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ English closed-day error «Sunday is a closed day — no check-ins are allowed today.» (screenshot bug6-attendance-closed-day-en) | ✓ |
| `/portal/calendar` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/children` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ missing guardian: `?error=guardian` localized banner; no child created | ✓ |
| `/portal/children/mwhq5xia-kjvq8yap` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ empty description rejected: `?error=incident-description` banner; no incident created | ✓ |
| `/portal/children/mwhq5xia-kjvq8yap/billing` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ invalid payment link: `?error=paymentlink` localized banner; no invoice created | ✓ |
| `/portal/children/mwhq5xia-kjvq8yap/development` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/children/development` | en | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) |
| `/portal/drive` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/finance` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/forms` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ empty title no-ops: redirect `?error=form-title` + localized banner; no form created | ✓ |
| `/portal/incidents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/inquiries` | en | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) |
| `/portal/learning` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/curriculum` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/activities` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/homework` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/reports` | en | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) |
| `/portal/rooms` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/rooms/mwhq5x84-n0hd3b9j` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/staff` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/staff/mwhq5x8x-3pa685dd` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ short password: `?error=password` localized banner; no account created | ✓ |
| `/portal/staff/hours` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/staff/schedule` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/support-inbox` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/surveys` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/tags` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/messages` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/newsfeed` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/events` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/consents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/settings` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/notifications` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/account` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/account-billing` | en | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) |
| `/portal/report-center` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/performance` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/supplies` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/enhancements` | en | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) |
| `/portal/support` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/audit` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |

### Portal pages — admin (AR)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/portal/dashboard` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/attendance` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ localized closed-day error «الأحد يوم عطلة — لا يُسمح بتسجيل الحضور اليوم.» (screenshot bug6-attendance-closed-day-ar) | n/a |
| `/portal/calendar` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/children` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ missing guardian: `?error=guardian` localized banner; no child created | n/a |
| `/portal/children/mwhq5xia-kjvq8yap` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ empty description rejected: `?error=incident-description` banner; no incident created | n/a |
| `/portal/children/mwhq5xia-kjvq8yap/billing` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ invalid payment link: `?error=paymentlink` localized banner; no invoice created | n/a |
| `/portal/children/mwhq5xia-kjvq8yap/development` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/children/development` | ar | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) |
| `/portal/drive` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/finance` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/forms` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ empty title no-ops: redirect `?error=form-title` + localized banner; no form created | n/a |
| `/portal/incidents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/inquiries` | ar | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) |
| `/portal/learning` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/curriculum` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/activities` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/homework` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/reports` | ar | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) |
| `/portal/rooms` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/rooms/mwhq5x84-n0hd3b9j` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/staff` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/staff/mwhq5x8x-3pa685dd` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ short password: `?error=password` localized banner; no account created | n/a |
| `/portal/staff/hours` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/staff/schedule` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/support-inbox` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/surveys` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/tags` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/messages` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/newsfeed` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/events` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/consents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/settings` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/notifications` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/account` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/account-billing` | ar | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) |
| `/portal/report-center` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/performance` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/supplies` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/enhancements` | ar | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) |
| `/portal/support` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/audit` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |

### Portal pages — teacher (EN)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/portal/dashboard` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/attendance` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ English closed-day error «Sunday is a closed day — no check-ins are allowed today.» (screenshot bug6-attendance-closed-day-en) | ✓ |
| `/portal/calendar` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/children` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ missing guardian: `?error=guardian` localized banner; no child created | ✓ |
| `/portal/children/mwhq5xia-kjvq8yap` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ empty description rejected: `?error=incident-description` banner; no incident created | ✓ |
| `/portal/children/mwhq5xia-kjvq8yap/billing` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ invalid payment link: `?error=paymentlink` localized banner; no invoice created | ✓ |
| `/portal/children/mwhq5xia-kjvq8yap/development` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/children/development` | en | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) |
| `/portal/drive` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/finance` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/forms` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | ✓ empty title no-ops: redirect `?error=form-title` + localized banner; no form created | ✓ |
| `/portal/incidents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/inquiries` | en | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) |
| `/portal/learning` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/curriculum` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/activities` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/learning/homework` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/reports` | en | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) |
| `/portal/rooms` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/rooms/mwhq5x84-n0hd3b9j` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/staff` | en | — (307 → /portal/staff/mwhq5xbh-djjtmerh) | — (307 → /portal/staff/mwhq5xbh-djjtmerh) | — (307 → /portal/staff/mwhq5xbh-djjtmerh) | — (307 → /portal/staff/mwhq5xbh-djjtmerh) | — (307 → /portal/staff/mwhq5xbh-djjtmerh) |
| `/portal/staff/mwhq5xbh-djjtmerh` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/staff/hours` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/staff/schedule` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/support-inbox` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/surveys` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/tags` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/messages` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/newsfeed` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/events` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/consents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/settings` | en | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) |
| `/portal/notifications` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/account` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/account-billing` | en | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) |
| `/portal/report-center` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/performance` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/supplies` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/enhancements` | en | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) |
| `/portal/support` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/portal/audit` | en | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) |

### Portal pages — teacher (AR)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/portal/dashboard` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/attendance` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ localized closed-day error «الأحد يوم عطلة — لا يُسمح بتسجيل الحضور اليوم.» (screenshot bug6-attendance-closed-day-ar) | n/a |
| `/portal/calendar` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/children` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ missing guardian: `?error=guardian` localized banner; no child created | n/a |
| `/portal/children/mwhq5xia-kjvq8yap` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ empty description rejected: `?error=incident-description` banner; no incident created | n/a |
| `/portal/children/mwhq5xia-kjvq8yap/billing` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ invalid payment link: `?error=paymentlink` localized banner; no invoice created | n/a |
| `/portal/children/mwhq5xia-kjvq8yap/development` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/children/development` | ar | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) | — (307 → /portal/learning) |
| `/portal/drive` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/finance` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/forms` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | ✓ empty title no-ops: redirect `?error=form-title` + localized banner; no form created | n/a |
| `/portal/incidents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/inquiries` | ar | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) | — (307 → /portal/forms?view=inquiries) |
| `/portal/learning` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/curriculum` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/activities` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/learning/homework` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/reports` | ar | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) | — (307 → /portal/report-center) |
| `/portal/rooms` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/rooms/mwhq5x84-n0hd3b9j` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/staff` | ar | — (307 → /portal/staff/mwhq5xbh-djjtmerh) | — (307 → /portal/staff/mwhq5xbh-djjtmerh) | — (307 → /portal/staff/mwhq5xbh-djjtmerh) | — (307 → /portal/staff/mwhq5xbh-djjtmerh) | — (307 → /portal/staff/mwhq5xbh-djjtmerh) |
| `/portal/staff/mwhq5xbh-djjtmerh` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/staff/hours` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/staff/schedule` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/support-inbox` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/surveys` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/tags` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/messages` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/newsfeed` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/events` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/consents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/settings` | ar | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) |
| `/portal/notifications` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/account` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/account-billing` | ar | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) |
| `/portal/report-center` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/performance` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/supplies` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/enhancements` | ar | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) |
| `/portal/support` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/portal/audit` | ar | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) | — (307 → /portal/dashboard) |

### Parent surfaces `/child/*` (EN)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/child` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/mwhq5xia-kjvq8yap` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/consents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/drive` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/events` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/forms` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/incidents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/learning` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/messages` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/newsfeed` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/notifications` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/settings` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/child/support` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |

### Parent surfaces `/child/*` (AR)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/child` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/mwhq5xia-kjvq8yap` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/consents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/drive` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/events` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/forms` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/incidents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/learning` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/messages` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/newsfeed` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/notifications` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/settings` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/child/support` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |

### Public / auth pages (EN cookie)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/login` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/register` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/forgot-password` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/reset-password` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/welcome` | en | — (307 → /login) | — (307 → /login) | — (307 → /login) | — (307 → /login) | — (307 → /login) |
| `/unknown-daycare` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/features` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/for-centers` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/for-parents` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |
| `/contact` | en | ✓ (no Arabic) | ✓ `dir=ltr` | ✓ | – | ✓ |

### Public / auth pages (AR cookie)

| Page | Locale | 1 · leakage | 2 · RTL/dir | 3 · dates/numbers | 4 · server msgs | 5 · back-to-EN |
|---|---|---|---|---|---|---|
| `/login` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/register` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/forgot-password` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/reset-password` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/welcome` | ar | — (307 → /login) | — (307 → /login) | — (307 → /login) | — (307 → /login) | — (307 → /login) |
| `/unknown-daycare` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/features` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/for-centers` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/for-parents` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |
| `/contact` | ar | ✓ (no EN dict/UI leak) | ✓ `dir=rtl` | ✓ | – | n/a |

## Summary

- owner/en: 41 routes — 38×200, 3×3xx, 0 non-2xx/3xx
- owner/ar: 41 routes — 38×200, 3×3xx, 0 non-2xx/3xx
- admin/en: 41 routes — 36×200, 5×3xx, 0 non-2xx/3xx
- admin/ar: 41 routes — 36×200, 5×3xx, 0 non-2xx/3xx
- teacher/en: 41 routes — 33×200, 8×3xx, 0 non-2xx/3xx
- teacher/ar: 41 routes — 33×200, 8×3xx, 0 non-2xx/3xx
- parent/en: 13 routes — 13×200, 0×3xx, 0 non-2xx/3xx
- parent/ar: 13 routes — 13×200, 0×3xx, 0 non-2xx/3xx
- anon/en: 11 routes — 10×200, 1×3xx, 0 non-2xx/3xx
- anon/ar: 11 routes — 10×200, 1×3xx, 0 non-2xx/3xx

Total routes scanned: 294; non-rendered (5xx/client): 0
