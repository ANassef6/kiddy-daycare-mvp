# Staging environment (KID-2440)

Persistent pre-production environment for founder testing. Production cuts only
happen after the founder signs off on staging.

## Where things live

| Item | Value |
| --- | --- |
| URL | https://kiddy-staging-orcin.vercel.app |
| Login | https://kiddy-staging-orcin.vercel.app/login |
| Branch | `staging` (integration branch, cut from `master`) |
| Vercel project | `kiddy-staging` (`prj_y7RmNSA2392TBFb4pDmhP6swmZdF`) |
| Production branch setting | `staging` (Vercel Git auto-deploys are disabled as of 2026-11-26, KID-2491; the last build is frozen for rollback) |
| Staging database | Supabase project `pjubkhhuccoqboypgpty` (eu-central-1) |
| Production database | Supabase project `sfetmfmtoubtdyyeyudd` — **never used by staging** |

The staging project carries its own environment variables (staging database,
staging Supabase keys, its own `SESSION_SECRET` / `CRON_SECRET`). It does not
read production secrets.

## Flow

1. Commit and push to `staging`.
2. Pushes no longer build on Vercel (KID-2491); the staging URL keeps the frozen
   build for rollback. Deploy the staging Worker instead (see
   `docs/CLOUDFLARE_MIGRATION.md`), or run a manual Vercel deploy only when
   deliberately testing the Vercel path.
3. The founder tests the change on staging.
4. Only after the founder's sign-off, merge `staging` into `master`. That push
   is the production cut.

`master` is reserved for verified production cuts. Do not commit directly to
`master`.

## Fixtures and test credentials

`scripts/seed-staging-founder.ts` seeds one centre, **Founder Test Daycare**,
with two rooms, two children, two guardians, a teacher, working hours
(Sun–Thu 07:00–18:00, Africa/Cairo), a daily report and a pending invoice.

`scripts/seed-staging-billing-fixture.ts` seeds **Billing Test Daycare**
(subdomain `billingtest`) for the pricing-v2 billing module: 22 active
children (Core band), founding client, pilot ended 25 Sep 2026, first cycle
Oct 2026. It issues one paid invoice with the frozen v2 snapshot — band
`core`, standard 950 EGP, founding rate 810 EGP, pilot credit 350 EGP, total
460 EGP — so the operator invoice list is never empty during a review.

| Role | Email | Password |
| --- | --- | --- |
| Owner | `founder.owner@staging.kiddy.test` | `12345678` |
| Teacher | `founder.teacher@staging.kiddy.test` | `12345678` |
| Parent | `founder.parent@staging.kiddy.test` | `12345678` |
| Billing fixture owner | `founder.billing@staging.kiddy.test` | `12345678` |

These credentials exist **only** in the staging database. Never reuse this
password for a production account.

## Superadmin (platform operator) portal

The platform operator is a separate identity, not a daycare role. On staging it
is bootstrapped from two Vercel env vars on the `kiddy-staging` project:

| Env var | Value |
| --- | --- |
| `PLATFORM_ADMIN_EMAIL` | `founder.superadmin@staging.kiddy.test` |
| `PLATFORM_OPERATOR_PASSWORD` | `12345678` |

On the first request after a deploy, `ensurePlatformOperator()` creates the
account (the normal `/login` page triggers it), so no manual database step is
needed. The account carries the internal `platform` sentinel role and lands on
`/platform` after sign-in.

| Role | Email | Password |
| --- | --- | --- |
| Superadmin (platform operator) | `founder.superadmin@staging.kiddy.test` | `12345678` |

Operator pages (sign in at `/login` first):

- `https://kiddy-staging-orcin.vercel.app/platform` — daycare list, create
  daycare, activate/deactivate.
- `https://kiddy-staging-orcin.vercel.app/platform/pricing` — pricing v2 bands
  and founding-cohort configuration.
- `https://kiddy-staging-orcin.vercel.app/platform/daycares` — each row's
  billing gear opens `/platform/daycares/<id>/billing`; the invoice list is
  `/platform/daycares/<id>/invoices`.

`/platform` is deliberately not linked from the daycare owner portal: the
operator is not a tenant role, so use the direct URL. Removing an email from
`PLATFORM_ADMIN_EMAIL` cuts access immediately, even for a signed-in session.

Re-seed (repeatable — it wipes only this one fixture centre):

```bash
KIDDY_SEED_STAGING_PROJECT=pjubkhhuccoqboypgpty \
KIDDY_DATABASE_URL="<staging Postgres URL>" \
SESSION_SECRET="<any 32+ char value>" \
npx tsx scripts/seed-staging-founder.ts
```

The script refuses any target except a local `file:` SQLite URL or a Postgres
URL that matches the `KIDDY_SEED_STAGING_PROJECT` ref, so the production
database cannot be seeded by accident.

## Constraints

- Do not point staging at the production database.
- Do not edit the production Vercel project (`kiddy`), its database, or
  `sunshine.kiddyapp.net` as part of staging work.
- Staging has no `PUBLIC_APEX_DOMAIN`, so the Vercel alias serves a single
  generic tenant-free surface; use the login page above.
