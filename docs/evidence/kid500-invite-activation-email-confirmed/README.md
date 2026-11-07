# KID-500 — Invite activation syncs `email_confirmed` (Resend activation stops lying)

## Root cause (the `mayoda0@gmail.com` report, Sunshine centre)

- The invite email failed (`email_error: "email rate limit exceeded"`), so
  registration created the account with `email_confirmed = 0` and no
  confirmation email — deliberately keeping the app-side flow usable.
- She completed activation through the invite code: invite accepted, both
  children linked, login is app-side-only (`auth_user_id = null`).
- Nothing ever synced the flag: the GoTrue login-time sync
  (`loginAction`: `email_confirmed_at && !emailConfirmedFor`) only runs for
  GoTrue-confirmed logins, and none existed. The mirror stayed 0 forever, so
  the admin portals kept rendering "Resend activation" for an account that
  could already sign in, and `/welcome` kept showing the confirm banner.
- KID-499 fixed the banner's *staleness*; KID-500 fixes the *row state* and
  the affordances it drives. A manual one-row repair was already applied to
  `mayoda0@gmail.com`; this task closes the code gap for every other account
  in the same shape.

## Changes

### 1. `lib/actions.ts` — `registerAction`

On every successful invite-based activation path the account ends confirmed:

- rate-limited GoTrue sign-up, KID-123 app-side adoption (`auth_user_id = null`),
  the KID-126 already-registered resume, and a successful
  already-registered heal.
- The flip is strictly plugged in right after the activation tail
  (post-`consumeInvite`), best-effort: a failed flip is logged and leaves the
  pre-existing degradation (banner + resend) instead of breaking a working
  activation. The session is minted after the flip (`setSession` re-reads the
  live row), so the 30-day `kiddy_sess` cookie carries `emailConfirmed: true`
  and the redirect lands on `/child`, not `/welcome`.
- Scope of the proof: the flip only happens when the redeemed invite was
  issued to the account's exact (case-insensitive) address — a single-use
  code addressed elsewhere proves nothing about this mailbox. A mismatch
  keeps the flag and the KID-126 resend exactly as computed before.

### 2. `lib/store.ts` — `healParentActivation` + `lib/actions.ts` login

The KID-498 self-heal consumes the same kind of pending invite at login
(generic GoTrue login's `parentActivationGate`, then the app-side leg), so it
now also flips `email_confirmed` when it consumed one (0 → 1 only; a failed
flip is logged, never thrown — a heal that just fixed the login must not fail
the login). `loginAction`'s app-side leg re-reads the account row after the
parent-activation gate so the redirect uses the live state: without that, a
just-activated parent got a confirmed cookie yet was still sent to
`/welcome`. The GoTrue leg already mints from the live row and redirects via
`homeForRole`, so it needed no change.

### 3. `supabase/migrations/0035_kid500_invite_activation_email_confirmed.sql`

One-time, idempotent data repair mirroring the runtime rule for accounts that
already completed an invite activation but still hold `email_confirmed = 0`:

- only parent mirrors (`role = 'parent'` AND `staff_id IS NULL`);
- holding at least one `accepted` invite addressed to the account's own
  email (trimmed/lowercased both sides) — the redeemed code is the ownership
  proof; an invite for a different address matches nothing;
- holding at least one family link to a child that is neither withdrawn nor
  inactive — the activation must still be alive. All-withdrawn parents and
  zero-link orphans keep the old flag (orphans are the KID-498 heal's
  business).
- Flag moves 0 → 1 only; no other column and no invite row is touched;
  flagged rows leave the candidate pool, so replaying is a no-op.
- `mayoda0@gmail.com`'s already-repaired row is released as a natural no-op —
  her password, children, centre, and invite are untouched.

### 4. `lib/sqlite-schema.ts` — the 0035 mirror

Same predicate in SQLite dialect, appended after the KID-498 mirror block
(with one ordering subtlety documented in the tests: the 0034 statement-2
consumption runs first, so an account linked ONLY to its pending invite's
child gets that invite accepted by the 0034 mirror — by design, the
ACT-INVITE failure shape — and is then a natural 0035 candidate).

### 5. Admin UI: no code change needed

`lib/activation.ts` (`isUnactivatedAccount`/`activationByEmails`) drives every
"Resend activation" surface (`app/portal/staff/page.tsx`,
`app/portal/staff/[id]/page.tsx`, `app/portal/children/[id]/page.tsx`) from
`account.email_confirmed = 0` and contact-invite delivery reads the same
helper (`lib/contact-invite.ts` "already has a confirmed account"). Confirmed
mirrors therefore hide the affordance everywhere without special-casing, and
genuinely unconfirmed GoTrue sign-ups still show it. The KID-113 resend action
(`resendActivationAction`, rate-limit + already-active guards) and the
KID-171 affordance shapes are unchanged.

## Deliberately NOT done

- `resendConfirmationAction`, `confirmEmailAction` and the GoTrue login-time
  sync are untouched (KID-113/KID-499/KID-215 behaviour pinned by tests).
- The KID-126 post-activation confirm resend still fires on the paths where
  the GoTrue identity itself may still be unconfirmed — best-effort, logged,
  never fatal; the local flag no longer depends on it.

## Verification

- `node supabase/verify-migrations.mjs` — the full migration chain, including
  the new `== 0035 kid500 invite-activation email_confirmed repair ==` block:
  incident-shape flip (with a mixed-case invite address), already-confirmed
  no-op, staff-linked / admin-role / all-withdrawn / no-accepted-invite /
  different-address decoys stay at 0, replay idempotence, late-arrival
  healing, and no invite row moved.
- `tests/unit/kid500-invite-activation-email-confirmed.test.ts` (9) — see the
  mapping below.
- `tests/unit/kid498-parent-activation-heal.test.ts`,
  `tests/unit/kid499-email-confirm-banner.test.ts`,
  `tests/unit/activation.test.ts` — regression neighbours, green.
- `tsc --noEmit` clean, `next lint` clean (pre-existing `<img>` warning only),
  `next build` green.

### Test → criterion mapping

| Criterion | Covered by |
| --- | --- |
| 1. rate-limited + app-side activation flips the flag | register suites: rate-limited (/child redirect, flag 1, `emailConfirmed: true` cookie) and adoption (flag 1, `auth_user_id` null) |
| 2. session minted at activation carries `emailConfirmed: true` | both suites above assert the minted cookie |
| 3. admin resend hidden for invite-activated accounts | `activationByEmails` unactivated=false after the flip |
| 4. genuine GoTrue sign-ups still show resend; guards unchanged | `activationByEmails` unactivated=true; `resendActivationAction` untouched |
| 5. failures keep the flag and the step-coded errors | consumed-invite registration errors and never flips; mismatch falls back to `/welcome` |
| 6. one-time idempotent repair scoped to real activations | 0035 mirror suites + verify-migrations block |
| 7. no KID-499/KID-113 regression | neighbour suites + unchanged action code |
| 8. tsc / lint / build clean | recorded above |
