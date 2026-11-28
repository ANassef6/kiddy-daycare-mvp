# KID-2525 — parent notification links open their topic

Status: **fixed on staging; founder sign-off requested. No production cut.**

Founder report: KID-215 comment `c91f2a20-aeac-41d7-8b5c-889ea4d28f2a`
(2026-11-28T07:35Z). On the parent `/child` surface, opening a notification took
the parent to **My children** (`/child`) instead of the notification's topic.
The bell itself already reached `/child/notifications`; the broken hop was the
notification row behind it.

## Root cause

`/child/notifications` only mapped three kinds (`message`, `daily_report`,
`invoice_created`). Every other kind fell back to `href = "/child"`, so a new
newsfeed post, consent, incident, attendance or bus notification opened the
children list. The web-push path (`pushDeepUrl`) had the same default-to-child
behaviour for unpublished kinds.

The first staging deploy fixed that mapping but kept Next `Link` on the open
route. Next handled the API redirect as a client-side RSC navigation and
dropped the `#post-...` fragment, so the feed opened at the top rather than at
the post. The final fix uses a plain anchor for the open route; the HTTP
redirect keeps the fragment.

## Changes

- `lib/notification-routes.ts` — one mapping for every parent notification
  kind, including `announcement`, `daily_report`, `invoice_created`,
  `bus_on`/`bus_off`, `check_in`/`check_out`, `consent`, `incident`, `event`,
  `form`, `message`, `chatwoot_message` and `test`. Unknown kinds go to
  `/child/notifications`, never `/child`.
- `lib/push.ts` — web-push click-through now uses the same mapping. Staff and
  operator kinds (`pickup_time`, `auto_checkout`, `staff_checkin`,
  `staff_checkout`, `contract_draft`) keep their portal destinations.
- `app/child/notifications/page.tsx` — rows open
  `/api/notifications/open?id=<row>`, which marks the row read before
  redirecting to its topic.
- `app/api/notifications/open/route.ts` — session-scoped open handler. It only
  reads the signed-in account's own row and only redirects to a local path.
- Topic anchors: newsfeed posts (`#post-<id>`), consents (`#consent-<id>`),
  incidents (`#incident-<id>`), events (`#event-<id>`), forms (`?open=<id>`)
  and child attendance (`#attendance`).
- Tests: `tests/unit/kid2525-notification-routes.test.ts` (11 tests) covers the
  full mapping, the push path, the open redirect, tenant/account scoping and
  mark-read. Existing KID-472/KID-684 expectations were updated to the new
  mapping.

## Staging deploy

| Item | Value |
| --- | --- |
| Branch | `staging` |
| Merge commits | `b754549` (mapping), `45264a0` (fragment fix) |
| Worker | `kiddy-web-staging` |
| URL | https://staging.kiddyapp.net |
| Final Worker version | `9e081270-7a40-41b1-88f5-e95e4c6736fd` (2026-11-28T08:30Z) |
| Previous rollback version | `fd0a3e72-9269-4fcd-a5b6-6e71891bd998` |
| Pre-task rollback version | `3bdc458a-64df-4aac-bac8-e81588b0506e` |

Build: `npx opennextjs-cloudflare build` on `45264a0`, then
`npx wrangler deploy --env staging --message KID-2525-notification-routes-hash-staging-45264a0`.
No database migration was needed.

## Local checks

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit/kid2525-notification-routes.test.ts tests/unit/kid472-push-sound.test.ts tests/unit/kid684-invoice-created-notification.test.ts tests/unit/kid472-parent-notifications.test.ts` | 4 files / 59 tests pass |
| `npx tsc --noEmit` | no errors in changed files |
| `npm run lint` on changed files | no errors (existing `<img>` warnings only) |
| CI PR #179 / #180 | Test + build + wrangler dry-run pass; audit pass |

## Live staging verification

Fixture accounts from `docs/STAGING.md`. Each case used a fresh announcement
post, then a real parent session in the browser.

| Viewport / language | Bell opens list | Row target | Badge before → after |
| --- | --- | --- | --- |
| Desktop 1366×900, EN | `/child/notifications` | `/child/newsfeed#post-mx05ifmi-bw41gbat` | 12 → 11 |
| Mobile 390×844, AR / RTL | `/child/notifications` | `/child/newsfeed#post-mx05ik37-2ce1wqst` | 11 → 10 |
| Desktop 1366×900, AR / RTL | `/child/notifications` | `/child/newsfeed#post-mx05khdc-d9tvyyxl` | 12 → 11 |
| Mobile 390×844, EN | `/child/notifications` | `/child/newsfeed#post-mx05klqy-xgg8r8nz` | 11 → 10 |

In every case the target URL was `/child/newsfeed#post-...` (never `/child`)
and the target post body was visible. The row's `href` was
`/api/notifications/open?id=...`; its `title` held the resolved topic.

Screenshots:

- Desktop EN: `10-desktop-child-bell.png`, `11-desktop-notifications.png`,
  `12-desktop-newsfeed-target.png`
- Mobile AR: `20-mobile-ar-child-bell.png`,
  `21-mobile-ar-notifications.png`, `22-mobile-ar-newsfeed-target.png`
- Desktop AR: `30-desktop-ar-child-bell.png`,
  `30-desktop-ar-notifications.png`, `30-desktop-ar-target.png`
- Mobile EN: `40-mobile-en-child-bell.png`,
  `40-mobile-en-notifications.png`, `40-mobile-en-target.png`

## Consent / incident / check-in mapping

The staging fixture data contains newsfeed, message, invoice and daily-report
notification rows only; the app does not currently emit durable consent,
incident or child check-in notifications. Those kinds are mapped and pinned by
`tests/unit/kid2525-notification-routes.test.ts`:

| Kind | Target |
| --- | --- |
| `consent` / `consent_request` | `/child/consents#consent-<id>` or `/child/consents` |
| `incident` / `incident_created` | `/child/incidents#incident-<id>` or `/child/incidents` |
| `check_in` / `check_out` / `bus_on` / `bus_off` | `/child/<childId>#attendance` |
| `event` | `/child/events#event-<id>` |
| `form` / `survey` | `/child/forms?open=<formId>` |

If a consent, incident or check-in notification is produced later, it will open
its topic instead of the children list.

## Sign-off

Please test on staging:

1. Open a parent account and tap the bell. The notifications list must open.
2. Tap a "new post" notification. It must open the newsfeed at that post, not
   **My children**.
3. Repeat on mobile web, in both English and Arabic.

Reply with approval to cut this to production. Production is intentionally
untouched.
