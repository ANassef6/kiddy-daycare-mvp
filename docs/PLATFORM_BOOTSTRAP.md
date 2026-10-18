# Platform bootstrap: superadmin (KID-199.3)

The platform operator role is `superadmin`. It is not a center role:
`isAdminRole` (`lib/role.ts`) still means exactly owner|admin, so center
permissions are unchanged. A superadmin resolves to **no tenant** — pages and
server actions that read the session tenant (`lib/tenant.ts`) get an empty
institute id for them, and the KID-199.4 `/platform` surface will handle
per-daycare selection explicitly.

Registration is invite-only, so nobody can sign up as a superadmin through the
normal flow. There are exactly two supported ways to get one.

## 1. Local / demo (seed)

`lib/seed.ts` (`seedDemo`, run by `npm run db:init` and by the lazy
first-boot seed in `lib/bootstrap.ts`) creates:

| email                     | password         | role       |
| ------------------------- | ---------------- | ---------- |
| `superadmin@kiddy.test`  | `kiddy-superadmin` | `superadmin` |

Env overrides: `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` change both values
during seeding. Seeding is idempotent: an existing account with that email
gets the role granted instead of a duplicate row.

## 2. Production (no new account — grants onto an existing one)

Set the environment variable before the app (or the seed script) runs:

```
SUPERADMIN_EMAIL=ceo@example.test
```

On the first `ensureSeeded()` pass (`lib/bootstrap.ts`) or any `npm run
db:init`, the account with that **exact email is upgraded to `superadmin`**.
If no account carries that address, `ensureSuperadmin()` creates one — in
that case set `SUPERADMIN_PASSWORD` too and treat the default as demo-only.
Registration remains invite-only for parent/staff flows; this is the one
server-side bootstrap path for an operator, and it never goes through the
invite flow.

Both paths are idempotent — an account already holding the role is left alone.

## Enabling / disabling a daycare

`institute.active` (`supabase/migrations/0022_institute_active.sql`, mirrored
in `lib/sqlite-schema.ts`; default `1`) is the flag. Today it is data only,
enforced in code:

- Staff and parents whose **entire** tenancy sits on a disabled institute are
  blocked at login (`lib/actions.ts loginAction`) and at portal/parent entry
  (`lib/require.ts requireSessionWithWithdrawalCheck`), with the message
  "This daycare is currently disabled. Contact the platform team."
- The superadmin role bypasses the gate.
- Re-enabling (`active` back to `1`) restores access immediately.

`store.setInstituteActive(instituteId, enabled)` is the write helper; the
KID-199.4 `/platform` UI will call it from a superadmin-only server action.
