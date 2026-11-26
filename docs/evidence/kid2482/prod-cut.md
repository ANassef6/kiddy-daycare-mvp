# KID-2482 — production cut record (recipients picker)

Status: **complete — the production Worker is deployed and the served bundle
matches the cut.** The founder-facing picker behaviour is pinned by the test
suite and the staging evidence in `README.md`.

## Approval

The founder accepted the human-only confirmation card `84f2b033`
("KID-2482 staging sign-off: events, drive, homework, supplies") on
**2026-11-26T20:21:29Z**. Accept meant "merge staging into master for
production".

## What shipped

- **One admin audience.** "Center (everyone)" and "All classrooms" are one
  **Everyone (whole center)** channel that resolves from all classrooms at
  submit time, so rooms created later are included.
- **Classroom checklist on first open.** The **Classrooms** section renders
  above the child search with a heading and hint; staff see assigned rooms only
  and a staff-specific hint.
- **Owner is admin-equivalent.** The picker, the server resolver,
  `canTargetWholeCenter`, `scopedRoomIds` and `isAdminRole` treat `owner` as an
  admin, so the owner can target a specific room.
- **Mandatory classroom.** Child create/edit refuse a missing or foreign
  classroom server-side and write nothing. Existing unassigned children show a
  **Needs classroom** badge; they are not auto-assigned.
- **Search everywhere.** Child search on the children list; parent search in the
  messages composer; child search in the homework, consent and drive pickers.
- **Four recipient surfaces.** Events, Parent drive, Homework and Supplies use
  the shared picker. A classroom pick resolves through
  `resolveRecipientAudience`; forged or out-of-scope picks are dropped.
- **EN + AR** copy for every new label.

### Cut commits

| Commit | Content |
| --- | --- |
| `207ac81` | KID-2485: add recipient selection to survey creation |
| `8cdf950` | KID-2485: ship the unified recipient picker rules with surveys |
| `0c3041f` | KID-2482: require a classroom, unify the admin audience, search every recipient list |
| `16c6df7` | KID-2482: update the KID-733 child fixtures for the mandatory classroom |
| `b469429` | KID-2482: add child search to the homework, consent, and drive pickers |
| `f6b8cb9` | KID-2482: resolve the picker no-results label from the parent dictionary |
| `79a3daf` | KID-2482: keep the classroom checklist visible in the recipients picker |
| `95709d7` | KID-2482: use a staff-specific classroom hint |
| `4a084fe` | KID-2482: pin the owner admin audience in the recipients picker |
| `92e9ea4` | KID-2482: add classroom recipients to events, drive, homework, supplies |
| `c50acd6` | KID-2482: fix homework page props for the Next page type |
| `2ffd18e` | KID-2482: record staging evidence for the picker and four surfaces |

## Dependency carried by this cut

KID-2482 builds on the shared `resolveRecipientAudience` helper and the unified
picker rules that landed under KID-2485 on staging. The two KID-2485 commits are
therefore part of this cut. This is the same per-item method as the KID-2478 cut
(which carried KID-2477): `staging` is not a strict superset of `master`, so a
batch fast-forward is not safe.

Not included: KID-2481, KID-2484, KID-2487, KID-2494 and the rest of the
staging-only batch. They remain pending their own sign-offs.

| Item | Value |
| --- | --- |
| Pull request | #165 `kid2482-prod-cut` → `master` |
| Merge commit | `6ddf047` (2026-11-26T20:41Z) |
| Worker | `kiddy-web` version `eb62997f-f9ea-4d3d-bd57-5fb700c4623a` (2026-11-26T20:43:40Z) |
| Deploy message | `KID-2482-recipients-picker-master-6ddf047` |
| Previous worker version (rollback) | `0ab3d408-3020-44cb-a265-21af71680a32` (KID-2478 build, 2026-11-25T19:01Z) |
| Routes / DNS | unchanged |
| Migrations | `0057_kid2485_survey_audience.sql` (idempotent, additive) |
| Env / secrets | none changed |

The deploy is additive: only the Worker script version changed. Worker secrets,
the Hyperdrive binding, the cron trigger and the zone routes were not touched.

### Build inputs

The same public values as the previous production build:

- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` — the same public value already present
  in the live layout chunk
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`
- `KIDDY_CSP_MODE=report-only`
- `SESSION_SECRET` — build-only boot check; the Worker keeps its runtime secret

Deploy method: `npx opennextjs-cloudflare build` on `6ddf047`, then
`npx wrangler deploy --env="" --message KID-2482-recipients-picker-master-6ddf047`
(top-level Worker environment).

## Verification on the cut tree

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx eslint` on the touched source files | 0 errors (2 pre-existing `<img>` warnings) |
| KID-2482 picker + surfaces, KID-2485 survey, KID-733, KID-221, KID-2480 | 73/73 pass |
| `opennextjs-cloudflare build` | green |
| `wrangler deploy --dry-run` | 281 assets, 2.77 MiB gzip, prod bindings intact |
| CI on PR #165 (`Test + build + wrangler dry-run`) | pass |
| CI on PR #165 (`audit`) | pass |

## Live production verification (2026-11-26T20:45Z)

### HTTP smoke

| URL | Result |
| --- | --- |
| `/`, `/features`, `/for-parents`, `/for-centers`, `/contact` | `200` |
| `/login` | `200`, `x-opennext: 1`, `server: cloudflare` |
| `/manifest.webmanifest`, `/sw.js` | `200` |
| `/?lang=ar` | `200`, `<html lang="ar" dir="rtl">` |
| `/platform`, `/child` | `307 → /login` |
| `/portal/events`, `/portal/drive`, `/portal/learning/homework`, `/portal/supplies` | `307 → /login` |
| `sunshine.kiddyapp.net/login` | `200` (tenant route intact) |
| `kiddy-web.trois4ever.workers.dev/login` | `200` (fallback intact) |

### Served bundle matches the cut

| Check | Result |
| --- | --- |
| Live layout chunk | `layout-aa9122f41f8604b3.js` — same SHA-256 prefix as the local build of `6ddf047` |
| Shared picker chunk | `9082-d51f696f5a8bbc9e.js` — byte-identical to the local build and contains the new picker hints |
| Events / drive / homework / supplies page chunks | `200` and byte-identical to the local build |
| Chatwoot widget | website token still inlined; the widget is not disabled |

The production founder/operator credentials are not available in this workspace,
so no signed-in production write was made. The picker behaviour is covered by
the KID-2482 suites and the real-browser staging evidence in `README.md`.

## Rollback

```sh
npx wrangler rollback --name kiddy-web
```

That returns the Worker to `0ab3d408-3020-44cb-a265-21af71680a32` (the KID-2478
build already live before this cut). `0057_kid2485_survey_audience.sql` is
additive and can stay; the older build does not read the new columns. No route,
DNS or secret rollback is required.
