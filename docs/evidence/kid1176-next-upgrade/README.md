# KID-1176 — P0 security: upgrade Next.js and clear dependency advisories

Remediates KID-1170 findings **F-01** (Next.js 14 pinned with 20+ critical/high
advisories) and **F-09** (postcss / source-map-js transitive advisories), plus
the **P2 hygiene** items (CI dependency-audit gate, production source-map /
error-exposure check). Owner approval: KID-215 comment
cffad44f-eb1b-4094-b01d-df23c8774420 ("Let's work on them all and make sure
that everything is in a top notch."), 2026-11-09.

## What changed

1. **`next` ^14.2.5 → 15.5.29** (and `eslint-config-next` to match). 15.5.29 is
   the lowest patched release that clears every `next` advisory in the audit
   (it is the `backport` dist-tag of the 15.x line). The newest 15.x line
   releases (15.1.x / 15.2.x / 15.3.x tags) are older patch sets; 15.5.29 is
   the current patched 15.x release. `npm audit fix --force` would have jumped
   to next@16.4.5 (a larger breaking change); the plan asked for the lowest
   patched release first, and 15.x clears all findings, so 16.x is not needed.
2. **react / react-dom 18 → 19** — required by Next 15 App Router (peer dep
   `^19.0.0`), `@types/react`/`@types/react-dom` to 19.
3. **`postcss` override → ^8.5.32, `source-map-js` override → ^1.2.2**
   (package.json `overrides`). Both are transitives of `next` (next pins
   postcss 8.4.31 — even next@16.4.5 does), so the npm-override is the only
   way to clear F-09 while staying on the patched 15.x line. Patched versions
   are the latest published (postcss 8.5.32, source-map-js 1.2.2).
4. **Next 15 code migration** (breaking changes):
   - Async request APIs: `cookies()`, `headers()` are promises now — every
     call site awaits them (`lib/require.ts`, `lib/url.ts`, `lib/tenant.ts`,
     `lib/theme.ts`, `lib/manifest.ts`, `lib/audit.ts`, `lib/actions.ts`,
     `app/layout.tsx`, `app/login/page.tsx`, `app/forgot-password/page.tsx`,
     the API routes). Sync helpers became async:
     `requireSession`, `requireSessionWithWithdrawalCheck` (already async),
     `requireAuthSession`, `requirePlatformOperator`, `authAccount`,
     `requestOrigin`, `publicOrigin`, `loginGateDict`, `logoutResponse`,
     `session()` in push/subscribe — and all 52 `requireSession()` page call
     sites await.
   - Page props: `params` / `searchParams` are promises in pages/layouts and
     route handlers — migrated in every dynamic route (used the official
     `@next/codemod next-async-request-api` transform, 30 files, plus manual
     fixes) and in the tests that render those pages directly
     (`Promise.resolve({...})` at the call sites).
   - `next.config.mjs`: `experimental.serverComponentsExternalPackages` →
     `serverExternalPackages` (promoted to stable in Next 15). The
     `/.well-known/assetlinks.json` rewrite (KID-443) and the `@/` webpack
     alias are unchanged and still work.
5. **CI dependency-audit gate (P2)**: `.github/workflows/audit.yml` runs on
   every push to master and every PR:
   - `npm ci`
   - `node scripts/audit-gate.mjs --self-test` — proves the gate logic fails
     on an unexcepted high, fails on an expired exception, passes a reviewed
     exception and ignores sub-high findings (deterministic fixture).
   - `node scripts/audit-gate.mjs` — the real gate: runs `npm audit --json`,
     fails on any critical/high finding not covered by a reviewed, expiring
     exception in `scripts/audit-exceptions.json` (empty today).
6. **Production source maps / error exposure (P2)**: verified below.

## Verification (gates)

| Gate | Result |
| --- | --- |
| `npm audit` | 0 vulnerabilities (was: 1 critical aggregate for next with 20+ advisories, postcss high, source-map-js high) |
| `npx tsc --noEmit` | clean |
| `next lint` | clean — 0 errors; 6 `no-img-element` warnings that are identical on the origin/master baseline (verified by stashing the upgrade) |
| `npm test` | 89 files / 969 tests green (three files needed React 19 adjacents: the async `publicOrigin` awaits in url.test, case-insensitive `formaction` pin in kid255, and kid221's leak scanner skipping the React 19 SSR submit-shim `<script>`) |
| `next build` | green on 15.5.29 |
| `db:verify-migrations` | all migration checks passed |
| Vercel preview smoke | see below (branch push → preview deployment) |
| Source-map / error-exposure check | see below |

## Production smoke (local `next start` on the built bundle)

- `/login` → 200; `/api/notifications/unread` unauthenticated → clean
  `{"error":{"code":"unauthorized",…}}` 401 with **no stack trace, no paths**.
- `/.well-known/assetlinks.json` (the KID-443 rewrite) reaches the API route
  and answers the designed fail-closed
  `{"error":{"code":"no_twa_app","message":"No Android app published for localhost:4799"}}`
  — the rewrite survives the upgrade; per-host tenancy behavior unchanged.
- **Source maps:** `find .next -name '*.map'` → **0 files**.
  `productionBrowserSourceMaps` is not set (Next default off), so neither
  client nor server bundles ship source maps in this build. Nothing under
  `/_next/static` can leak original sources.
- **Error exposure:** unauthenticated API errors return the uniform minimal
  JSON error shape; the 404 page renders Next's generic view with no frames.
  Server actions catch their own errors and log server-side only (46
  `console.error` sites in lib/actions.ts; responses carry localized
  messages/digests, never stacks).
## Vercel preview smoke (branch deployment)

- Branch push → Vercel Preview deployment `dpl_JCzw` (READY,
  `kiddy-7moh11bhv-kiddy2.vercel.app`, ref kid1176-next-upgrade = the PR head
  commit).
- Through the project's automation bypass (created for the smoke, revoked
  right after): `/login` → 200 with the login form; `/.well-known/assetlinks.json`
  → the rewrite serves the route's designed fail-closed `no_twa_app` JSON for
  the unregistered preview host (per-host tenancy rule intact); a
  `/_next/static/**.map` probe → 404 (no source maps on the preview either).
- **Real-browser login proof (Playwright-equivalent browser driven through
  Skyvern against the local production build of the same commit, and an
  HTTP-logging proxy capturing the wire):** filling superadmin@kiddy.test /
  the demo password and clicking **Sign in** produces
  `POST /login` with header `Next-Action: 40b96496…` (the loginAction server
  reference) followed immediately by the browser loading
  `/_next/static/chunks/app/platform/page-…js` — the operator dashboard. The
  React 19 client-action mechanism (inline client closure → server action →
  RSC navigation) works end-to-end on 15.5.29; all other forms share this
  mechanism.
- First preview attempt note (honesty): a browser run against the PROTECTED
  preview through the query-param bypass could not complete login — the
  server-action fetch does not carry the bypass credentials, so Vercel
  Authentication 302s it. That is a protection-bypass artifact, not an app
  defect: the identical flow against the same build without deployment
  protection succeeds (proof above). CI audit gate:
  run 42635555423 (`dependency-audit`) → success in 53s —
  `audit-gate self-test: PASS` and `audit-gate: PASS — no unresolved
  critical/high dependency vulnerabilities.`

## Rollback

The change is a single PR/branch (`kid1176-next-upgrade`). Rollback = close the
PR without merging (or `git revert` the merge commit on master):

```sh
# revert after merge
git revert -m 1 <merge-commit>
git push origin master
```

Dependency rollback: `package.json`/`package-lock.json` revert restores
next@14.2.5 + react 18. **Do not roll back the SESSION_SECRET rotation
(KID-1175) with this change** — they are independent. Vercel: redeploy the
last-known-good production deployment from the Vercel dashboard (Instant
Rollback) if a bad deploy must be reverted before git lands.

## Honest notes

- The container running the verification has no `make`/compiler, so native
  module builds use better-sqlite3's shipped NAPI prebuilds (same as every
  prior gate run in this repo — version unchanged by this task).
- The test suite in this environment runs alongside a concurrent tenant task's
  runs; timings are inflated but every gate is a pass/fail signal.
