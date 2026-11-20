# Cloudflare Workers migration (KID-2452)

Status: **staging deployed on Cloudflare Workers; production untouched.** The
production DNS cutover stays blocked on founder approval and a production
sign-off card (see "Production cutover").

## Why Hyperdrive

The app talks to Supabase Postgres with `pg`. On Workers a direct connection to
the Supavisor pooler fails before the handshake completes:

- Workers always validates the server certificate; `pg`'s
  `ssl: { rejectUnauthorized: false }` cannot relax it, and Supabase's pooler
  chain is not trusted by the runtime.
- The transaction pooler also needs `prepare: false`, which the app's generic
  `pg.Pool` query path does not set.

Cloudflare's own guidance for Supabase is Hyperdrive. Hyperdrive terminates TLS
and pools connections in Cloudflare's network, and is included in all Workers
plans. `lib/db.ts` therefore prefers the `HYPERDRIVE` binding when the code is
running inside Workers, and falls back to `KIDDY_DATABASE_URL` on Node
(Vercel/local). Local `next dev` is unaffected and keeps SQLite.

## Deployed resources

| Resource | Name | Notes |
| --- | --- | --- |
| Worker | `kiddy-web-staging` | `https://kiddy-web-staging.trois4ever.workers.dev` |
| Worker (prod, not deployed) | `kiddy-web` | Defined in `wrangler.jsonc`; no deploy until cutover |
| Hyperdrive | `kiddy-staging` (`ddcc107a8521433aa4373a67a31d9686`) | Origin: staging Supabase direct host `db.pjubkhhuccoqboypgpty.supabase.co:5432` |
| Cron | `*/5 * * * *` | Calls `/api/attendance/sweep` through the self service binding with `CRON_SECRET` |
| Assets | `.open-next/assets` | `public/_headers` caches `/_next/static/*` immutably |

Adapter: `@opennextjs/cloudflare` 1.20.18 on the master toolchain (Next
15.5.29 / React 19). Bundle: ~2.5 MiB gzip, under the Workers Free 3 MiB limit.
Wrangler 4.166.0.

`worker.ts` is the custom entry: it re-exports the OpenNext fetch handler and
adds the `scheduled` handler. It fails closed unless both
`NEXT_PUBLIC_SITE_URL` and `CRON_SECRET` are present, so a misconfigured worker
cannot sweep another environment.

## Parity checklist (staging, 2026-11-20)

Verified live against `https://kiddy-web-staging.trois4ever.workers.dev`:

- [x] Marketing pages `/`, `/features`, `/for-parents`, `/contact` render (200).
- [x] `/login` renders; `/manifest.webmanifest` and `/sw.js` are served.
- [x] Arabic: `/?lang=ar` renders `<html lang="ar" dir="rtl">` (middleware
      language override works on Workers).
- [x] Security headers from `next.config.mjs`: CSP report-only, X-Frame-Options,
      Permissions-Policy, Referrer-Policy, nosniff. `/api/csp-report` accepts a
      report (204).
- [x] `/_next/static/*` returns `Cache-Control: public,max-age=31536000,immutable`.
- [x] Chatwoot widget loads and reaches `chatwoot.kiddyapp.net`; `/api/chatwoot/identity`
      returns 200.
- [x] Web-push public key is served (`/api/push/public-key`); VAPID keys are set
      as Worker secrets.
- [x] Server actions + Postgres writes: the public contact form POST returns 303
      to `?sent=1`, a `contact_request` row lands in the staging database
      (`Hyperdrive`), and `email_sent_at` is set by the mail path.
- [x] Attendance sweep endpoint with `Authorization: Bearer $CRON_SECRET`
      returns `{"ok":true}` and runs through Hyperdrive.
- [x] Cron trigger fired against the deployed Worker at 19:30 UTC and logged
      `[cron] attendance sweep ok {"ok":true}`; the self service binding carried
      `Authorization: Bearer $CRON_SECRET` and the sweep ran for all four staging
      institutes over Hyperdrive.

Observed but not yet explained:

