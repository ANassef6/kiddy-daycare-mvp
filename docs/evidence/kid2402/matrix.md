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
