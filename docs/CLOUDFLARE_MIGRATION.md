# Cloudflare Workers migration (KID-2452)

Status: **re-cutover executed 2026-11-22T16:18Z; all four hosts are served by
`kiddy-web` on Cloudflare Workers, with Vercel warm as rollback through at least
2026-11-23T16:18Z.** The Worker, Hyperdrive config and zone-route rollback path
are intact. See "Production regression and rollback" and "Re-cutover executed"
below.

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
| Worker (prod) | `kiddy-web` | Deployed from `master` + the Hyperdrive request-pool patch; `https://kiddy-web.trois4ever.workers.dev` |
| Hyperdrive | `kiddy-staging` (`ddcc107a8521433aa4373a67a31d9686`) | Origin: staging Supabase direct host `db.pjubkhhuccoqboypgpty.supabase.co:5432` |
| Hyperdrive | `kiddy-prod` (`731fb486136f4ef7ae512157ca20b766`) | Origin: production Supabase direct host `db.sfetmfmtoubtdyyeyudd.supabase.co:5432`, role `kiddy_hyperdrive` |
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

There are two kinds of values, and they go to different places.

### Build-time public values (inlined by Next — NOT Worker secrets)

`NEXT_PUBLIC_*` values are baked into the client bundle by
`opennextjs-cloudflare build`. Export them in the shell/CI environment that
runs the build:

```
NEXT_PUBLIC_SITE_URL=https://kiddy-web-staging.trois4ever.workers.dev
NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / _PUBLISHABLE_KEY
NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net
NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN=<shared website-inbox token>
KIDDY_CSP_MODE=report-only
```

Setting a `NEXT_PUBLIC_*` value only with `wrangler secret put` does **not**
put it in the browser bundle. KID-2465 lost the production Chatwoot launcher
exactly that way: the base URL was inlined while the token stayed a runtime
lookup from an empty browser env, and the widget rendered nothing.
`next.config.mjs` now fails the build when only one of the Chatwoot pair is
set; set both or neither.

### Runtime Worker secrets

Set out of band with `wrangler secret put <NAME> --env staging` (or `--env`
production):

```
KIDDY_DATABASE_URL=<staging Supavisor URL>   # used by Node/local, Hyperdrive wins on Workers
SUPABASE_URL / _ANON_KEY / _PUBLISHABLE_KEY / _SECRET_KEY / _SERVICE_ROLE_KEY
SESSION_SECRET
CRON_SECRET
PLATFORM_ADMIN_EMAIL
PLATFORM_OPERATOR_PASSWORD
CHATWOOT_BASE_URL / CHATWOOT_ACCESS_TOKEN
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

The staging Worker reuses the production Chatwoot instance and VAPID pair; the
rest of the values are the staging Supabase project.

### Deploying

```sh
# build once with the public values exported, then deploy the built output
export NEXT_PUBLIC_SITE_URL=https://kiddy-web-staging.trois4ever.workers.dev
export NEXT_PUBLIC_SUPABASE_URL=...
export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
export NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net
export NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN=...   # website-inbox token; never commit it
export KIDDY_CSP_MODE=report-only
export SESSION_SECRET=...                       # >=32 chars; build check only, runtime uses the Worker secret

npx opennextjs-cloudflare build
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=\
  postgres://user:password@localhost:5432/postgres \
  npx wrangler deploy --env staging
```

`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` is only needed for
Wrangler's local platform proxy during the CLI command; the remote Worker uses
the real binding.

After the build, confirm the token really was inlined:

```sh
grep -rl "$NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN" \
  .open-next/assets/_next/static/chunks/app
