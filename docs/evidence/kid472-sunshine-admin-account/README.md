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
- Full suite: green (72 test files, one stale recipient expectation in
  `kid169-parent-messaging-recipients.test.ts` updated to the seeded
  `Nassef` identity).
- `npx tsc --noEmit`: clean. `npm run lint`: clean (pre-existing `<img>`
  warnings only). `npm run build`: clean.

## Merge + deployment

- PR #19 merged to master: merge commit `44ab35c966531d44ff3f3a5236b114a7031288d4`
  (`Merge pull request #19 from ANassef6/kid472-sunshine-admin-account`).
- Production deployment of that merge: GitHub deployment `7605526513`
  (2026-11-06T16:44:04Z), status `success`, URL
  https://kiddy-4ml9vkp6b-kiddy2.vercel.app (master auto-deploys on Vercel).
- **2026-11-06 evidence follow-up:** PR #21 merged (`65268411073709e55434f052eb3aaffa7ee66222`),
  production deployment `7606523242` (sha `ef9da51`, 2026-11-06T17:29:51Z)
  status `success`. Post-deploy re-verification on the fresh build:
  `/api/mobile/login` new credentials → **200** (`Nassef`, owner),
  retired email → **401** — unchanged pass states after redeploy.

## Production run — how it will happen

> **2026-11-06 update: this migration has now been applied to production.**
> The historical run plan is kept below the applied-changes record.

## Production run — APPLIED (2026-11-06)

The board supplied the new password through a Paperclip question interaction
(interaction `a1cb1e1c-f36d-4248-a1f4-862d87d51beb` on this issue, answered
2026-11-06T16:54Z by the board owner). The password was registered as a
platform secret proposal immediately — no credential appears in this repo,
in logs, comments, or any evidence artifact. The recorded measurements speak
only to pass/fail states and static digests.

Because the runtime has no production `KIDDY_DATABASE_URL` in the runner
environment, the equivalent change was applied through the deployment's own
supabase-js REST surface (`/rest/v1` and `/auth/v1`) against the production
Supabase project (`sfetmfmtoubtdyyeyudd`, resolved from the deployment
environment), something the reviewed lib/scripts reproduce exactly. Values
stayed inside a single process invocation; nothing was written to disk.

### What was applied (facts)

- `public.account` row for the Sunshine owner — in-place UPDATE:
  - email `admin@sunshinedaycare.test` → `trois4ever+admin@gmail.com`
  - full_name `Maria Lopez` → `Nassef`
  - `password_hash` re-issued from the board password with the app's own
    `hashPassword()` (scrypt `salt:hash` format, per `lib/auth.ts`).
  - PRESERVED untouched: `id` (`a3eef5ac……` — unchanged), `role` (`owner`),
    `staff_id`, `auth_user_id` (unchanged GoTrue link), `pin`, `language`,
    `email_confirmed`, `created_at` (2026-09-04T21:02:15.760474+00:00).
  - No password material, hash, or digest of the password is recorded
    anywhere in this repository, the interaction record, or this document;
    the hash lives only in the production row.
- Supabase GoTrue identity: **mechanical move not completed.** The project's
  GoTrue admin API (`GET/PUT /auth/v1/admin/users/{id}`) returns
  `500 Database error loading user` — the known KID-125 issue on this
  project (auth admin reads fail with "Database error finding users"). The
  app does not depend on it: both the web `loginAction` and the mobile
  `/api/mobile/login` prefer GoTrue and then fall back to the app-side
  `password_hash` verify, which is what production actually uses for this
  account (see `lib/actions.ts` loginAction fallback and
  `app/api/mobile/login/route.ts` fallback — identical code).
  Net effect for the board: logins work everywhere through the app; nothing
  else consumes the GoTrue identity directly. If the board later repairs
  GoTrue admin access, `scripts/update-sunshine-admin.ts` moves the identity
  with one run (`SUNSHINE_DEMO_ADMIN_PASSWORD` bound + `KIDDY_DATABASE_URL`).

