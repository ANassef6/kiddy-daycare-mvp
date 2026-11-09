# Deploy environment secrets (KID-1175)

This document is the deploy-time contract for the secrets the server needs.
Local development never needs them — outside production every unset secret
falls back to a safe local default so plain-http local dev keeps working.

## `SESSION_SECRET` — session cookie signing key (KID-1175 F-04, was KID-686)

- **What it does:** signs the 30-day stateless `kiddy_sess` session cookie
  (HMAC-SHA256). Sessions carry only the account id/role/email/confirmation —
  no server-side session table exists to purge.
- **Requirement:** in production this is **mandatory**. The server fails to
  boot (module-load throw) unless the value is:
  - present and non-blank (missing / empty / whitespace-only → refuse),
  - NOT the retired dev constant `dev-only-secret-change-me` (→ refuse),
  - at least 32 characters of high-entropy randomness (→ refuse otherwise).
- **Generate:** `openssl rand -base64 48`
- **Where:** set it in the managed deploy environment **before deploying** —
  the build itself imports `lib/auth.ts`, so a missing secret fails the
  deployment closed rather than shipping a forgeable-signature app.
- **Rotation:** changing the value invalidates every existing session cookie
  exactly **once** — all users are logged out and sign in again, after which
  sessions persist the full 30 days again. Rotate immediately if a deploy
  ever ran without a real secret (KID-686: production shipped
  set-but-empty), and at any suspicion of leakage. After this fix deploys,
  rotate **once** from the previous value to a freshly generated one.
- **Never log the value.** The fail-closed error messages name the problem,
  never the secret; don't paste the secret into logs, tickets or evidence.

## `CRON_SECRET` — shared secret for `/api/attendance/sweep` (KID-1175 F-05)

- **What it does:** the attendance auto check-out sweep endpoint
  (`GET`/`POST /api/attendance/sweep`) requires
  `Authorization: Bearer <CRON_SECRET>`, compared timing-safely (fixed-length
  digests — no length probe). Anything else gets a uniform minimal `401`
  with no institute identifiers, counts or reasons.
- **Fail closed:** if `CRON_SECRET` is not configured, the route returns 401
  to **everyone** (the sweep still runs automatically whenever attendance
  surfaces load; the endpoint only adds the scheduled cadence).
- **Generate:** `openssl rand -base64 48`
- **Where:** set it in the deploy environment and configure the scheduler
  (e.g. Vercel Cron job) to send the header:
  ```
  Authorization: Bearer $CRON_SECRET
  ```
- **Rotation:** rotate freely at any time — the only follower is the
  scheduler's header; update it right after the env change. Old values give
  no access once rotated.
- **Never log the value**; unauthorized attempts are logged without request
  details on purpose.

## One-page checklist for a production deploy

1. `openssl rand -base64 48` → `SESSION_SECRET` (fresh value; rotating the
   old one is the documented one-time global logout).
2. `openssl rand -base64 48` → `CRON_SECRET`; point the cron job's
   `Authorization` header at it.
3. Deploy. Boot must succeed; an unauthenticated `POST
   /api/attendance/sweep` must answer `401 {"ok":false}` and the authorized
   call `200 {"ok":true}`.
4. If a boot ever fails with a `KID-1175/F-04` error, resolve the secret
   first — there is deliberately no override switch.

Out of scope here (separate tasks): RLS, security headers, rate limiting.
