# KID-1175 — P0 security fixes (KID-1170 F-04, F-05, F-07)

Owner-approved remediation (KID-215 approval, 2026-11-09: "Let's work on them
all and make sure that everything is in a top notch."). Branch:
`kid1175-p0-security`. Commits:

- `758c5b3` — the three fixes + test suites (`kid1175` failures-verified,
  `kid205` contract update, vitest env pin, `.env.local.example`,
  `docs/DEPLOY_SECRETS.md`).
- follow-up commit — tsc strictness fixes inside the two new test files
  (mutable-env typing, mock-import cast). No behavior change.

## F-04 — SESSION_SECRET fails closed in production

- `lib/auth.ts`: `resolveSessionSecret()` throws at module load when
  `NODE_ENV=production` and the value is missing / empty / whitespace-only /
  the retired `dev-only-secret-change-me` constant / shorter than 32 chars.
  Dev/test keep the local fallback. Failure messages never contain the
  configured value.
- Boot probes on the production build (`next build` + `next start`,
  worktree of `758c5b3`, NODE_ENV=production):
  - no `SESSION_SECRET`: server answers `GET /login` with **500** and the
    server log carries `⨯ Error: KID-1175/F-04 fail-closed: SESSION_SECRET
    is missing or empty in production...` (fail closed).
  - strong generated secret: `/login` → **200**.
  - cross-secret rule: a token signed under secret A is refused by a process
    configured with secret B (suite test; this is the one-time global logout
    rotation semantics — documented in `docs/DEPLOY_SECRETS.md`).
- Docs: `docs/DEPLOY_SECRETS.md` (requirement, generation via
  `openssl rand -base64 48`, rotation note, never-log rule) and
  `.env.local.example`.
- Ops follow-up (deploy env, outside repo): set a fresh strong
  `SESSION_SECRET` in the managed environment BEFORE deploying this change;
  the fix rotates away the KID-686 empty-secret state (one-time logout).

## F-05 — `/api/attendance/sweep` requires the cron secret

- Route now requires `Authorization: Bearer $CRON_SECRET` compared
  timing-safely over fixed-length SHA-256 digests (no length probe, no
  Bearer-prefix bypass). Unset `CRON_SECRET` → 401 for everyone + one setup
  warning. No institute IDs/counts/reasons in ANY response:
  - unauthenticated/wrong-secret → `401 {"ok":false}`,
  - authorized → `200 {"ok":true}` (details only in server logs).
- Live probe on the production build: unauth `POST /api/attendance/sweep` →
  `{"ok":false} 401`; `Authorization: Bearer <CRON_SECRET>` → `{"ok":true}
  200`. Sweep loop, idempotency and the every-institute deterministic order
  are untouched (kid205 suite re-pinned against the authorized call; the
  database-side assertions are unchanged).
- Ops follow-up: generate `CRON_SECRET`, set it in the deploy env, configure
  the scheduler header (`docs/DEPLOY_SECRETS.md`).

## F-07 — confirmEmailAction demands GoTrue proof

- `confirmEmailAction(email, accessToken)` verifies via
  `getSupabase().auth.getUser(token)` and requires the token's email to
  match before any `email_confirmed` write (KID-495 pattern). Bad shapes are
  uniform `{ ok: true }` no-ops (no enumeration, no partial state).
  `/auth/confirm` passes the confirmation session's access token and fails
  loudly when it can't be read.
- Live flow facts: only a token verifying NOW to the same email flips the
  flag; refused/foreign/empty tokens never write (suite pin).

## Fails-on-old-code evidence

With the four source files reverted (tests kept): 15 of the 21 new kid1175
pins FAIL — every production-refusal case (5), every sweep-auth case (5),
and the confirm-email unverified-token cases (5; the 2 confirm-email pins
that pass on old code exercise paths where the old code already no-opped).
`git stash push/apply` regression run, popped after evidence.

## Full gates (worktree of `758c5b3`, isolated from the concurrent KID-1177 run)

- `npx tsc --noEmit` — clean.
- `npm run lint` — clean; single pre-existing KID-489 img warning
  (`app/portal/newsfeed/page.tsx`).
- `npm test` — **95 files / 1034 tests, all green**.
- `npm run db:verify-migrations` — all checks passed.
- `npm run build` (NODE_ENV=production with `.env.local` strong secret) —
  green.
- prod-boot probes above (`next start`: fail-closed 500 without secret;
  200/401/200 matrix with secrets).

## Concurrent-work note

The workspace was held concurrently by the KID-734/KID-1177 run; their
uncommitted `lib/actions.ts` storage work, `lib/storage.ts`,
`supabase/verify-migrations.mjs` and migrations 0040/0041 were left
untouched in the tree — the kid1175 commits stage only the KID-1175 files,
and gates ran in a clean worktree of the kid1175 commit.