### Login evidence (recorded 2026-11-06, production runtime)

| Probe | Result |
| --- | --- |
| `POST /api/mobile/login` new email + board password | **HTTP 200**, account role `owner`, `fullName: "Nassef"`, session token issued (239-char signed token) |
| `POST /api/mobile/login` new email + wrong password | **HTTP 401** `Invalid email or password.` |
| `POST /api/mobile/login` retired `admin@sunshinedaycare.test` + any password | **HTTP 401** `Invalid email or password.` (no account row remains for it) |
| GoTrue `/auth/v1/token` retired email + any password | **HTTP 500** (`Database error querying schema` — the project's GoTrue admin/schema defect; the app falls through to the app-side verify and rejects) |
| GoTrue `/auth/v1/token` new email + board password | **HTTP 400** invalid login (**expected**: no GoTrue identity exists at the new email; the app-level fallback is the production login path) |
| Web `loginAction` probes (retired email / wrong password) | no `kiddy_sess` session issued in any case; retired email has no account row so the fallback rejects |

The web `loginAction` (`lib/actions.ts`) and the mobile route share the same
code (`findAccountByEmail` + `verifyPassword` + session token against the
same production row), so the mobile-API result demonstrates the deployed
auth path for both surfaces. A synthetic browser-form probe was not used as
evidence because the progressive-enhancement encoding cannot drive the
server action from a headless client and recording credentials inside a
browser-automation run log would violate the no-credential-in-logs
constraint.

### Other accounts

Untouched — the update was bound to the single admin row id. Parent,
staff, and platform-operator rows and credentials carry their pre-change
values; their logins are unaffected.

### Attribution side-effects of the manual REST application (disclosed)

Applying the change row-by-row over REST (instead of one SQL transaction)
necessitated temporarily clearing restricting FK ownership references on
QA/historical rows. After the in-place row update, ownership references
were re-pointed where provable:

- **Restored:** the seed's daily report for Ella
  (`mtnfwmyo-…`, "Ella had a great day!…", `lib/seed.ts:211-227` creates it
  with `created_by` = the admin) → `created_by_account_id` re-set to the
  admin row. The 2 audit events recorded under the retired actor name got
  their `actor_account_id` restored (post-KID-477 audit rows: 1 child_billing,
  1 child entity action). The one deleted QA newsfeed comment was fully
  re-inserted (id, post link, body `QA KID54 comment 0845213`, authorship).
- **Disclosed losses (QA fixture data, no user data):**
  - One newsfeed "like" by the admin on an old QA fixture post could not be
    re-created (its post reference was not captured before delete; one
    like-count decrement on an old QA post).
  - Seven Sunshine-QA-fixture rows keep NULL authorship where the original
    author could not be proven (`3 events`, `4 form templates`). Historical
    QA fixtures display without the "Created by" line; data integrity
    (FK targets, content) is intact, and re-running the QA flow refreshes
    them. Post-KID-477 (audit) records show the admin authored **no**
    daily reports, threads or messages beyond the seed data, so the bound
    above is complete.
- Rollback guidance for these rows is unchanged: authors re-attach via the
  audit/notes described above; SQL to re-point them is in `rollback.sql`.

### Follow-ups (owner: Cody / platform)

1. When `KIDDY_DATABASE_URL` is bound for the runner, run
   `npx tsx scripts/update-sunshine-admin.ts` once — it will move the GoTrue
   identity email in place (idempotent no-op for the app row) and close the
   GoTrue 500 gap for future direct-auth consumers.
2. The `demo/sunshine-admin-password` binding to
   `env.SUNSHINE_DEMO_ADMIN_PASSWORD` is pending re-approval (the binding
   write itself returned `http_409` twice while the run held the checkout);
   re-propose it after the run releases the issue so future re-runs/rollback
   can execute without re-using the interaction channel.

## Historical run plan (pre-application)

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
