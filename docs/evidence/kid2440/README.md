# KID-2440 — persistent staging environment

Date: 2026-11-18 (UTC)
Owner: Cody

## Result

Staging exists, is separate from production, and all three founder roles sign
in successfully.

| Item | Value |
| --- | --- |
| Staging URL | https://kiddy-staging-orcin.vercel.app |
| Login | https://kiddy-staging-orcin.vercel.app/login |
| Branch | `staging` |
| Auto-deploy | Vercel project `kiddy-staging` production branch = `staging` |
| Staging DB | Supabase `pjubkhhuccoqboypgpty` (eu-central-1) |
| Production DB | Supabase `sfetmfmtoubtdyyeyudd` (untouched) |

## Founder credentials (staging only)

| Role | Email | Password |
| --- | --- | --- |
| Owner | `founder.owner@staging.kiddy.test` | `12345678` |
| Teacher | `founder.teacher@staging.kiddy.test` | `12345678` |
| Parent | `founder.parent@staging.kiddy.test` | `12345678` |

Never reuse this password on a production account.

## What was built

1. `staging` branch reset (fast-forward) from `master` at
   `c663216` and pushed. `master` stays the production cut branch.
2. Vercel project `kiddy-staging` (`prj_y7RmNSA2392TBFb4pDmhP6swmZdF`) linked to
   `ANassef6/kiddy-daycare-mvp`, production branch `staging`, Node 24.x.
   - Canonical alias: `kiddy-staging-orcin.vercel.app` (public).
   - `kiddy-staging.vercel.app` is owned by someone else, so it is not used.
3. Staging-only environment variables copied from the production shape but
   pointed at the staging Supabase project. Fresh `SESSION_SECRET` and
   `CRON_SECRET` were generated for staging; production secrets were not reused.
   `PUBLIC_APEX_DOMAIN` is intentionally unset (single generic surface).
4. `scripts/seed-staging-founder.ts` seeds one centre, **Founder Test Daycare**
   (subdomain `foundertest`, Africa/Cairo), with:
   - 1 branch, 2 rooms (Sunflowers, Little Stars)
   - owner, teacher (room-scoped to Sunflowers), parent
   - 2 children (Layla and Omar Founder) and 2 guardian contacts
   - working hours Sun–Thu 07:00–18:00
   - one daily report and one pending EGP invoice
5. Pushed the seed script to `staging`; Vercel built and aliased it
   automatically (first deploy `dpl_AD8rKDV55VKohJuPhGvnTT2iJ5F1`).

## Database separation proof

Production and staging use different Supabase projects, hosts, users and URLs:

```
production NEXT_PUBLIC_SUPABASE_URL = https://sfetmfmtoubtdyyeyudd.supabase.co
staging    NEXT_PUBLIC_SUPABASE_URL = https://pjubkhhuccoqboypgpty.supabase.co
staging    KIDDY_DATABASE_URL user   = postgres.pjubkhhuccoqboypgpty
staging    DB host                   = aws-0-eu-central-1.pooler.supabase.com
```

Direct query against the staging DB (`current_database()` = `postgres`):

```
institutes: 3  (Maple Grove Daycare, Blue Horizon Kids, Founder Test Daycare)
accounts:   18 (including the three founder accounts)
migrations: 0042 .. 0046 applied
```

The production Vercel project `kiddy` was not modified: its production alias is
still `sunshine.kiddyapp.net` and its last known master deployment is unchanged.

## Login verification

Headless Chromium against `https://kiddy-staging-orcin.vercel.app`:

| Role | Landed | Observed |
| --- | --- | --- |
| owner | `/portal/dashboard` | "Dashboard", title "Founder Test Daycare — childcare, in your pocket"; 2 children / 2 staff / 2 rooms; latest daily report for Layla |
| teacher | `/portal/dashboard` | same centre, 1 child (room-scoped), 1 room, 1 staff |
| parent | `/child` | "My children" with Layla (Sunflowers) and Omar (Little Stars) |

Screenshots: `login.png`, `owner.png`, `teacher.png`, `parent.png`.
Raw result: `verify.json`.

The only console error is a pre-existing missing `/favicon.ico`; no auth,
data, or 5xx failures occurred.

## Founder flow

`staging` branch → Vercel auto-deploy → founder tests on
`https://kiddy-staging-orcin.vercel.app` → after his sign-off, merge `staging`
into `master` for the production cut. No production deploy happens before that
sign-off.
