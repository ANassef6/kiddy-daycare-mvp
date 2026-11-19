# KID-2442 — superadmin one-click password reset to the default

## What shipped

| Area | File | Change |
|---|---|---|
| Platform page | `app/platform/password-reset/page.tsx` | Email lookup → read-only account/role/daycare confirmation → explicit **Reset to default password** button. Unknown emails show a localized message and no confirm card. |
| Platform link | `app/platform/page.tsx` | **Reset a password →** link beside the pricing link. |
| Server action | `lib/actions.ts` (`resetAccountPasswordAction`) | Re-checks `requirePlatformOperator()`, requires the explicit-confirm marker, re-reads the account, syncs GoTrue first, then resets. |
| Reset logic | `lib/platform-accounts.ts` | `DEFAULT_ACCOUNT_PASSWORD = "12345678"`; lookup resolves account + `tenancyInstitutesForAccount()` names; one `UPDATE` writes the new hash and `must_change_password = 1`; one audit row per reset. |
| GoTrue sync | `lib/platform-accounts.ts` (`syncGoTruePassword`) | Linked Supabase identity is updated through the service-role admin channel **before** the app-side write. A linked identity that cannot be updated refuses the reset (no half-reset with the old password still valid). |
| Audit | `app/portal/audit/page.tsx` | `account` accepted as a filterable entity type. |
| Strings | `lib/i18n.ts` | EN + AR keys for the page, errors and success message. |
| KID-2439 prerequisite | three cherry-picked commits | The `staging` branch predated the forced-change flow, so the KID-2439 commits were applied to staging before this build (the reset relies on `must_change_password` routing to `/change-password`). |
| Tests | `tests/unit/kid2442-password-reset.test.ts` | Lookup (case/whitespace/unknown), reset hash + flag, one audit row with actor/target/tenant, unknown account no-write, authz, source guard, EN/AR key parity. |

## Verification (staging)

Staging branch tip: `72f8653` (includes KID-2441). Deployed to
`https://kiddy-staging-orcin.vercel.app`.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | pass |
| `npm run lint` | pass (existing `no-img-element` warnings only) |
| `npx vitest run tests/unit/kid2442-password-reset.test.ts` | 11/11 pass |
| KID-2439 + KID-495 + KID-203 + KID-199 suites | 38/39 pass; the one failure is the pre-existing `kid199-platform-rework` role-key expectation (HEAD already has `roles.caregiver` and `roles.teacher`), documented in the KID-2435 evidence and unrelated to this change. |
| `/platform/password-reset` on staging | was `404` before the deploy; now `307 → /login` anonymously |
| Browser flow (superadmin → parent) | login → lookup unknown email (localized error) → lookup `founder.parent@staging.kiddy.test` (Mona Founder / Parent / Founder Test Daycare) → reset → success banner → parent's next login landed on `/change-password` with the temporary-password copy |

Evidence screenshots:

| File | State |
|---|---|
| `01-platform.png` | operator signed in at `/platform` |
| `02-reset-empty.png` | empty reset page |
| `03-unknown-email.png` | unknown email → friendly localized message |
| `04-account-confirm.png` | account name, email, role and daycare shown before the confirm button |
| `05-reset-done.png` | success banner after the reset |
| `06-parent-forced-change.png` | target parent's next login forced to `/change-password` |
| `07-restored.png` | fixture restored after verification |

The browser check used the documented staging fixtures and **restored the
parent fixture** afterwards (default → temporary → default via the normal
change-password flow), so the staging credentials in `docs/STAGING.md` remain
valid and the parent is not left in a forced-change state.

## Founder test steps

1. Sign in at `/login` with `founder.superadmin@staging.kiddy.test` /
   `12345678`.
2. Open `/platform` → **Reset a password →**.
3. Type an account email (for example `founder.parent@staging.kiddy.test`) and
   press **Find account**.
4. Check the name, role and daycare; press **Reset to default password**.
5. Sign out and sign in as that account with `12345678` — the app must open
   `/change-password` before any role page.

Production is untouched; the cut waits for the founder's staging sign-off.

## Production cut (2026-11-19)

Founder sign-off was recorded on the staging confirmation card, so the same
password-reset batch was cut to production.

| Item | Value |
|---|---|
| Pull request | #62 `kid2442-prod-cut` → `master` |
| Merge commit | `aea2e88` (2026-11-19T19:02:38Z) |
| Vercel deployment | `dpl_9xo27xkdwL1xeCM7FRLN6fswpqLr` — READY |
| Production host | `https://sunshine.kiddyapp.net` |

What the cut contains: KID-2442 (this page/action) plus KID-2441 (the
`/reset-password` "Auth session missing" fix and localized expired-link copy,
which rides the same staging batch). KID-2439's forced-change flow was already
on `master` from PR #61. KID-2435 (pricing v2) and KID-2440 (staging
environment) also live on the `staging` branch but are **not** part of this
signed-off batch, so they were deliberately excluded from the cut.

Post-deploy smoke check (anonymous):

| URL | Result |
|---|---|
| `/platform/password-reset` | `307 → /login` (route exists and stays operator-gated) |
| `/platform` | `307 → /login` |
| `/reset-password` | `200` (KID-2441 page live) |

`npx tsc --noEmit`, `npm run lint`, the KID-2441 + KID-2442 unit suites
(31/31) and `npm run build` all passed on the cut branch before merge.
