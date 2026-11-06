# KID-499 — Parent email-confirmation banner clears in the same session

## Side effect fixed (same session, no re-login)

- The banner read `session.emailConfirmed`, a snapshot baked into the 30-day
  `kiddy_sess` cookie at sign-in (`lib/actions.ts` `setSession`).
- `confirmEmailAction` now re-mints the visitor's own matching session cookie
  after the local flag flips (server actions may write cookies), so a signed-in
  parent who clicks a valid confirmation link lands with
  `emailConfirmed: true` and the banner is gone without a sign-out/sign-in.
  The re-mint is authorized only by an existing, matching cookie — no session
  is conjured for an anonymous confirm visitor, and a session holding a
  different email is left untouched.
- Both protected shells (parent `app/child/layout.tsx` and staff
  `app/portal/layout.tsx`) render the banner via
  `lib/auth.ts emailConfirmedDisplayFor`: when the snapshot says unconfirmed
  the LIVE account row decides, so out-of-band confirmations/repairs can never
  leave a stale banner; snapshot-confirmed sessions skip the DB entirely. A DB
  failure keeps the snapshot (fail-open, exact pre-KID-499 behaviour).
- The GoTrue login-time sync from KID-215 is unchanged and pinned by a test:
  GoTrue-confirmed + local flag 0 + successful password sign-in sets the local
  flag and mints `emailConfirmed: true`.

## Stale deployment host: `kiddy-kiddy2.vercel.app`

Probed 2026-11-06 (HTTP status of the live hosts):

| Host                      | `/auth/confirm` | `/reset-password` | `/welcome` |
| ------------------------- | --------------- | ----------------- | ---------- |
| `kiddyapp.net`            | 200             | 200               | 307 (redirecting, healthy) |
| `sunshine.kiddyapp.net`   | 200             | 200               | 307 (redirecting, healthy) |
| `kiddy-kiddy2.vercel.app` | **404**         | **404**           | 307        |

- `kiddy-kiddy2.vercel.app` serves an old build that predates the
  `/auth/confirm` and `/reset-password` routes (KID-111/KID-123 era). A
  confirmation or recovery email whose redirect lands there 404s and the app
  never learns the email was confirmed — the original Sunshine report came
  through that host.
- Supabase should not have that host in its Site URL / redirect allowlist
  anymore. If it still is, remove it in the Supabase dashboard or repoint the
  email templates' redirect URLs to `kiddyapp.net` (and daycare subdomains).
- The worker holds no Vercel access, so no redirect/alias could be applied on
  the Vercel side; `kiddy-kiddy2.vercel.app` must either be deleted or
  repointed to serve the current build by whoever owns the Vercel project.
- Ops note recorded for the platform team: treat `kiddyapp.net` (+ tenant
  subdomains) as the only password-recovery/confirmation redirect hosts.

## Tests

`tests/unit/kid499-email-confirm-banner.test.ts` (8):

1. `confirmEmailAction` re-mints the visitor's matching stale cookie with
   `emailConfirmed: true` and flips the local row to 1.
2. The re-mint stays a valid signed `kiddy_sess` cookie for the same account.
3. An anonymous confirm visitor never gets a session minted; the flag still
   flips.
4. A session for a different email is left untouched.
5. `emailConfirmedDisplayFor` hides the banner when the row is confirmed
   despite a stale cookie.
6. It still shows the banner for a genuinely unconfirmed account.
7. Snapshot-confirmed sessions never touch the DB (fast path).
8. GoTrue-confirmed login with local flag 0 sets the flag and mints
   `emailConfirmed: true` (regression pin for the login sync).

## Verification (2026-11-06, shared workspace with concurrent KID-485/498 work)

- `tests/unit/kid499-email-confirm-banner.test.ts`: 8/8 green (re-verified
  after the concurrent run's commits landed).
- `tsc --noEmit`: clean. `next lint` on all touched files: clean.
  `next build`: green (the one intermediate failure was the concurrent run's
  in-flight `lib/sqlite-schema.ts` debug catch typing, fixed in place).
- Full suite first pass: 804/808 with 4 failures in messaging fan-out
  (kid182, kid207) and sibling backfill (kid146) — those areas are the
  concurrent run's mid-flight state, not this fix; all three suites re-pass
  43/43 after their commits (roomStaffIds restoration + kid146 pin adaptation,
  HEAD `ae68839`).
- Placement note: the `confirmEmailAction` re-mint, the portal-shell banner
  hook-up, and the sqlite-schema catch typing were swept into the concurrent
  run's KID-498 commit `aab52ea` while this change was mid-flight in the
  shared tree; the layout import/helper (app/child + lib/auth), this test and
  the evidence doc land in this KID-499 commit.
