# Kiddy — Enhancements requests (owner-only, Vikunja-synced)

_Last updated 2026-10-30 (KID-268; documents KID-258 A1 + A2 as shipped)._

## 1. Feature note

Owner-only **Tools → Enhancements requests** page at `/portal/enhancements`.

- **Access.** Sidebar entry "Enhancements requests" rides the exact `role === "owner"`
  gate of Account billing (not `isAdminRole`). The page re-checks the session:
  any non-owner visiting the URL is redirected to `/portal/dashboard`.
- **Submit.** Title (max 80 chars) + description only. Creates a `queued` row with
  `customer_request` = the daycare's name (e.g. "Sunshine"). Confirmation text
  currently reads "It will appear in Linear shortly — the team will take it from
  there." An open request with the same title in the same daycare is rejected
  with a duplicate error. No app-side call to the sync target; no sync secret
  in app code.
- **Sync (Paperclip agent → self-hosted Vikunja).** Routine **"Enhancement requests
  Vikunja sync"** (id `fa3e1cbd-2488-4cb7-a2bd-ed140b330023`, assigned to Mika)
  sweeps `queued` / `linear_created` / `sync_error` rows each pass. For a queued
  record it creates a task in Vikunja project **"Enhancements requests"** (id 1)
  with label **"customer requests"** (id 4); the task description carries
  "Customer request: \<daycare name\>" plus the portal record id. No due date or
  priority is set at creation — the Kiddy team sets those in Vikunja.
- **Write-back.** `POST https://kiddyapp.net/api/enhancements/write-back`,
  Bearer `KIDDY_ENHANCEMENTS_SYNC_TOKEN` (fail-closed: unset env refuses every
  caller). `linear_created` stores the Vikunja task id/URL; `synced` stores
  priority + due date + expected delivery. The portal columns are still named
  `linear_issue_id` / `linear_issue_url` — they hold Vikunja ids/URLs; the rename
  is a follow-up ticket, not a bug.
- **Read-back fields shown to the owner.** Status, priority
  (Vikunja numeric 4/3/2/1 → urgent/high/medium/low; 0 or unmapped names omitted),
  estimate (always "—" for Vikunja-synced rows — no Vikunja equivalent), due date,
  expected delivery **= the Vikunja task's due date** (no estimate/milestone
  equivalent), and the link column (labelled "Linear" / "Open in Linear" as shipped —
  it opens the Vikunja task).
- **Delay.** Status changes appear after the next routine sweep. The schedule
  trigger is labelled "15-min sync sweep"; the observed cron at doc time is
  `0 * * * *` UTC (hourly) — allow one sweep interval before expecting movement.

Round-trip proof (KID-265): record `nowpu6rf-yg7r6cls` (Sunshine Daycare) went
`queued` → `linear_created` → `synced` against Vikunja task 2
("Sibling discount applied on monthly invoices"), expected_delivery 2026-11-14
= the task due date; idempotent replay confirmed.

## 2. EN/AR label table (lib/i18n.ts `nav.enhancements` + `enhancements.*`)

| UI location | EN | AR |
|---|---|---|
| Tools sidebar tab | Enhancements requests | طلبات التحسينات |
| Page title (h1) | Enhancements requests | طلبات التحسينات |
| Page subtitle | Ask the Kiddy team for an improvement to how your daycare runs. | اطلب من فريق كيدي تحسينًا في طريقة عمل روضتكم. |
| Form card heading | New request | طلب جديد |
| Title label | Title | العنوان |
| Title placeholder | e.g. Attendance export every morning | مثال: تصدير الحضور كل صباح |
| Description label | Description | الوصف |
| Description placeholder | What should change? Who is it for? What does it fix? | ما التغيير المطلوب؟ لمن؟ وما المشكلة التي يحلّها؟ |
| Submit button | Submit request | إرسال الطلب |
| Success line | Request submitted. It will appear in Linear shortly — the team will take it from there. | تم إرسال الطلب. سيظهر في Linear بعد قليل — الفريق سيتولّى الأمر من هناك. |
| Daycare line | Daycare: {name} | الروضة: {name} |
| List heading | Your requests | طلباتكم |
| Empty list | No requests yet. Submit one above and the team will pick it up. | لا توجد طلبات بعد. أرسل طلبًا من الأعلى وسيتولّاه الفريق. |
| Column: request | Request | الطلب |
| Column: status | Status | الحالة |
| Column: priority | Priority | الأولوية |
| Column: estimate | Estimate | التقدير |
| Column: due date | Due date | تاريخ الاستحقاق |
| Column: expected delivery | Expected delivery | التسليم المتوقع |
| Column: link (as shipped) | Linear / Open in Linear | Linear / افتح في Linear |
| Status queued | Queued | في الطابور |
| Status linear_created | In Linear | في Linear |
| Status synced | Synced | تمت المزامنة |
| Status sync_error | Sync retrying | إعادة محاولة المزامنة |
| Priority urgent / high / medium / low | Urgent / High / Medium / Low | عاجلة / عالية / متوسطة / منخفضة |
| Duplicate-title error | An open request with the same title already exists for your daycare. | هناك طلب مفتوح بنفس العنوان لروضتكم بالفعل. |
| Missing-fields error | Please fill in both a title and a description. | املأ العنوان والوصف معًا من فضلك. |

## 3. Ops runbook

- **Where the routine lives.** Paperclip routine id
  `fa3e1cbd-2488-4cb7-a2bd-ed140b330023`, title "Enhancement requests Vikunja
  sync", assigned to Mika, parent issue KID-265. The full step-by-step runbook
  (gateway session, cached ids, per-status pass) is the routine's description.
  Schedule trigger id `769130bd-55d6-4aff-b173-705d70777f8d` ("15-min sync sweep",
  `concurrencyPolicy: skip_if_active`, `catchUpPolicy: skip_missed`).
- **Pause / adjust cadence.** Pause the routine (or disable its schedule trigger)
  to stop sweeps; edit the trigger's cron expression to change cadence. Quiet by
  default: a pass with nothing to do closes silently; it comments only when
  something changed or failed.
- **Credentials.** Two granted secrets, both round-trip-verified: `vikunja`
  (Vikunja API key; header `Authorization: Bearer`, pinned) and
  `access.kiddy_enhancements_sync_token` (portal write-back bearer). Auth check
  is `GET /api/v2/projects` (this Vikunja build answers 404 on `/api/v2/me` even
  when authenticated). If either fetch fails the pass makes no writes and reports
  "Sync credentials unavailable" once. Never PUT to Vikunja after creation —
  `PUT /api/v2/tasks/{id}` replaces the whole task (description + labels were
  wiped once during setup and restored).
- **What `sync_error` means.** The last sync attempt failed; the detail is in
  `sync_error_detail` and shown under the row in red. The record stays open and
  visible — it is retryable, not terminal.
- **How to retry.** Automatic: every pass sweeps `sync_error` rows (records without
  a task id are re-created; records with one are re-read). No manual step needed.
  Write-back guardrails: replaying the same packet returns 200 no-change;
  regressions are refused with 409; 403 means the packet's daycare does not match
  the row (cross-daycare writes are never applied); 404 unknown request id.
