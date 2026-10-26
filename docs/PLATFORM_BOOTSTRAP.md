# Platform bootstrap: the operator allowlist (KID-199.4r)

The platform operator is **not a role** (board decision, KID-210). The daycare
role system stops at owner | admin | staff | carer | parent (`lib/role.ts` —
`isAdminRole` still means exactly owner|admin), and no daycare account can be
given platform access through any UI or API (`lib/auth.ts createAccount`
validates roles against that union and rejects everything else).

Access to the `/platform` surface (daycare list, activate/deactivate toggle,
create-daycare form) is decided by an **environment-based operator allowlist**
(`lib/platform.ts`):

```
PLATFORM_ADMIN_EMAIL=ceo@example.test,ops@example.test
```

- The gate runs in the `/platform` page guard (`app/platform/layout.tsx` and
  `app/platform/page.tsx`) and is re-checked inside every platform server
  action (`requirePlatformOperator` in `lib/actions.ts`), because actions can
  be POSTed directly.
- The bootstrapped operator account carries an internal sentinel value
  (`platform`) on its account row so tenant resolution treats it as
  "no tenant" (`lib/tenant.ts`). It is never selectable, never assignable,
  and only reconcile/dataset rows can ever carry it.
- Removing an email from the allowlist cuts access immediately, even for an
  already-signed-in operator.

## How production obtains access

1. Set `PLATFORM_ADMIN_EMAIL` (comma-separated for multiple operators) before
   the app runs.
2. On the first `ensureSeeded()` pass (`lib/bootstrap.ts`) or any
   `npm run db:init`, `ensurePlatformOperator()` (`lib/seed.ts`):
   - renames any pre-rework `superadmin` role rows to the internal sentinel
     (the SQL-layer equivalent is `supabase/migrations/0023_platform_operator_role.sql`),
   - creates the account for the allowlisted email if none exists — set
     `PLATFORM_OPERATOR_PASSWORD` in that case, since the default is the demo
     value.
   - With **neither** env set, production bootstrap does nothing: the demo
     credentials are never minted into a deployment. This is the safety rail
     that keeps the documented demo password off public hosts.
3. Sign in with that email on the normal login page — **`https://kiddyapp.net/login`**
   (the canonical platform address, KID-237) — and the session lands on
   `/platform`.

Registration stays invite-only; this is the only server-side path that can
create the operator account, and it never goes through the invite flow.
Wire the script to the operator: `SUPERADMIN_EMAIL` and
`SUPERADMIN_PASSWORD` remain read as fallbacks for existing deployments that
set them (KID-199.3 compatibility), but `PLATFORM_ADMIN_EMAIL` /
`PLATFORM_OPERATOR_PASSWORD` are the current names.

## Local / demo (seed)

`lib/seed.ts` (`seedDemo`, run by `npm run db:init` and by the lazy first-boot
seed) idempotently ensures the demo operator exists:

| email                  | password           |
| ---------------------- | ------------------ |
| `superadmin@kiddy.test` | `kiddy-superadmin` |

`PLATFORM_ADMIN_EMAIL` / `PLATFORM_OPERATOR_PASSWORD` override both values.
Re-running seeding upgrades an existing account (the row keeps working after
each new deploy).

## Enabling / disabling a daycare

`institute.active` (`supabase/migrations/0022_institute_active.sql`, mirrored
in `lib/sqlite-schema.ts`; default `1`) is the flag. It is enforced in code:

- Staff and parents whose **entire** tenancy sits on a disabled institute are
  blocked at login (`lib/actions.ts loginAction`) and at portal/parent entry
  (`lib/require.ts requireSessionWithWithdrawalCheck`), with the message
  "This daycare is currently disabled. Contact the platform team."
- The platform operator bypasses the gate (they are the ones who re-enable).
- Re-enabling (`active` back to `1`) restores access immediately.

`store.setInstituteActive(instituteId, enabled)` is the write helper; the
`/platform` toggle calls it from an operator-only server action.

## Creating a new daycare from `/platform`

`createDaycareAction` (`lib/actions.ts`) → `store.createDaycare`
(`lib/store.ts`) sets up, in one submit:

- the `institute` row (name, theme tokens, optional logo URL),
- one `branch` row per branch — "Main" first, extras named `Branch 2..N`
  (1–20, per the board's "number of branches" field),
- the first `owner` staff row plus a role-`owner` account whose
  `account.staff_id` is linked, so tenant resolution places the owner at the
  right daycare immediately (loginable right after creation),
- an optional logo upload through the same Supabase storage path the
  `/portal/settings` branding upload uses, persisted to `institute.logo_url`
  so `lib/theme.ts` branding renders it,
- a theme preset (ocean/sunset/forest/midnight) mapped onto the existing
  `primary_color` / `accent_color` / `font` tokens; "custom" takes typed
  values instead. No separate theme system and no new tables.
