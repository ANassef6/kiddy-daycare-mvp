# KID-2478 — production cut record (superadmin Excel bulk upload)

Status: **complete — the production Worker is cut, deployed and verified for the
anonymous and server-side gates. The operator tab is auth-gated; its behaviour
is pinned by the suite below.**

The staging build and the acceptance mapping live in `README.md`. This record
covers the production cut only.

## Approval

The founder accepted the human-only confirmation card
`aead9583-c735-4c97-8bff-38d7afd703ab` ("Approve the KID-2478 production cut")
on **2026-11-25T17:50:13Z**. Accept meant "release to production".

The same card accepted the two draft Excel templates at draft level via
KID-215 (comment `5e9e531f`).

## What shipped

The approved surface is the operator-only **Settings → Bulk upload** tab. There
is no other host for it on `master`, so the cut carries KID-2477 (the Settings
restructure) plus the three KID-2478 commits:

| Staging commit | Content |
| --- | --- |
| `b56ad75` | KID-2477: per-daycare Billing / Invoices / Center configuration under Settings |
| `68bc236` | KID-2478: two Excel templates, children/staff upload, per-row transactions, linked accounts |
| `169119f` | KID-2478: `Classroom name *` required; blank/unknown classroom is a row error that creates nothing (KID-2482) |
| `e3812c5` | KID-2478: mount the card as the Settings → Bulk upload tab |

The only intentional difference from the staging commits is `lib/db.ts`:
`withTransaction()` uses `master`'s `withPgClient()` pool API instead of
staging's `acquireClientWithRetry`/`getPool()` (KID-2457 was implemented
differently on each branch). It still borrows one pooled client for the whole
row and issues explicit BEGIN/COMMIT/ROLLBACK, so a failed row creates nothing.

| Item | Value |
| --- | --- |
| Pull request | #141 `kid2478-prod-cut` → `master` |
| Merge commit | `6980d96387c8f1cac8c88168df6cd6ce4bc66fb6` (2026-11-25T18:58Z) |
| Worker | `kiddy-web` version `0ab3d408-3020-44cb-a265-21af71680a32` (2026-11-25T19:01:21Z) |
| Deploy message | `KID-2478-bulk-upload-master-6980d96` |
| Previous worker version (rollback) | `303ac24d-660b-4e6d-8086-4c510bb1cc83` (KID-2483 build, 2026-11-25T18:43Z) |
| Routes / DNS | unchanged |
| Migrations | `0055_kid2478_bulk_upload.sql` (idempotent, additive) |
| Env / secrets | none changed |

The deploy is additive: only the Worker script version changed. Worker secrets,
the Hyperdrive binding, the cron trigger and zone routes were not touched.

### Build inputs

The same public values as the previous production build:

- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` — public value already present in the
  live layout chunk
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`
- `KIDDY_CSP_MODE=report-only`
- `SESSION_SECRET` — build-only boot check; the Worker keeps its runtime secret

Deploy method: `npx opennextjs-cloudflare build` on `6980d96`, then
`npx opennextjs-cloudflare deploy --message KID-2478-bulk-upload-master-6980d96`
(top-level Worker environment).

## Verification on the cut tree

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx eslint` on the touched source/test files | 0 errors |
| `opennextjs-cloudflare build` | green |
| `wrangler deploy --dry-run` | 281 assets, 2.77 MiB gzip, bindings intact |
| KID-2478 upload + page, KID-2477 Settings, i18n page coverage | 33/33 pass |
| KID-2486, billing and contract follow-ons touched by KID-2477 | 89/89 pass |
| CI on PR #141 (`Test + build + wrangler dry-run`) | pass |
| CI on PR #141 (`audit`) | pass |

The Vercel preview checks failed on the account's 24-hour build-rate limit; they
are not code checks and both `staging` and `kiddy` previews hit the same limit.

## Live production verification (2026-11-25T19:02Z)

Raw copy: `prod-verify.json`.

### HTTP smoke (anonymous)

| URL | Result |
| --- | --- |
| `/` | `200`, `server: cloudflare`, `x-opennext: 1` |
| `/features`, `/for-parents`, `/for-centers`, `/contact` | `200` |
| `/login` | `200` |
| `/manifest.webmanifest` | `200` |
| `/sw.js` | `200` |
| `/?lang=ar` | `200`, `<html lang="ar" dir="rtl">` |
| `/platform` | `307 → /login` |
| `/child` | `307 → /login` |

### Bulk-upload gates (anonymous)

| URL | Result |
| --- | --- |
| `/platform/daycares/demo/settings/bulk-upload` | `307 → /login` |
| `/api/platform/bulk-upload/template/children` | `403` JSON |
| `/api/platform/bulk-upload/template/staff` | `403` JSON |

The `403` is the server-side operator check (`requirePlatformOperator()`); an
anonymous caller cannot download a template or start an upload.

### Served bundle matches the cut

| Check | Result |
| --- | --- |
| Live layout chunk | `layout-fed4d3b93b60673a.js` — same hash as the local build of `6980d96` |
| Live bulk-upload page chunk | `app/platform/daycares/[id]/settings/bulk-upload/page-6fd32916cd472633.js` — `200`, `text/javascript` |
| Previous KID-2476 layout chunk | `layout-db2af10b12dbae82.js` — no longer served |

### Operator tab and sample upload

The production operator credentials are not available in this workspace, so no
production rows were created. The operator surface is covered without a live
write by `tests/unit/kid2478-bulk-upload-page.test.tsx` and
`tests/unit/kid2478-bulk-upload.test.ts`:

- both templates render/download on the Settings tab in EN and AR;
- a children sample sheet creates the child, health row, classroom link and
  linked parent account with `12345678` + `must_change_password`, and calls no
  mail path;
- a staff sheet creates staff + account with the mapped role and the same
  forced-change flag;
- duplicate and malformed rows are skipped/reported with row numbers;
- a blank or unknown classroom is a row error and creates nothing (KID-2482);
- a non-operator is rejected server-side.

`0055_kid2478_bulk_upload.sql` is idempotent and applies on the first
authenticated request after deploy (the documented `ensureSchema()` path).

## Rollback

```sh
npx wrangler rollback --name kiddy-web
```

That returns the Worker to `303ac24d-660b-4e6d-8086-4c510bb1cc83` (the KID-2483
build already live before this cut) and removes the bulk-upload surface. The
`bulk_upload` table is additive and can stay; it is unreferenced by the older
build. No route, DNS or migration rollback is required.
