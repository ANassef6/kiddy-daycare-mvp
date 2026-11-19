# KID-2441 — password reset: "Auth session missing" fix

## Part 1 — production unblock (operational, no code)

The reported parent account (`role=parent`, Arabic UI) had a GoTrue identity
and an app-side `account` row. The account password was reset to the founder
default and `must_change_password` was set:

- GoTrue admin update: `PUT /auth/v1/admin/users/{id}` → 200.
- App mirror: `account.password_hash` rewritten with the same default and
  `must_change_password = 1` in one PATCH → 200.
- Login attempt through the deployed mobile API:
  `POST https://kiddyapp.net/api/mobile/login` → 200,
  `account.mustChangePassword: true`, token issued.
- Data endpoint gate:
  `GET https://kiddyapp.net/api/mobile/bootstrap` with that token → **403**
  `{"error":"password change required","code":"password_change_required"}`.
- Web forced-change surface: `GET /change-password` with the session cookie
  → 200 (not a redirect to `/login`), so the account lands on the KID-2439
  change screen after sign-in.

The account is unblocked with a temporary credential and must change it at
next sign-in. The password value is not recorded here.

## Part 2 — root cause and fix

### Root cause

The recovery email uses Supabase's implicit flow:

```
https://<supabase>/auth/v1/verify?... → 303
https://kiddyapp.net/reset-password#access_token=…&refresh_token=…&type=recovery
```

`/reset-password` created a client with `detectSessionInUrl: true` for the
link check, then created a **second** client for the submit. Supabase's URL
detection consumed the fragment and cleared `window.location.hash`; the
submit client had no session, so `updateUser()` produced GoTrue's raw
`Auth session missing`. A reused/expired link additionally arrives as
`#error=access_denied&error_code=otp_expired`, which the page previously
treated as a bare visit.

### Fix

- `lib/password-reset.ts`: parses implicit-fragment and PKCE shapes, parses
  Supabase's error redirect, establishes the recovery session, reuses it for
  `updateUser`, and maps every failure to a reason (`no-token`, `invalid`,
  `expired`, `failed`).
- `app/reset-password/reset-form.tsx`: one client for the whole flow with
  `detectSessionInUrl: false`; the in-memory recovery session is reused by the
  submit. No raw auth exception reaches the UI.
- `lib/i18n.ts`: EN + AR copy for expired links and failed updates.
- `lib/url.ts`: `resetRedirectOrigin` keeps a Sunshine subdomain request on
  `https://sunshine.kiddyapp.net/reset-password` while previews and localhost
  still fall back to `NEXT_PUBLIC_SITE_URL`. The reset mail no longer forces
  every surface to the apex.
- `tests/unit/kid2441-password-reset.test.ts`: 25 tests covering both URL
  shapes, error redirects, session reuse, expired mapping, reset-origin
  selection, and the one-client page wiring.

### Verification

Staging deployment: `https://kiddy-staging-orcin.vercel.app` (commit
`f5a618e`, Vercel deployment `dpl_8gNBNnzQKd6Jp7efP6YcrAfd4g2o`).

| Check | Result | Evidence |
| --- | --- | --- |
| EN: fresh link → form → new password → success | PASS | `en-reset-success.png` |
| EN: new password signs in, previous password rejected | PASS | GoTrue `token?grant_type=password`: new 200 / old 400 |
| AR: fresh link → RTL form → new password → success | PASS | `ar-reset-success.png` |
| AR: new password signs in, previous password rejected | PASS | GoTrue `token?grant_type=password`: new 200 / old 400 |
| EN: reused/expired link shows localized copy, not an auth exception | PASS | `en-expired-link.png` |
| AR: reused/expired link shows localized copy, not an auth exception | PASS | `ar-expired-link.png` |

The end-to-end runs used a temporary GoTrue-only probe user in the staging
project. The probe user was deleted after the run and no credential or token
is recorded here. `md` and `ts` endpoint probes confirm the page labels and
`dir="rtl"` are server-rendered for the Arabic cookie.

Local gates on the delivered commit: `tsc --noEmit` 0, `next lint` 0,
`next build` green, KID-2441 suite 25/25, targeted regression suite
(KID-2441/KID-2442/i18n/i18n-page-coverage/KID-495) 56/56.

A pre-existing unrelated staging failure remains in
`tests/unit/kid199-platform-rework.test.ts` (extra `roles.caregiver` and
`roles.teacher` dictionary entries); it is present on the staging base commit
and is not touched by this change.

## Production cut

Founder sign-off: staging confirmation card accepted 2026-11-19T20:05Z.

The base reset fix (this page's Part 2) was already cut to production in
PR #62 (merge `aea2e88`, deployment `dpl_9xo27xkdwL1xeCM7FRLN6fswpqLr`).
This cut adds the reset-origin follow-up from `dd70dc0`:

| Item | Value |
|---|---|
| Pull request | #65 `kid2441-tenant-reset-origin` → `master` |
| Merge commit | `c78608b` (2026-11-19T20:27:11Z) |
| Vercel deployment | `dpl_Hj44ru262zg2CNSUxy7yXapjHsho` — READY |
| Production aliases | `kiddyapp.net`, `*.kiddyapp.net`, `sunshine.kiddyapp.net` |

What the cut contains: `resetOriginFor` / `resetRedirectOrigin` in
`lib/url.ts`, both reset-mail call sites in `lib/actions.ts`, and the five
origin-selection tests in `tests/unit/kid2441-password-reset.test.ts`.

Production env confirms the helper has the values it needs:
`PUBLIC_APEX_DOMAIN=kiddyapp.net`, `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`.

Post-deploy smoke check (anonymous, after the alias moved):

| URL | Result |
|---|---|
| `https://kiddyapp.net/reset-password` | 200 |
| `https://sunshine.kiddyapp.net/reset-password` | 200 |
| `https://kiddyapp.net/forgot-password` | 200 |
| `https://sunshine.kiddyapp.net/forgot-password` | 200 |

The Sunshine reset page still server-renders the tenant title
(`Sunshine Daycare — childcare, in your pocket`), so the tenant surface is
intact. No account credential or token is recorded here.

Gates on the cut branch (rebased on `f03ba25`): `tsc --noEmit` 0,
`next lint` 0 errors (pre-existing `img` warnings only), `next build` green,
KID-2441 suite 25/25, targeted regression
(KID-2441/KID-2442/i18n/i18n-page-coverage/KID-495) 59/59.