```

It must print the root `layout-*.js` chunk (and only the root layout chunk).
An empty result means the browser bundle has no widget, no matter what Worker
secrets say.

The GitHub Actions workflow verifies on every PR/push and deploys staging only
when the `CF_DEPLOY_ENABLED` repository variable is `true`; its deploy job
fails before building if either staging Chatwoot value is missing.

### Logs and cron

```sh
npx wrangler tail --env staging
```

The cron logs `[cron] attendance sweep ok` or a skipped/failed line. The sweep
endpoint requires `Authorization: Bearer $CRON_SECRET`; without it it returns a
uniform 401.

## Known gaps / follow-ups

1. **New tenant routing:** Cloudflare Custom Domains cannot use wildcard DNS,
   and a `*.kiddyapp.net` Worker route would also capture
   `chatwoot.kiddyapp.net` (a Cloudflare Tunnel origin). New tenant subdomains
   therefore need an explicit zone route to `kiddy-web` when the tenant is
   created. Existing tenant routes (`sunshine`, `maple-grove`), apex and `www`
   are in place. Automate the route in the daycare-creation flow.
2. **Wildcard DNS stays on Vercel:** `*.kiddyapp.net` is still a DNS-only
   CNAME to Vercel. Hosts without an explicit route keep hitting Vercel, which
   is the rollback path, not a regression for the current tenants.
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

## Production regression and rollback (2026-11-22)

The cutover was live from 2026-11-21T23:5xZ. At 07:16Z the founder reported
"Application error: server-side exception" on authenticated tenant pages.
Workers Logs (Workers Observability API, `kiddy-web`) showed two bursts of
database failures, at 06:43:50-06:44:31Z and 07:16:23-07:19:28Z. Every failing
request logged an error whose `message` was empty; the throw site was
`worker.js:4775`, the `promisify()` rethrow inside `pg-pool`, i.e. a failed
`pool.connect()`. The failures hit branding resolution, the billing and
withdrawal sweeps, operator bootstrap and page data together, so the whole
request lost its Postgres connection rather than one query failing.

Evidence that the database itself was healthy:

- No `FATAL`/connection-limit entries in `postgres_logs`; the Postgres process
  had been up since 2026-09-04 and `kiddy_hyperdrive` held only ~5 connections.
- Successful requests interleaved with the failures, and the `*/5` cron sweep
  logged `[cron] attendance sweep ok` at 07:15Z and again after the rollback.
- No Cloudflare incident for Workers or Hyperdrive in that window.

The exact cause of the edge connect rejection is not proven from the logs
(`pg-pool` replaces the error stack, and the runtime error carried no message).
The suspected trigger is connection churn/oversubscription: the Worker opened a
pool of up to four sockets per request, on top of Hyperdrive's own pooling,
under a burst of authenticated page loads.

**Rollback:** the four zone routes (`kiddyapp.net/*`, `www`, `sunshine`,
`maple-grove`) were deleted at ~07:24Z; no DNS record changed. Live check:
`x-vercel-id` present, `x-opennext` gone, `/api/branding` and `/login` 200.

**Rollback gap found and fixed:** `maple-grove.kiddyapp.net` returned HTTP 525
after the route deletion because Vercel had no certificate for that exact host
(only the apex, `sunshine` and the now-stale `maple-grove-daycare*` names were
project domains). The host was added to the Vercel `kiddy` project; it now
returns 200 with `x-vercel-id`. The `*.kiddyapp.net` record stays DNS-only.

## Re-cutover fix

Merged in PR #85 (`e9e0244`) and deployed to `kiddy-web` (version
`be27393c-e44d-4602-aaeb-c93a58c9ac9c`). The fix changes only the Workers
connection path:

1. **One connection per request.** `worker.ts` now creates the per-request pool
   with `max: 1`. Parallel queries queue on that client instead of opening up
   to four sockets, well under the Workers limit of six simultaneous
   connections per invocation.
2. **Connect-only retry.** `lib/db.ts` checks out a client through
   `connectWithRetry()` (`lib/pg-retry.ts`): up to three attempts with a short
   linear backoff. A failure here happens before any SQL runs, so a retry
   cannot replay a write. Query errors are never retried.
3. **Structured failure logging.** Every failed connect logs
   `{"fmt":"KID-2452 db connect failed",attempt,willRetry,error:{name,message,code,errno,syscall,cause}}`,
   so the next occurrence names the runtime error instead of showing an empty
   message.
4. **No `pool.end()` in `ctx.waitUntil`.** The runtime closes request sockets
   at invocation end; an early end could race work scheduled after the
   response and surface as "pool after end".
5. **Single client for schema boot.** `ensurePgSchema()` runs the ledger read
   and any pending migrations on one connection instead of `pool.query` per
   statement.
6. **No module-level pool on Workers.** If the request store is missing, the
   data layer uses a one-call client instead of a shared pool, so cross-request
   socket reuse is impossible.

Verification before re-cutover:

- `tsc --noEmit` clean; `vitest` `db-split` (6/6), `db-fk` (4/4) and the new
  `kid2452-pg-retry` (6/6) pass; `opennextjs-cloudflare build` and
  `wrangler deploy --env staging --dry-run` pass (2.7 MiB gzip).
- A Workers probe bound to the staging Hyperdrive ran 200 requests at 60-way
  concurrency with 4 parallel queries each; `max: 1` and single-client modes
  returned 200 for every request.

Re-cutover sequence (each step gated on the prior one being green):

1. Deploy the fixed script to `kiddy-web` with the routes still absent; the
   `*/5` cron exercises the production DB path with zero user traffic.
2. Re-create the `www.kiddyapp.net` route first as a canary; monitor Workers
   Logs for `KID-2452 db connect failed` and HTTP 5xx for 15-30 minutes.
3. Re-create `kiddyapp.net`, `sunshine`, `maple-grove` only if the canary is
   clean. Vercel stays warm for the full rollback window.

## Re-cutover executed (2026-11-22T16:18Z)

The founder accepted the canary re-cutover card at 16:14Z. Preconditions were
re-checked against live state, not replayed: all four hosts were on Vercel with
zero Worker routes, `kiddy-web` ran version `be27393c` with `HYPERDRIVE` bound
to `kiddy-prod` and `CRON_SECRET` set, and direct Worker checks were 200 with
bad-credential logins returning 401.

1. Only `www.kiddyapp.net/*` was routed to `kiddy-web` first
   (`e2719e1ad5e847c1b9622417b7102a31`); the other hosts stayed on Vercel.
2. The canary ran ~28 minutes with 125 Worker events, 0 exceptions, 0 HTTP 5xx
   and 0 `KID-2452 db connect failed`; the `*/5` cron logged
   `[cron] attendance sweep ok` five times.
3. The remaining routes were then restored: `kiddyapp.net/*`
   (`e6b6484dbe9643558ef0f0798c7ac796`), `sunshine.kiddyapp.net/*`
   (`290823ce0c5d45b1b9b8b8e8370fb1a6`) and `maple-grove.kiddyapp.net/*`
   (`9ab917b720c5425a8cc2f551c9063f66`).

Post-cutover verification: all four hosts return 200 with `x-opennext: 1` and no
`x-vercel-id`; `/api/branding` resolves Kiddy, Sunshine Daycare and Maple Grove
Daycare per host; marketing pages, Arabic/RTL, security headers, `sw.js`,
manifest, login redirects and the guarded sweep match the parity checklist; 12
bad-credential logins across the four hosts all returned 401. Monitoring to
~16:47Z stayed clean. Deleting a route is still the instant rollback and no DNS
record changed.

## Production cutover (executed 2026-11-22, rolled back 2026-11-22T07:24Z)

1. Founder accepted the staging parity card (`794f2c43`) and the production
   cutover card (`d4ccad40`).
2. Created Hyperdrive `kiddy-prod` with a dedicated `kiddy_hyperdrive` role on
   the production Supabase project; bound it as `HYPERDRIVE` on `kiddy-web`.
3. Deployed `kiddy-web` with production secrets, then set `CRON_SECRET`; the
   worker opens one short-lived `pg` pool per request because Workers cannot
   reuse sockets across requests.
4. Added zone routes for `kiddyapp.net/*`, `www.kiddyapp.net/*`,
   `sunshine.kiddyapp.net/*` and `maple-grove.kiddyapp.net/*` to `kiddy-web`.
   DNS records were not changed, so deleting a route instantly restores the
   Vercel origin.
5. Live verification (2026-11-22T01:15Z): all four hosts return `x-opennext: 1`
   with correct tenant titles; `/?lang=ar` renders RTL; CSP/security headers and
   immutable `/_next/static/*` caching hold; `/platform`, `/portal/attendance`,
   `/child` redirect to `/login`; the sweep returns `{"ok":true}` with the
   secret and 401 without it; `/api/mobile/login` with a bad credential returns
   401 (proving the Postgres read path); the cron fired at 01:15Z and logged
   `[cron] attendance sweep ok`.
6. Vercel stays warm for 24-48 h. Delete the routes (not the Vercel project)
   if any check regresses. Decommission Vercel only after the window closes.
