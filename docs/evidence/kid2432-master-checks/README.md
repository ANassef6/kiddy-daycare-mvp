# KID-2432 — master's two red X checks: evidence and fix

Scope: the two failing checks on master commit `2de2dbd` (KID-2421 merge).
Production (`Vercel – kiddy`) is healthy and untouched.

## 1. `Vercel – kid2123-clean` — REMOVE (founder decision)

**Project:** `kid2123-clean` (`prj_cYC28PpjIMDVRBcshGLpzNYnEp1p`, team `kiddy2`)
**Deployment:** `dpl_5ZGauJf175E1F61FNZp4vDWtqNTk`, state `ERROR`,
`errorCode=BUILD_UTILS_SPAWN_1`, "Command \"npm run build\" exited with 1".

Exact error from `GET /v3/deployments/{id}/events?builds=1`:

```
[Error: Failed to collect configuration for /_not-found] {
  [cause]: Error: KID-1175/F-04 fail-closed: SESSION_SECRET is missing or empty in production.
  The server refuses to run, because without it session cookies are signed with a
  publicly-known key and every 30-day session can be forged. ...
}
> Build error occurred
[Error: Failed to collect page data for /_not-found] { type: 'Error' }
Error: [BUILD_UTILS_SPAWN_1] Command "npm run build" exited with 1
```

The fail-closed guard is working exactly as designed. The project has **zero
environment variables** (`GET /v9/projects/{id}/env` → `envs: []`), while the
live `kiddy` project carries `SESSION_SECRET` in `production` and `preview`.

Evidence that it is a leftover duplicate, not a needed pipeline:

- Same GitHub repo (`ANassef6/kiddy-daycare-mvp`) as `kiddy` — two Vercel
  projects building one repo.
- Created `2026-11-12T15:34:42Z`; its first deployment is the KID-2123 branch
  work (`9cbde05`). `productionBranch` is set to `main`, a branch this repo
  does not have, so it can never serve a production intent.
- No custom domain, no aliases except its own `*.vercel.app` names.
- It fails on **every** push — master, feature branches and PRs — because the
  env is empty, so it can never be green while unconfigured.

Recommendation: **REMOVE** — delete the `kid2123-clean` project (or at minimum
disconnect its GitHub integration) so it stops posting a red X on every commit.
Nothing depends on it: the real preview/production project is `kiddy`.
Not done here by design (issue: removal goes back to the founder).

## 2. `Supabase Preview` — FIX (applied in this change)

**Check run on `2de2dbd`:** failure after 8s, output:

```
ERROR: duplicate key value violates unique constraint "schema_migrations_pkey" (SQLSTATE 23505)
Key (version)=(0032) already exists.
At statement: 2
INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)
```

Same failure on `01b311e` (2026-11-15) and `7c6907b` (2026-11-14) — it is not
new and not related to KID-2421.

**Root cause:** two parallel branches each claimed one numeric prefix, and both
landed on master:

| version | files |
| --- | --- |
| 0032 | `0032_center_default_currency.sql` (KID-489/490) + `0032_push_subscriptions.sql` (KID-480) |
| 0033 | `0033_instapay_payment_link.sql` (KID-489/491) + `0033_tool_usage_event.sql` (KID-481) |

`lib/db.ts` keys its own ledger on the **file name**, so local replay and
`db:verify-migrations` were green and nobody noticed. The Supabase CLI ledger is
keyed on the **numeric version** alone: it applies the second `0032` file and
then cannot record it, so the check dies at statement 2 of 8s.

Because it fails on the first collision, `0033` is a second, latent collision
that would fail the very next run.

**Fix applied:** renumber the later files to the next free versions.

- `0032_push_subscriptions.sql` → `0043_push_subscriptions.sql`
- `0033_tool_usage_event.sql` → `0044_tool_usage_event.sql`

Both files are idempotent (`CREATE TABLE IF NOT EXISTS`), so replaying them
against a database that already has the objects is a no-op — production and the
existing preview branch keep the exact schema they have today (verified: the
live project already answers 200 for `push_subscription`, `tool_usage_event`,
`institute.default_currency`, `institute.instapay_url`, `child_billing.payment_link`).

Renumbering moves those two files past `0040`'s live-schema RLS loop, so each
file now re-asserts the KID-1177 posture (`ENABLE ROW LEVEL SECURITY` + revoke
from `anon`/`authenticated`); otherwise a fresh replay would create them without
RLS.

Regression pin: `tests/unit/kid2432-migration-versions.test.ts` fails if any
numeric prefix is duplicated again, if versions stop ascending, or if the two
renumbered files lose their guarded DDL / RLS re-assertion.

## Gates run (worktree, branch `fix/kid2432-migration-versions`)

- `npm run db:verify-migrations` — all passed, including the KID-1177 RLS and
  storage probes (`RLS is ENABLED on every app table`).
- `vitest run` — kid489-egp-default-currency, kid489-instapay-payment-link,
  kid745-contract, kid472-push-sound, kid472-billing-insights: 90/90;
  kid2432 pin 3/3.
- `tsc --noEmit` clean; `next lint` 0 errors (pre-existing `<img>` warnings only).

## Follow-up worth the founder's attention

Supabase Preview is configured with "create a preview branch per PR" **disabled**
(check output: "Creating a new preview branch per PR is disabled. You can
re-enable it in Project Integrations Settings."). The check therefore only runs
on master pushes and reports against the project dashboard, so PRs cannot
exercise it. If the integration is wanted, enabling per-PR branches makes the
next failure of this kind surface before merge.

## Resolution (2026-11-18, founder approved removal)

Founder accepted the removal card. `kid2123-clean`
(`prj_cYC28PpjIMDVRBcshGLpzNYnEp1p`) was deleted through the Vercel API
(`DELETE /v9/projects/prj_cYC28PpjIMDVRBcshGLpzNYnEp1p` → `204`).

- `GET /v9/projects/kid2123-clean` → `404`; team project list is now
  `['kiddy', 'kc-probe']`.
- Every one of its deployments was `ERROR`, including the latest master build
  `dpl_45dSuU1jbegQzZJUcY9ZLbJpWnm2` (KID-2437) — the project had `envs: []`
  and a single `kid2123-clean.vercel.app` alias.
- No new `Vercel – kid2123-clean` commit status can be posted after deletion.
  The status already recorded on older commits stays as a historical red X and
  cannot be rewritten.
- `Vercel – kiddy` is untouched; production remains live on `kiddyapp.net`.

Master `3fc77ce` check runs: `Supabase Preview` success, `audit` success,
`Vercel – kiddy` success.
