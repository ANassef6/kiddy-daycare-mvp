# KID-1329 — P1 security: role-enforcement fixes (pickup over-exposure, family messaging, center check-in toggle)

Source: KID-1312 `role-matrix-retest` (app-layer NO-GO, 1 Critical / 2 P1 / 2 P2 /
7 blocked-partials). Owner direction (KID-215, 2026-11-09): fix every finding,
tests non-destructive on synthetic data only. Scope per the KID-1329 plan; the
cross-tenant BOLA class stays with its own P0 task (KID-1328, separate run).

Work is on `security-rc-integration` (the KID-1272 release-candidate branch),
commits `46514e0` + `c211a7f` on top of `b343fd0`. The branch is a shared
workspace (KID-1274 runs concurrently on the same checkout), so sibling-run
edits (KID-1328) are left uncommitted in the tree and were deliberately kept
out of these commits (staged via a store.ts index blob that carries only the
KID-1329 hunks).

## Defect 1 — pickup child detail over-exposure (P1)

Pre-fix: `/child/[id]` had no pickup branch — a pickup account saw today's
statuses, the daily report (with `?date=` navigation), invoices and the
payment-proof uploader, newsfeed, pickup contacts, and incident reports. The
spec allows pickup ONLY the child name/photo and today's pickup time (set,
update, cancel).

Fix (`app/child/[id]/page.tsx`):

- A dedicated render branch for `familyAccessForAccount === "pickup"`: name,
  photo, the check-in/out control (which is the pickup-time setter/check-out)
  and the pickup-time readout. Every other section is removed from the render
  AND its queries are never fetched (no invoices/newsfeed/incidents reads for
  a pickup session at all).
- Non-parent sessions (staff) and parent/family links keep the existing
  rendering unchanged.
- `/child/newsfeed` for pickup now dies with a REAL 404:
  `requireFamilyPage` previously redirected denied pickup slugs
  (`redirect()`), which under a streaming `loading.tsx` shell surfaces as
  HTTP 200 with a redirect body — exactly what the KID-1312 retest observed.
  Denied pickup slugs now call `notFound()` (carry-over to all pickup-denied
  slugs is spec-consistent: a 404 still satisfies "real 404 or redirect").
- Mobile parity: `GET /api/mobile/children/[id]` degrades to a name/status
  payload for pickup accounts (no todayReport, no contacts/newsfeed/incidents
  fields).

## Defect 2 — family messaging hidden (P1)

Pre-fix: `FAMILY_DENIED_ACTIONS` (lib/contact-relationship.ts) did not include
`sendMessage`, so a family link could send messages and render the
`/child/messages` composer; message notifications were emitted to family
accounts as well.

Fix:

- `isActionAllowed('family','sendMessage')` is now false (server action,
  `sendParentMessageAction`, redirects to `/child?error=role`).
- `requireFamilyPage` redirects family links away from `/child/messages`
  (server deny; the nav removal alone is cosmetic).
- The Chat nav entry disappears for family links (app/child/layout.tsx);
  every other family (view-only) entry stays.
- Message notifications: `sendMessage` suppresses the KID-474 durable
  emission (in-app + push, both ride `emitNotifications`) when the recipient
  is a parent-role account whose most-permissive family link is family or
  pickup. Staff recipients are unaffected (an ACCOUNT role is not a family
  link), and the message row itself is still written — family is
  view-silent, not data-cleared.
- `tests/unit/contact-relationship.test.ts` was updated to pin the new
  ladder (family denied messaging).

## Defect 3 — center toggle "Allow parents to check in/out" (P1)

Pre-fix: no such setting existed; `checkInOutAction` checked role, child
scope and center hours only, and the mobile route mirrored that.

Fix:

- `supabase/migrations/0042_kid1329_parent_checkin_toggle.sql`:
  `ALTER TABLE institute ADD COLUMN IF NOT EXISTS allow_parent_check_inout
  SMALLINT NOT NULL DEFAULT 1` (default ON). Mirrored in
  `lib/sqlite-schema.ts` (CREATE TABLE column + PRAGMA backfill for older
  databases).
- Center settings UI (portal `/portal/settings`): one checkbox on the
  center-details form with EN/AR labels (`settings.allowParentCheckInOut`,
  `settings.allowParentCheckInOutHint`). Hidden `0` + checkbox `1` makes a
  save without a check an explicit OFF; `saveCenterDetailsAction` persists
  `allow_parent_check_inout`.
- Enforcement, web: `checkInOutAction` (lib/actions.ts) rejects parent-role
  accounts (access family/parent) with a clear error
  ("The daycare has turned off parent check-in/out…") when the toggle is
  off, and writes nothing. Enforcement, mobile: `POST
  /api/mobile/children/[id]/check-in` returns 403 with the same error.
- Exemptions preserved: the pickup role keeps its dedicated pickup-time
  registration (the toggle governs the parent surface, not the pickup loop),
  and staff keep their attendance controls.
- UI hiding: the parent child-detail check-in/out control and the portal
  attendance per-row control disappear for parent sessions while OFF;
  attendance status (badge, times, room statuses) remains visible in both.

## Tests

`tests/unit/kid1329-role-enforcement.test.tsx` (14 tests) — pins every
pre-fix behavior (each fails on the release-candidate tree) and the fix:

- Pickup detail renders name/photo + pickup-time control only; the seeded
  report/newsfeed/contact strings never appear; `label()` helpers come from
  the dictionary rather than hardcoded copy.
- `/child/newsfeed` for pickup throws the next `NEXT_HTTP_ERROR_FALLBACK`
  (a real 404), not a streaming redirect.
- Family: `/child/messages` page redirect, `sendParentMessageAction`
  refused with zero message rows, message-notification suppression for
  family recipients WITH the real-parent control case, Chat nav hidden from
  the rendered parent layout while the rest of the nav survives.
- Toggle: mirror defaults ON and persists; web action rejects OFF (no
  check_in row) + clear error, works ON (row created); pickup exemption with
  toggle OFF; parent UI hidden OFF / visible ON with status visible; mobile
  403 OFF / 200 ON; pickup mobile detail minimal payload with the parent
  control case; portal settings renders the checkbox (checked default,
  unchecked after OFF).

## Gates

- `tsc --noEmit` clean.
- `npm run lint` 0 errors (pre-existing `no-img-element` warnings only).
- `npm run db:verify-migrations` — all migration checks passed (0042
  included).
- `npm test` full unit battery — see the comment on the Paperclip issue for
  the final run result.
- `npm run build` — see the same comment (run against the shared tree; the
  only uncommitted tree deltas are the concurrent KID-1328 run's pages).

## Notes for the retest

- The pickup/family role ladder remains single-source-of-truth
  (lib/contact-relationship.ts): parent full, family view-only with messages
  hidden, pickup name/photo + pickup time only, no_access blocked.
- The center toggle is intentionally ONE setting (KID-215 spec), defaulting
  ON for every existing deployment (column DEFAULT 1; missing/legacy values
  read as ON).
- Pickup check-out semantics are unchanged: the check-out transition is the
  "cancel/update today's pickup time" operation the spec allows.
