# KID-472 item 7 — Sunshine demo admin identity migration evidence

## What changed in the repo

- `lib/sunshine-admin.ts` — single source of truth for the migration: old email
  `admin@sunshinedaycare.test`, new email `trois4ever+admin@gmail.com`, display
  name `Nassef`. It updates the `public.account` row (email, full_name,
  password hash) preserving the account id, `staff_id` link, role and tenant,
  and in Postgres mode moves the attached GoTrue identity (`auth.users` +
  `auth.identities`) to the new email, refreshing the bcrypt password and the
  identity/metadata emails. The identity is never created or deleted.
- `scripts/update-sunshine-admin.ts` — the reviewable production runner:
  `npx tsx scripts/update-sunshine-admin.ts`. Reads `KIDDY_DATABASE_URL` and,
  for the password step, `SUNSHINE_DEMO_ADMIN_PASSWORD` from the environment.
  The password value is never printed, logged, or written anywhere.
- `lib/seed.ts` — local/dev seeds now create the new identity, so the old
  email cannot reappear in a fresh deployment.
- `scripts/setup-mobile-demo.mjs`, `mobile/scripts/smoke-api.mjs` — demo
  login surfaces moved to the new email. `smoke-api.mjs` accepts
  `KIDDY_SMOKE_ADMIN_PASSWORD` so a production smoke pass never needs the
  demo password in the repo.
- `tests/unit/kid472-sunshine-admin-account.test.ts` — 9 focused tests:
  seed identity, email/name pass preserving id + staff link + hash, password
  pass, second-pass idempotency, name-only pass never manufacturing a
  password, stale-row reporting, refusal to invent accounts, verify() failure
  mode, tenancy/authored-record preservation.
- Fixtures referencing the seeded admin in `tests/unit/*` and
  `supabase/verify-migrations.mjs` follow the new identity. Parent and
  platform-operator demo accounts are untouched. Historical QA/evidence
  documents keep their original values; living docs were updated.

## Test evidence (local)

- `tests/unit/kid472-sunshine-admin-account.test.ts`: 9/9 pass
- Full suite, tsc, lint, build: recorded below when this branch handed off.

## Production run — how it will happen

1. Run with the password secret approved and bound: `SUNSHINE_DEMO_ADMIN_PASSWORD`
   → `KIDDY_DATABASE_URL` (production).
   `npx tsx scripts/update-sunshine-admin.ts`
2. The script verifies both the app row and the GoTrue identity, and fails
   loudly on any stale row still carrying the old email.
3. Browser pass on https://sunshine.kiddyapp.net with the new credentials +
   mobile login smoke (`mobile/scripts/smoke-api.mjs`,
   `KIDDY_SMOKE_ADMIN_PASSWORD=<board value>`).

## Rollback

`rollback.sql` in this directory restores the previous email/name identity so
tooling that pinned the old address behaves again. Password rollback is
deliberately not included: the old placeholder password must not return, and
re-issuing access is a board action. Placeholders are marked and must be
filled from production rows before use.