- One contact-form action POST returned 500 immediately after deploy, then the
  next identical submission succeeded (303). Likely a cold-start/schema-init
  edge; reproduce with `wrangler tail` if it recurs.
- Workers CPU time for a marketing page is ~46 ms in logs (Free plan nominally
  10 ms). The account served it without a 1102. Watch the Workers analytics;
  upgrade to Workers Paid ($5/mo) if free limits are hit, per the founder
  decision.

## Environment/secrets

Set as Worker secrets (staging), never in source:

```
NEXT_PUBLIC_SITE_URL=https://kiddy-web-staging.trois4ever.workers.dev
KIDDY_DATABASE_URL=<staging Supavisor URL>   # used by Node/local, Hyperdrive wins on Workers
NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / _PUBLISHABLE_KEY
SUPABASE_URL / _ANON_KEY / _PUBLISHABLE_KEY / _SECRET_KEY / _SERVICE_ROLE_KEY
SESSION_SECRET
CRON_SECRET
KIDDY_CSP_MODE=report-only
PLATFORM_ADMIN_EMAIL
PLATFORM_OPERATOR_PASSWORD
CHATWOOT_BASE_URL / CHATWOOT_ACCESS_TOKEN
NEXT_PUBLIC_CHATWOOT_BASE_URL / NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

The staging Worker reuses the production Chatwoot instance and VAPID pair; the
rest of the values are the staging Supabase project.

### Deploying

```sh
# build once, then deploy the built output
npx opennextjs-cloudflare build
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=\
  postgres://user:password@localhost:5432/postgres \
  npx wrangler deploy --env staging
```

`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` is only needed for
Wrangler's local platform proxy during the CLI command; the remote Worker uses
the real binding.

Secrets are set out of band with `wrangler secret put <NAME> --env staging`.
The GitHub Actions workflow verifies on every PR/push and deploys staging only
when the `CF_DEPLOY_ENABLED` repository variable is `true`.

### Logs and cron

```sh
npx wrangler tail --env staging
```

The cron logs `[cron] attendance sweep ok` or a skipped/failed line. The sweep
endpoint requires `Authorization: Bearer $CRON_SECRET`; without it it returns a
uniform 401.

## Known gaps / follow-ups

1. **Production Hyperdrive:** create a `kiddy-production` Hyperdrive config
   against the production Supabase project at cutover, bind it in the default
   (non-staging) environment, and set the production Worker secrets. The
   default environment currently has no Hyperdrive binding.
2. **Tenant subdomains:** staging is single-tenant (`PUBLIC_APEX_DOMAIN` empty).
   The production cutover must add `*.kiddyapp.net` (and the apex) to the
   Cloudflare zone/Worker routes and keep the wildcard on the Vercel project
   warm for rollback.
3. **Branch flow:** `wrangler.jsonc` deploys from `staging` in CI, but the local
   `staging` branch is far behind `master`. Rebase/cut a fresh staging branch
   before turning `CF_DEPLOY_ENABLED` on.
4. **Staging auth data:** the demo staff credential does not log in on either
   Vercel staging or Workers staging (same failure on both), so the staging
   Supabase Auth/seed data, not the adapter, is the cause. QA needs a valid
   staging account for the full signed-in checklist.
5. **Cache:** R2 is deferred; the read-only Workers static-asset cache is enough
   today because there is no user-facing ISR/route cache. Revisit when a
   cacheable route appears.
6. **Image optimization:** the app uses `<img>` today, so no `IMAGES` binding is
   configured. Add one if `next/image` is adopted.

## Production cutover (gated)

1. Founder signs off on staging parity (confirmation card).
2. Create the production Hyperdrive config and bind it to `kiddy-web`.
3. Deploy `kiddy-web` with production secrets; do **not** move DNS yet.
4. Move `kiddyapp.net` + `*.kiddyapp.net` DNS/routes to Cloudflare.
5. Keep the Vercel production project untouched and warm for 24-48 h as
   rollback. Never delete it before the rollback window closes.
6. After 24-48 h of green traffic, decommission Vercel and update the standing
   workflow/infra docs.
