# KID-684 — Invoice creation notifies each linked parent

User report (KID-215): an admin created an invoice for "Becca Nassef" and the
family parent received no push and no in-app notification although billing
notifications are enabled on both channels. Root cause: `createChildBilling`
(lib/store.ts) wrote the row and an audit event but never emitted through the
shared KID-474/KID-480 notification pipeline.

## Reproduction on master (before the fix)

`tests/unit/kid684-invoice-created-notification.test.ts` — written first, on
current master 9bf1c04 it failed **10/10**: creating a child invoice emitted no
notification row, no push, the deep link branch and the EN/AR view copy were
missing. That failure is the reproduced gap.

## Fix

Commit `374e1b8` (PR #47, merged into master as `070a2b0`):

- `createChildBilling` now emits one `invoice_created` notification per linked
  `role='parent'` account via `emitNotifications` — activity `billing`, dedupe
  ref `invoice-created-<billingId>`, best-effort (the write always stands).
- Push rides the freshly inserted rows via `sendPushToAccounts` (VAPID),
  per-channel prefs honored: in-app opt-out kills row+push; push-only opt-out
  keeps the bell row and silences the device (existing KID-480 gating).
- No self-notify: the audience is `parentAccountIdsForChild` only — the
  creating admin and non-parent family links never receive anything.
- No duplicates: the ref pins the billing id, so a replayed emission inserts
  nothing and never re-pushes; editing/re-saving (status changes) emits
  nothing; every genuinely new invoice (new id) notifies once.
- Deep link is role-correct: push payload `url` and the notification-center
  row open `/child/<childId>#invoices` (anchor added to the parent child
  page) — never the admin portal.
- EN/AR copy `feed.invoiceCreatedTitle` — the notification names the child and
  the invoice; the body carries the amount and due date; the view renders per
  account locale from the locale-independent payload.

No schema change and no migration: `child_billing`, `notification` and
`notification_pref` (activity `billing`) already existed.

## Tests

- New file `tests/unit/kid684-invoice-created-notification.test.ts`, 10 tests:
  one row per parent, replay/edit no-dup, second-invoice fresh unique refs,
  no self-notify (staff link + admin), independent channel opt-outs over real
  subscription rows, deep link + localized push copy (web-push stubbed at the
  boundary). All green after the fix.
- Full battery on the fix tree: `922/923 tests passed` in 85/86 files — the
  single failure was KID-152 "hook timed out in 10000ms" under the ~75 min
  load run; the file passes 7/7 in isolation (seed-timeout flake, unrelated).
- `tsc --noEmit` clean; `next lint` clean (one pre-existing warning);
  `next build` green.

## Deployment

- GitHub deployment 7625792681 (environment production, sha `070a2b0`,
  state success 2026-11-07T19:15:21Z); kiddyapp.net login returns HTTP 200.

## Production-build end-to-end verification (real traffic, real UI)

A local production build (`next build` + `next start`) of exactly the deployed
commit `070a2b0`, demo seed, fresh SQLite db, real VAPID keypair configured —
driven through Skyvern (browser automation) over the Docker network plus
direct HTTP page reads of the served HTML:

1. Admin (demo `trois4ever+admin@gmail.com`, the production account identity)
   signed in through the login page and created the invoice via the real
   admin billing form at `/portal/children/<childId>/billing`
   (description "KID-684 verification", amount 120000 cents, EGP, pending).
   Observation after the Skyvern run — one row in `child_billing`
   (`mw6t7t2g-cogq9cfu`).
2. Exactly one notification row was emitted for the linked parent account,
   captured from the served database:
   `activity=billing, kind=invoice_created, ref=invoice-created-mw6t7t2g-cogq9cfu`,
   payload childId/childName ("Ella Nguyen")/description/amount ("1200.00
   EGP"). No notification row for the admin actor (no self-notify).
3. Parent notification center `/child/notifications` (served as the parent's
   session) renders the unread row "New invoice for Ella Nguyen: KID-684
   verification" with body "1200.00 EGP", a per-row "Mark read" button and the
   title link `href="/child/mw6shut2-unetm6x3#invoices"` (role-correct deep
   link, parent surface, never the admin portal). The top-bar bell shows
   "3 unread notifications" (the new row included).
4. Parent child page `/child/<childId>` shows the `id="invoices"` anchor and
   the Invoices section with "KID-684 verification" 1200.00, status pending,
   plus the payment-proof/upload form — the deep-link target exists.

## Push honesty (what was and was not verified)

- Verified: the push fan-out configuration runs on a real VAPID keypair in the
  verification build (`sendPushToAccounts` is the same vetted KID-480 path
  used by the daily-report/newsfeed/announcement pushes that are live on
  production today); unit tests pin the push call carries the same payload and
  the role-correct URL.
- NOT verified: receiving the notification on a real device in this run.
  Skyvern's headless Chromium reports "does not support push notifications"
  (no service-worker permission grants headless), and the production admin /
  parent account passwords are unavailable to QA runs (KID-489 QA and KID-497
  QA documented the same gap), so the real kiddyapp.net accounts could not be
  driven. The remaining device check is: after this deploy, creating an
  invoice for a child whose parent has a push subscription must surface the
  notification on that device; that leg is pending someone with the real
  account passwords (or a volunteer device login).
