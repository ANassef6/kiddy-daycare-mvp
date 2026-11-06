# KID-477 — KID-472 item 5/10: Unified audit trail + inline actor/timestamp attribution

## What was built

### 1. `audit_event` table (Postgres migration + SQLite mirror)
- `supabase/migrations/0030_audit_event.sql`: `audit_event` = id, institute_id
  (FK CASCADE), actor_account_id (FK SET NULL), actor_name (denormalized
  snapshot), action, entity_type, entity_id, summary, metadata (JSON string,
  byte-compatible across engines), request_path, created_at. Indexes:
  `(institute_id, created_at DESC)`, `(entity_type, entity_id, created_at DESC)`,
  `(actor_account_id, created_at DESC)`.
  Additive columns on `daily_report`: `updated_at`, `updated_by_account_id`
  (FK SET NULL) — daily-report edits previously overwrote the row with no trail.
- `lib/sqlite-schema.ts` mirrors the table + indexes and backfills the two
  `daily_report` columns for databases created before the migration.

### 2. `lib/audit.ts` helper
- `recordAuditEvent({ instituteId, actorAccountId, actorName?, action,
  entityType, entityId, summary, metadata?, })` — resolves the actor-name
  snapshot from `account` when not supplied, captures the request referer path
  lazily (no-op outside request scope), writes exactly one row per call.
  Audit failures are logged loudly and never block the user action they
  describe. Metadata is bounded, non-sensitive (ids, field names, counts) —
  never credentials or full message/report bodies.
- `listAuditEvents({ instituteId, from, to, actorAccountId, entityType, limit,
  offset })` — tenant-scoped (institute_id is always in the WHERE), newest
  first, paginated with full count; `auditEntityTypes`/`auditActors` feed the
  filter dropdowns; `attributionFor(entityType, entityId)` returns the first
  create + latest update for inline attribution.

### 3. Instrumented mutations (exactly one audit row per user-visible mutation)
`lib/actions.ts`: check-in/out (attendance), daily report create+edit,
newsfeed post/comment/like-unlike (both composer paths), thread messages
(send, composer group/private blast one row per action, thread replies,
parent DMs), consent create + parent response, incident create + parent
acknowledgement, supplies create + status change, rooms create/update, staff
create + profile edit + photo change, child create (enrollment) + profile edit
+ photo change, events + event media, form/survey template create + parent
submission + response status flip (via setFormResponseStatusAction — status
only), support tickets open + status change, child billing lines + status
change, settings (branding, center details, working hours), and the
platform-side tenant changes (daycare enable/disable, billing settings,
invoice amount override, mark-paid). Summaries never carry message/report
bodies, credentials, or contact details; ids only in metadata.
`lib/store.ts`: `upsertDailyReport` now stamps `updated_at` /
`updated_by_account_id` on the update path (created_by stays the original
author), `reportFor` carries created/updated names for the UI,
`listSupplies`/`listConsents`/`listChildBilling` join the creator snapshot.

### 4. Inline attribution
- `components/Attribution.tsx` — shared server component rendering
  "Created by {name} · {when}" and "Updated by {name} · {when}"
  (i18n keys `audit.createdBy` / `audit.updatedBy`, EN + AR).
- Staff daily-report editor (`app/portal/children/[id]`) and the parent read
  view (`app/child/[id]`) show both lines under the report (newsfeed surfaces
  already render author · timestamp inline, unchanged).
- Supplies list, consent list, and the child-billing table show "Created by …"
  under each record; incident cards already render "reported by {name} · date".

### 5. Admin audit-trail page
- `app/portal/audit` — admin/owner-only (non-admins redirect to the
  dashboard), tenant-scoped via `resolveTenantInstituteId()`. Filters: date
  range (from/to, validated), actor, record type; pagination (25/page) with a
  "x–y of N" line; linked into the Tools sidebar group only for admins.
  Platform-operator operator-view sessions keep their existing
  admin-shaped-entry behavior (unrelated code untouched).

## Test evidence
- `tests/unit/kid472-audit-trail.test.ts` — 14 tests:
  one-row-per-event with actor-name snapshot + metadata round-trip,
  explicit-actor override, failure-resilience (circular metadata never blocks
  the caller), tenant-scope isolation, actor/type filters, inclusive date
  range (incl. the SQLite space-vs-`T` comparison boundary), pagination vs
  total, filter-dropdown helpers, daily-report edit trail (created_by stays
  the first author, updated_* stamped, joined names), `attributionFor`
  create/latest-update pick, and a static pin that all 22 instrumented
  actions still declare their audit `entityType`.
- Full suite: **70 files / 718 tests passed** (includes this suite).
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean (pre-existing `<img>` warnings only).
- `npm run build` — clean; `/portal/audit` route present in the manifest.

## Performance notes
- Each mutation adds exactly one INSERT (indexed table) plus, when the actor
  name was not passed, one indexed `account` primary-key lookup. Read paths
  add: the audit page (one COUNT + LIMIT + 2 small GROUP BYs, all
  institute-indexed) and one correlated-subquery join on the supplies /
  consents / billing listings (limit = page size). No N+1 per record and no
  change to the write path of any feature other than the extra INSERT. The
  daily-report hot path reuses the existing query; `reportFor` gained one
  extra LEFT JOIN (indexed by PK).
