# Staging environment (KID-2440)

Persistent pre-production environment for founder testing. Production cuts only
happen after the founder signs off on staging.

## Where things live

| Item | Value |
| --- | --- |
| **Canonical URL** | **https://staging.kiddyapp.net** |
| Login | https://staging.kiddyapp.net/login |
| Hosting | Cloudflare Worker `kiddy-web-staging` (Workers + Static Assets) |
| Worker fallback URL | https://kiddy-web-staging.trois4ever.workers.dev |
| Branch | `staging` (integration branch, cut from `master`) |
| Custom domain | `staging.kiddyapp.net`, attached to `kiddy-web-staging` (Workers custom domain on the `kiddyapp.net` zone; configured in `wrangler.jsonc`) |
| Staging database | Supabase project `pjubkhhuccoqboypgpty` (eu-central-1) |
| Production database | Supabase project `sfetmfmtoubtdyyeyudd` — **never used by staging** |

> **Use https://staging.kiddyapp.net for every test.** The old Vercel staging
> URL below is frozen and must not be used.

## Frozen legacy staging (do not test here)

`https://kiddy-staging-orcin.vercel.app` (Vercel project `kiddy-staging`,
`prj_y7RmNSA2392TBFb4pDmhP6swmZdF`) is **FROZEN / legacy**.

- Vercel Git auto-deploys were disabled on 2026-11-26 (KID-2491). The project
  still holds the last Vercel build for rollback, and that build **predates**
  the KID-2477..2487 batch.
- It does not receive any new code. Testing there shows stale behaviour and is
  not evidence that a change is missing from staging.
- Never use this URL for founder testing, QA or evidence.
- It is not the rollback path for the Cloudflare staging worker; staging
  rollback is a Workers version rollback or a redeploy of the `staging` branch.

The staging database (Supabase `pjubkhhuccoqboypgpty`) is unchanged, so the same
fixture accounts work on both hosts.

## Flow

1. Commit and push to `staging`.
2. Deploy the staging Worker from the `staging` head:
   ```sh
   npx opennextjs-cloudflare build
   CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=\
     postgres://user:password@localhost:5432/postgres \
     npx wrangler deploy --env staging
   ```
   `staging.kiddyapp.net` is declared in `wrangler.jsonc` as a Workers custom
   domain, so a normal `--env staging` deploy keeps the host attached. The
   `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` value is only a
   CLI placeholder for Wrangler's local platform proxy; the deployed Worker
   uses the real `HYPERDRIVE` binding.
3. Verify `https://staging.kiddyapp.net/login` returns 200 before asking anyone
   to test.
4. The founder tests the change on `https://staging.kiddyapp.net`.
5. Only after the founder's sign-off, merge `staging` into `master`. That push
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
is bootstrapped from two Worker secrets on `kiddy-web-staging`:

| Secret | Value |
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

- `https://staging.kiddyapp.net/platform` — daycare list, create
  daycare, activate/deactivate.
- `https://staging.kiddyapp.net/platform/pricing` — pricing v2 bands
  and founding-cohort configuration.
- `https://staging.kiddyapp.net/platform/daycares` — each row's
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
- Staging has no `PUBLIC_APEX_DOMAIN`, so `staging.kiddyapp.net` serves a single
  generic tenant-free surface; use the login page above.
- Do not add DNS records or routes for `staging.kiddyapp.net` outside the
  `kiddy-web-staging` Worker entry in `wrangler.jsonc`.
