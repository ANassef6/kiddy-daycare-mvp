# KID-495 evidence — KID-489/6 temp-password change for staff and parent accounts

Branch: `kid495-temp-password` → `master` (PR + merge commit recorded here when merged).

## What shipped

1. **Migration `0036_kid495_temp_password.sql`** — `account.must_change_password SMALLINT NOT NULL DEFAULT 0`
   (ALTER with `IF NOT EXISTS`, so idempotent like the rest of the chain). Mirrored in
   `lib/sqlite-schema.ts`: the `account` CREATE TABLE carries the column AND an idempotent
   `PRAGMA table_info(account)` backfill ALTERs legacy local trees (same pattern as 0022).
2. **`lib/auth.ts`** — `createAccount({ mustChangePassword })`, `mustChangePasswordFor()`,
   `setMustChangePassword()`, `updateAccountPassword()` (hash write + flag clear in one UPDATE).
3. **`lib/actions.ts`**
   - `addStaffAction` / `linkStaffLoginAction` mark staff logins created with a shared
     password `must_change_password = 1`.
   - New `createParentLoginAction` — admin-created parent login beside the invite flow
     (child/guardian management page). Reuses `assertChildInScope` (tenant check),
     `linkFamily` + `linkSiblingsByParentEmail` (the registration linking logic), records
     one audit row (KID-477 convention), never puts the password in a URL.
   - New `changePasswordAction` — shared by staff/admin and parent settings: verifies the
     CURRENT password against the app hash, requires ≥ 8 chars, requires the confirm match,
     updates the Supabase GoTrue password when the account holds a GoTrue identity
     (sign-in → updateUser, failures logged loudly and non-blocking), ALWAYS rewrites
     `account.password_hash`, and clears `must_change_password`.
   - New `syncAppPasswordAfterResetAction` — called by /reset-password with the reset-issued
     Supabase access token; the server re-verifies the token against GoTrue for the same
     email before updating the app-side hash (unauthenticated calls are rejected).
4. **UI**
   - `components/ChangePasswordCard` rendered on `/portal/account` (staff/admin) AND
     `/child/settings` (parent) with `pw=` feedback from the action redirects.
   - `components/CreateParentLoginForm` on the children page next to the invite form
     (child, name, email, relationship, temp password with Generate button, credentials
     shared in person — nothing sensitive in the redirect).
   - Non-blocking amber banner after login (`app/portal/layout.tsx` + `app/child/layout.tsx`)
     linking to account settings; read failures degrade to "not flagged" so the shell never
     breaks. The banner disappears after a successful change (flag cleared).
5. **`/reset-password` now also updates the app-side hash** (fix for the
   "reset updates only Supabase" gap).
6. **i18n** — new `account.changePassword*` / `account.tempPassword*` / `children.createParent*`
   keys in BOTH the EN and AR dictionaries (parity pinned by language.test.ts).

## Checks (this run, local sandbox)

| Check | Result |
| --- | --- |
| `tests/unit/kid495-temp-password.test.ts` | 8/8 green (flag on temp-password staff + parent creations, wrong-current/short/mismatch rejections, hash update + flag clear verified with the real scrypt verify, parent redirect target) |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 (pre-existing `no-img-element` warnings in untouched files only) |
| `npm run db:verify-migrations` | "All migration checks passed" (PGlite chain includes 0036) |
| `npm run build` (next build) | exit 0 |
| `npm test` (full suite) | recorded below after the run completes |

## Acceptance mapping

- Admin can create a parent login with a temp password; the parent can log in with it →
  `createParentLoginAction` test + `verifyPassword` login check.
- Staff and parent change-password forms reject wrong current password, enforce ≥ 8 chars,
  update both auth paths (GoTrue when an identity exists, app hash always), and the new
  password works on the next login.
- Temp-password accounts see the change-password prompt after login (non-blocking banner +
  settings-page alert); it disappears after a successful change.
- Password reset updates both the Supabase password and the app-side hash.
- Invite/registration/tenancy behaviour untouched except the additive flag.

## Manual smoke (dev)

- `/portal/children` → "Create a parent login" card → Generate → login as the parent with
  the temp password → amber prompt renders in `/child` shell → `/child/settings` →
  change password → prompt gone → old password rejected on the next login.
