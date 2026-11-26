# Cloudflare Workers migration (KID-2452)

Status: **production cutover complete, Vercel kept warm as rollback.**
`kiddyapp.net`, `www`, and both tenant hosts are served by the `kiddy-web`
Worker through Cloudflare zone routes; the Vercel DNS records and project are
untouched, so deleting the routes is an instant rollback. The 24-48 h rollback
window is open.

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

## KID-2457: pool lifecycle hotfix (staging verified)

After the first production cutover, authenticated RSC navigations on tenant
hosts intermittently returned the Next.js digest crash page. Workers Logs
showed one throw site — pg's `promisify` (pool connect) — with an empty
message; the same failure broke branding, billing/withdrawal sweeps and
operator bootstrap on that request. Production was rolled back to Vercel at
07:24Z.

Root cause: the Worker entry opened one `pg.Pool` per request and called
`pool.end()` as soon as `handler.fetch()` resolved. OpenNext returns a
streaming Response and keeps rendering — and querying — after that point, so
the remaining work hit an ended pool (`Cannot use a pool after calling end on
the pool`; on the edge runtime the same race surfaced as the empty-message
connect error). Staging reproduced 5 such failures in a 900-request tenant
soak on the pre-fix build.

Fix:

- `lib/db-request.ts`: the per-request pool is not ended when the fetch
  handler resolves. Workers/Hyperdrive clean up the invocation's connections
  when the invocation ends, which is the race-free lifecycle.
- `lib/db-request.ts`: a failed client *connection* is retried once with a
  short backoff. The statement itself runs exactly once, so a retry cannot
  duplicate a write.
- `lib/db.ts`: on Workers, a missing request scope now fails fast with a clear
  error instead of silently reusing a cross-request module pool.
- `app/error.tsx`: a failed render shows a recoverable "Try again" page
  instead of the opaque digest screen (hardening; the pool lifecycle is the
  primary fix).

Verification: the same staging worker, after the fix, took an authenticated
browser soak of 240 soft navigations (owner and parent roles across
`/portal/*` and `/child/*`) with zero digest pages, zero 5xx and zero
error-level Worker logs; the one-minute cron logged
`[cron] attendance sweep ok`. Production routes/DNS stay on Vercel until the
founder signs off on staging.

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

## Production cutover (executed 2026-11-22)

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

## Vercel rollback target, frozen 2026-11-25 (KID-2491)

Vercel Git auto-deploys are disabled for `ANassef6/kiddy-daycare-mvp`.
`vercel.json` sets `git.deploymentEnabled: false`, so neither the `kiddy`
project (production branch `master`) nor the `kiddy-staging` project
(production branch `staging`) builds on a push. Manual CLI/API deploys and
Deploy Hooks still work; do not run one while Vercel is the rollback target.

The Vercel projects, their environment variables, custom domains and the last
production deployments are intentionally kept. Deleting a Cloudflare Worker
route (below) sends that host back to Vercel without any DNS change.

### Frozen deployments

| Project | Deployment | Commit | Ready (UTC) | URL |
| --- | --- | --- | --- | --- |
| `kiddy` (production) | `dpl_BqkXMb7H974tKs2kgwbr4wNueM9C` | `166c05cb56a56e060fe13aad5c749f8d8ed99efc` (merge PR #135, KID-2483) | 2026-11-25T18:40Z | https://kiddy-3ysssiwoe-kiddy2.vercel.app |
| `kiddy-staging` | `dpl_CEYK4w5TT9uPh4oPnQiwNeZFk1Q9` | `63c20abd5dc6c4b6e0cb29281bb9b14e08d2fc72` | 2026-11-25T18:22Z | https://kiddy-staging-orcin.vercel.app |

The `kiddy` deployment owns the Vercel aliases that the Cloudflare routes sit
in front of: `kiddyapp.net`, `*.kiddyapp.net` (covers `www` and tenant hosts),
`sunshine.kiddyapp.net`, `maple-grove.kiddyapp.net`,
`maple-grove-daycare.kiddyapp.net`, `maple-grove-daycare-2.kiddyapp.net`,
`kiddy-one.vercel.app` and `kiddy-git-master-kiddy2.vercel.app`.

The frozen production deployment is commit `166c05cb` (2026-11-25T18:38Z). It
already contains every change merged through the Cloudflare cutover and the
production cuts on 2026-11-23..2026-11-25. A rollback therefore reverts all
work merged after `166c05cb`; it does not revert work merged between
2026-11-23 and 2026-11-25, because that work is inside the frozen build.

Caveats:

- The frozen build uses the live production Supabase database. Database
  migrations applied after `166c05cb` are not reverted by a Vercel rollback.
  Check the migration ledger before relying on this build for a long period.
- Vercel Hobby keeps the currently aliased production deployment. It is
  protected only while it remains the production alias. Do not promote a
  newer Vercel build; if the alias moves, the old build can expire after
  30 days.

### Rollback procedure (Cloudflare to Vercel)

Zone: `kiddyapp.net` (`7f383436baf0d1b2be82c96c1ec01c7a`). Worker: `kiddy-web`.
DNS records are not changed and the Worker is not deleted.

1. Choose the blast radius. For a canary, delete one host first (for example
   `www.kiddyapp.net/*`). For a full rollback, delete all four routes.
2. Delete the route(s) in Cloudflare Dashboard > Workers & Pages > `kiddy-web`
   > Settings > Routes, or with the API:

   ```
   DELETE /client/v4/zones/7f383436baf0d1b2be82c96c1ec01c7a/workers/routes/<route-id>
   ```

   Route IDs as of 2026-11-26:

   | Pattern | Route ID |
   | --- | --- |
   | `kiddyapp.net/*` | `e6b6484dbe9643558ef0f0798c7ac796` |
   | `www.kiddyapp.net/*` | `e2719e1ad5e847c1b9622417b7102a31` |
   | `sunshine.kiddyapp.net/*` | `290823ce0c5d45b1b9b8b8e8370fb1a6` |
   | `maple-grove.kiddyapp.net/*` | `9ab917b720c5425a8cc2f551c9063f66` |

3. Verify the host is back on Vercel: the response has `x-vercel-id` and no
   `x-opennext: 1`; `/` and `/login` return 200.
4. To return to Cloudflare later, re-create the same route pattern with
   `script: kiddy-web` in the dashboard or the Workers routes API. No DNS or
   Vercel change is needed.

### Freeze verification (2026-11-26)

- `https://kiddy-3ysssiwoe-kiddy2.vercel.app/` returns 200 on the frozen build.
- `https://kiddyapp.net/`, `https://www.kiddyapp.net/`,
  `https://sunshine.kiddyapp.net/` and `https://maple-grove.kiddyapp.net/`
  still return `x-opennext: 1` from Cloudflare.
- Pushes to `master`/`staging` that contain the `vercel.json` change create no
  Vercel deployment (checked in the Vercel deployment list and GitHub commit
  statuses).
