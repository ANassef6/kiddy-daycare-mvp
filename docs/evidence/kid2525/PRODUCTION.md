# KID-2525 — production cut: parent notification topic routing

Status: **shipped to production on 2026-11-28.**

## Approval

| Item | Value |
| --- | --- |
| Founder sign-off | Paperclip confirmation `f2e337d3-3c28-4360-a681-8e18ba3fa846`, accepted 2026-11-28T08:41:59Z |
| Founder report | KID-215 comment `c91f2a20-aeac-41d7-8b5c-889ea4d28f2a`, 2026-11-28T07:35Z |
| Staging evidence | `docs/evidence/kid2525/` (`staging` branch, PR #181) |
| Staging Worker version signed off | `9e081270-7a40-41b1-88f5-e95e4c6736fd` |

The founder tested the staging deploy and approved the production cut before any
production change was made.

## What shipped

`master` and `staging` have diverged, so this followed the per-item cherry-pick
method used by KID-2524, KID-2511 and KID-2519 — not a staging fast-forward.

| Commit on `staging` | Commit on `master` | Change |
| --- | --- | --- |
| `919af19` | `5a990c9` | One notification→topic mapping for every parent kind; unknown kinds go to `/child/notifications`, never `/child`; same mapping drives web-push; `/api/notifications/open` marks the row read before redirecting |
| `30798ff` | `a24c97d` | Plain anchor on the open route so the `#post-...` fragment survives the redirect |

No database migration.

## Cut

| Item | Value |
| --- | --- |
| Pull request | #182 `KID-2525: cut parent notification topic routing to production` |
| Merge commit | `8cfdbb7` (tree `987c4cbd24fd826c1a2d827a32c4f4d643763000`) |
| CI | Test + build + wrangler dry-run pass (2m12s); dependency audit pass (1m00s) |
| Build | `npx opennextjs-cloudflare build` exit 0 on the merged tree |
| Deploy | `npx wrangler deploy --env="" --message KID-2525-production-cut-master-8cfdbb7` |
| Deployed Worker version | `ec5adb96-bf64-4230-9275-514fdc1bf900` (2026-11-28T08:53:04Z) |
| Rollback target (defined before deploy) | `7e1b4b8c-d858-4593-bf80-1e8d7b21bdbf` (KID-2524 cut, 2026-11-27T17:29:46Z) |

### Build inputs

The same public values as the live Worker:

- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` — the existing public website-inbox token (read from the live layout chunk; not recorded here)
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`
- `KIDDY_CSP_MODE=report-only`

`NEXT_PUBLIC_SUPABASE_ANON_KEY` was not set at build time, matching the live
production build. The Chatwoot and Supabase URLs were re-read from the live
layout chunk before the build.

## Local checks on the cut tree

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit/kid2525-notification-routes.test.ts tests/unit/kid472-push-sound.test.ts tests/unit/kid684-invoice-created-notification.test.ts tests/unit/kid472-parent-notifications.test.ts` | 4 files / 59 tests pass |
| `npx tsc --noEmit` | no errors |
| `npx next lint` on the changed files | no warnings or errors |

## Live production checks (anonymous)

| Check | Result |
| --- | --- |
| `/`, `/login` | `200` |
| `/child/notifications` | `307 -> /login` (route exists, auth gate intact) |
| `/child`, `/child/newsfeed`, `/child/consents`, `/child/incidents` | `307 -> /login` |
| `/portal/consents`, `/portal/newsfeed`, `/portal/attendance`, `/portal/dashboard` | `307 -> /login` |
| `/api/notifications/open?id=test` (unauthenticated) | `307 -> /login` (no open redirect) |
| `/login` headers | `server: cloudflare`, `x-opennext: 1`, `permissions-policy: geolocation=(self)` |
| Served layout chunk | `layout-589ef98c0f956d7f.js` (new build) |
| Staging Worker | untouched — `kiddy-web-staging` still version `9e081270-7a40-41b1-88f5-e95e4c6736fd` (2026-11-28T08:30Z) |

### Deployed Worker script contains the cut

Fetched `GET /accounts/…/workers/scripts/kiddy-web` and checked the strings the
fix introduces:

| Check | Result |
| --- | --- |
| `/api/notifications/open` | present (56) |
| `attendance_check_out` | present (14) |
| `consent_created`, `incident_created` | present (14 each) |
| `newsfeed_post` | present (144) |
| Prior release still present: `30 MB` video cap and geolocation policy | unchanged in the same build |

## Production authenticated checks — limitation

Production parent credentials are not available in this workspace, so no
signed-in click was made against a real production tenant. This is the same
production-evidence method recorded for KID-2487, KID-2511, KID-2519 and
KID-2524:

- the click-through was verified with a real parent session on staging in this
  task, on desktop and mobile, in English and Arabic;
- the production Worker now serves the same mapping and the same open route;
- production needs no schema change for this fix.

## Rollback

The rollback target defined before the deploy was Worker version
`7e1b4b8c-d858-4593-bf80-1e8d7b21bdbf` (KID-2524 cut). To roll back:

```sh
npx wrangler rollback --env="" --version-id 7e1b4b8c-d858-4593-bf80-1e8d7b21bdbf
```

No database rollback is needed because the cut added no migration.
