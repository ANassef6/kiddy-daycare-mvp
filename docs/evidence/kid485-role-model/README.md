# KID-485 — Role model and staff access update

## What shipped

- **Role union** (`lib/role.ts`): `owner | admin | teacher | caregiver | parent`.
  `staff` and `carer` are gone from the union and can no longer be minted
  (`createAccount` throws on them). `isAdminRole` keeps exact owner|admin
  semantics; `isOwnerRole` unchanged (Account billing stays owner-only).
- **Migration 0033** (`supabase/migrations/0033_kid485_role_model.sql`):
  `staff.role` default → `teacher`; legacy `carer`/`staff` staff rows and
  account rows become `teacher`; an admin-labeled staff record promotes its
  linked login to `admin` (already-admin/owner accounts untouched); owner rows
  and accounts untouched; fully idempotent. PostgreSQL chain verified by
  `node supabase/verify-migrations.mjs` (full chain apply + rename / promote /
  owner-stops-untouched / default-on-new-row / replay-changes-nothing checks,
  all green). SQLite mirror carries the same idempotent backfill in
  `lib/sqlite-schema.ts` (pin in tests/unit/kid485-role-model.test.ts).
- **Staff assignment surfaces** — Add-staff and Edit-profile offer exactly
  Admin / Teacher / Caregiver; Owner, Carer, Staff are no longer assignable;
  an owner staff record renders its role read-only and the server drops any
  role value for owner profiles. Staff list chips: Owner (display), Admin,
  Teacher, Caregiver.
- **Account role sync** — `addStaffAction` creates the linked login with the
  staff role; `linkStaffLoginAction` aligns the account role with the staff
  role (promotes an admin staffer's login; never demotes a standing
  owner/admin); `updateStaffInfoAction` follows the staff role change through
  to the linked login (never the owner account), and ignores retired `staff`
  / `carer` / forged `owner` values.
- **Admin access** — Admin accounts get the real admin portal (staff
  directory, all children, finance, reports, forms, surveys, performance,
  rooms, supplies, audit). Account billing remains owner-only.
- **Enhancements requests** — gate moved from owner-only to owner/admin on the
  sidebar tab, the page guard, and the submit action. teacher/caregiver/parent
  never see the tab and are refused server-side at the URL.
- **Teacher** — replaces `staff`/`carer` everywhere as the classroom-scoped
  floor (newsfeed/activities recipient scoping, messaging role lists,
  staff-performance SQL, help-center audience, i18n labels EN+AR).
- **Caregiver (new, read-only)** — can log in, sees only the children area
  scoped to assigned classrooms (unassigned scopes to `[]`, fail closed —
  `scopedRoomIds`), can log child status (`saveChildStatusAction`, which
  authorizes by classroom scope) and manage its own account (photo, language,
  notification prefs). Every other business write is refused server-side
  (`refuseCaregiver` in 42 write actions), and direct URL access to any other
  portal area redirects to `/portal/children` (`requirePortalPage`, allowed
  prefixes: `/portal/children`, `/portal/account`, `/portal/notifications`).
  Caregiver nav shows only the Children group and the messages icon is hidden
  in the shell.

## Verification

- `npx vitest run` — 780 tests green except tests owned by concurrently
  in-flight tasks (kid499/kid160 suites landed by the other run mid-flight).
  The dedicated `tests/unit/kid485-role-model.test.ts` (16 tests) pins the
  role union, the data migration on the SQLite mirror, staff-role assignment
  through the actions (owner protection, retired-value immunity, login-role
  sync), caregiver page-gate fail-closed set, caregiver write refusal
  server-side, caregiver classroom-only child-status logging, and unassigned
  caregiver scoping.
- `node supabase/verify-migrations.mjs` — "All migration checks passed."
- `npm run lint` — clean (pre-existing `<img>` warnings only).
- `npx tsc --noEmit` — clean for all KID-485 files (remaining errors are
  concurrently-owned in-flight test files).
- `npm run build` — production build clean.

## Rollback

- Migration 0033 is rename-only and idempotent; rolling back means restoring
  the prior code and running an inverse rename (`teacher`→`carer` is
  ambiguous by design and must not be automated — consult the audit trail and
  the site owner before reverting any production data).
