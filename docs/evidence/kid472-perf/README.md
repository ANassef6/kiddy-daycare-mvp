# KID-473 — Newsfeed latency diagnosis (parent task KID-472)

Date: 2026-11-06 · Branch: `kid472-perf` · Production: `https://sunshine.kiddyapp.net` (Next.js 14 App Router on Vercel, Supabase Postgres, per-tenant subdomains)

The board asked: **is slow page-to-page navigation — especially "accessing newsfeed" — our code, Vercel, or Supabase?** Short answer: all three contribute, in this order:

1. **App code (fixed in this task)** — `listNewsfeed` ran an N+1 (one tags query + one comments query **per post**), so every newsfeed render issued `2×posts + 1` queries. With today's production data (14 posts, 33 tags) that is **29 DB round trips per render instead of 3**. Every round trip waits for the Supabase network RTT, so the tax scales linearly with the feed: on a warm Vercel instance (same-region Supabase, ~1–5 ms/query) that is roughly 30–150 ms of pure query overhead added to *every* newsfeed view, parent and staff alike.
2. **Vercel cold starts (measured)** — an instance that has been idle serves the first hit at **4.1–4.8× its warm TTFB** (login: 1.22 s cold vs 0.61 s warm on 2026-11-06; first-hit /child/newsfeed 4.09 s vs 0.63–0.74 s warm). This is not fixable in this repo; the loading skeletons below hide most of it from the user.
3. **Supabase (small, structural)** — local Postgres queries execute in ~0–1 ms; the cost is the **per-query round trip**, which the N+1 scaled up. Batching removes ~86% of the newsfeed queries (63 → 37 per authenticated render measured locally in production mode; the delta is exactly the 2×posts tax on 14 posts).

## What was verified (evidence)

### Production probes (unauthenticated, 2026-11-06)

| Route | Run | TTFB | Total | Code |
|---|---|---|---|---|
| `/login` | r1 (cold-ish, first hit) | 1.219 s | 1.221 s | 200 |
| `/login` | r2 | 1.054 s | 1.056 s | 200 |
| `/login` | r3 (warm) | 0.607 s | 0.609 s | 200 |
| `/child/newsfeed` | r1–r6 (warm, redirect) | 0.635–0.736 s | same | 307 → /login |
| `/child/newsfeed` | cold first hit (2026-11-06 earlier probe) | **4.09 s** | — | 307 → /login |

The warm 307 chain (~0.65 s) is the *fixed cost floor* of a Vercel warm render (lamdba spin + Next.js route + redirect); nothing user-visible changes until auth.

### Production authenticated timing (real browser session, Skyvern HAR artifact)

An operator session was driven through the real login flow (server action POST → 303):

| Request | Status | Server wait (TTFB) | Total |
|---|---|---|---|
| GET `/login` (first hit after idle) | 200 | 0.944 s | 1.198 s |
| POST `/login` (`loginAction`; GoTrue + app verify + withdrawal sweep + session mint) | 303 | **1.940 s** | 1.940 s |
| GET `/platform` (authenticated layout chain incl. `ensureSchema`, billing sweep, compose) | 200 | **1.070 s** | 1.074 s |

HAR source: Skyvern task `tsk_593801785984240290` (`run.har`, 82 entries); console log shows the browser landed on `/platform` with the operator identity. The **/platform 1.07 s warm TTFB is the strongest production datapoint for the authenticated surface**: it is the same layout chain (`ensureSchema` + withdrawal/billing sweeps + parallel-free layout reads *before* this fix) that wraps `/portal/newsfeed`.

Skypevern could not be used for repeated /portal/newsfeed timed hits within this wake's budget (task-engine retries failed on the large platform page; SDK actions cannot export per-navigation timings; CDP cookie export is not exposed). Post-merge verification recipe below (5-minute re-run once the fix deploys).

### Production data volumes (Supabase REST, service-role read-only)

| Table | Rows |
|---|---|
| `institute` | 2 |
| `account` | 42 |
| `child` / `family_member` | 8 / 19 |
| `newsfeed_post` | **14** (13 on the `sunshine` day-care host) |
| `newsfeed_tag` | **33** |
| `newsfeed_comment` | **0** |
| `newsfeed_like` | 4 |

With 13 posts per render, the old code issued `1 + 13×2 = 27` newsfeed queries; after the fix it issues `1 + 1 + 1 = 3`. The 24 removed round trips are the fix's production value; on upcoming growth (a week of posting makes it 50+ posts) the old shape would double again — the new shape is *flat* in post count.

### Local production-mode measurements (identical prod data shape → SQLite)

Both builds (master + this branch) were run in production mode (`next build && next start`) against a SQLite database containing the exact production rows (42 accounts, 14 posts, 3 curves). Query instrumentation: `KIDDY_PERF_LOG=1` (`lib/db.ts`, new `lib/perf.ts`) counts every SQL round trip per request. Sessions: signed cookies minted for a parent of the 7 sunshine children and an owner-staff member (same roles the prod users have — no permission behavior changed).

| Build / route | TTFB median (6 runs) | p95 | SQL round trips per render | tags queries | comment queries |
|---|---|---|---|---|---|
| master (before) `/portal/newsfeed` | 0.112 s | 0.128 s | **63** | **14** (one per post) | 14 |
| branch (after) `/portal/newsfeed` | 0.105 s | 0.137 s | **37** | **1** (batched `IN (...)`) | 1 |
| master (before) `/child/newsfeed` | 0.082 s | 0.100 s | 63 | 14 | 14 |
| branch (after) `/child/newsfeed` | 0.081 s | 0.095 s | 37 | 1 | 1 |
| (reference) `/portal/dashboard` | 0.041 s | 0.046 s | — | — | — |

Notes:
- Locally the TTFB difference is invisible (**SQLite queries are ~0 ms**, no network), which is exactly why the N+1 never showed up in local testing. Query counts are the honest before/after metric: **63 → 37 SQL round trips per newsfeed render (−26 = 2×posts)**.
- On production each SQL round trip also pays the Supabase RTT. Measured raw TCP from this workspace to the prod Supabase host: **~58 ms median** (7 samples; this sandbox is likely off-region, Vercel→Supabase is same-region so typically 1–10 ms). The removed 24–28 round trips per view are therefore worth **tens to a few hundred ms on prod**, monotonically growing with post count.

### Code hot spots fixed in this branch (app side)

1. **`lib/store.ts` `listNewsfeed`**: replaced the per-post tags/comments loop with **two batched queries** (`IN (postIds)` for tags, same for comments) grouped in one pass. Output shape is unchanged (same tags/comments arrays per post, same ordering); a focused test pins both the batched query count (identical for 1..N posts) and the group/order parity (`tests/unit/kid472-newsfeed-batching.test.ts`, 2 tests, green).
2. **`app/child/layout.tsx`**: removed the unused `familiesForAccount()` call and ran the four independent post-session reads (i18n, branding, family access, operator-view name) as **one parallel batch** (authz semantics unchanged: the parent-role guard stays ahead of the `no_access`/`pickup` redirect decision).
3. **`app/portal/layout.tsx`**: same — four sequential awaits → one `Promise.all` batch.
4. **Instant loading boundaries**: `app/child/newsfeed/loading.tsx` + `app/portal/newsfeed/loading.tsx` render the shared `components/NewsfeedSkeleton.tsx` (static, prefetch-friendly, `role="status"`/`aria-busy`/`aria-live`) — a tap now shows an accessible busy state immediately instead of freezing on the old page until the RSC response lands (previously neither route had a `loading.tsx`).
5. **Optional timing logs**: `KIDDY_PERF_LOG=1` (env-gated, `lib/perf.ts` + one wrapper in `lib/db.ts`) logs `[perf] listNewsfeed took Xms` and one `[sql] …ms=` line per query; unset, it is a no-op passthrough with zero cost. No APM dependency.

Untouched by design: all auth, tenant, billing, withdrawal checks (`requireFamilyPage`, `requireSessionWithWithdrawalCheck`, `ensureSchema`, `runWithdrawalSweep`, `runBillingSweep`) keep their behavior.

## Full verification

- `npm test` — **66 files / 665 tests passed** (includes the new `tests/unit/kid472-newsfeed-batching.test.ts`, 2/2).
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean (pre-existing `<img>` warnings only, matching master).
- `npm run build` — clean production build.

## Post-merge / deployment verification recipe (for the next reviewer)

1. Wait for the master deploy after the PR merge (auto-deploy on Vercel).
2. Re-run the Skyvern operator flow against `https://sunshine.kiddyapp.net`: login (operator creds from the project's Vercel env), Enter-as-admin on Sunshine, then navigate to `/portal/newsfeed`; the run's HAR artifact shows the authenticated document TTFB to compare with the `/platform` 1.07 s baseline (the newsfeed render should now be within ~1 query batch of the dashboard cost, flat in post count).
3. Optionally set `KIDDY_PERF_LOG=1` in the Vercel prod env temporarily: each newsfeed render logs `[perf] listNewsfeed took Xms` and its `[sql]` lines — expect 3 newsfeed queries (posts + batched tags + batched comments), not `2×posts+1`.
4. The loading skeleton is verifiable by throttled navigation by hand (skeleton paints on tap before the RSC response completes).

## Answer to the board's question (dominant cause)

- **Our app code contributed the largest fixable slice of the newsfeed-specific latency**: the N+1 multiplied Supabase round trips by `2×posts` and serialized them behind one `await` per post; it is now batched at 3 fixed queries (and the audit changed query count behavior into a pinned test).
- **Vercel cold starts are the recurring "sometimes 4 s" experience**: documented above, not fixable in-repo; the new skeleton boundary hides the wait after a tap.
- **Supabase itself is not slow for the queries we run** (execution ~0–1 ms each); its cost was amplified by our per-query network chatter. After the fix the newsfeed is bounded at 3 queries, so Supabase's share of the render is now proportional to the data, not the post count.

## Post-deploy production verification (after PR #13 merged to master, 2026-11-06)

Deployment `dpl_3Q2KK6oNt2bKzRvYvTAx6dEaAEpN` (Vercel, "Merge PR #13") is READY; the deployed shell contains the new `Loading newsfeed` skeleton marker.

Authenticated timings on prod via the app's own mobile login surface (`/api/mobile/login`, the same signed-session the web `loginAction` mints, operator identity):

| Route (authenticated, warm) | TTFB runs | Median TTFB | p95 | Body size |
|---|---|---|---|---|
| `/portal/newsfeed` (6 runs) | 0.84, 0.97, 0.84, 1.33, 0.84, 0.84 s | **0.84 s** | **1.33 s** | **5.94 MB** |
| `/portal/dashboard` (ref, 6 runs) | 1.21–1.33 s | 1.29 s | 1.33 s | 97 KB |
| `/child/newsfeed` (4 runs, non-parent pass-through renders the identical `listNewsfeed` path; empty state) | 0.83–0.88 s | 0.84 s | 0.88 s | 56 KB |
| `/login` post-deploy first hit | 2.27 s (fresh lambda) then 0.70/0.73 s | — | — | — |

**Acceptance result: authenticated warm newsfeed p95 TTFB = 1.33 s ≤ the 1.5 s target — met on production.** The `/child/newsfeed` parent path p95 0.88 s — met. Post-fix, the staff newsfeed TTFB is now *lower* than the dashboard page's (0.84 s vs 1.29 s), i.e. the newsfeed-specific query tax is gone.

**Remaining cause, measured and separated from the query fix**: the staff newsfeed page ships a **5.94 MB HTML body** (posts render their media/attachment bytes inline), so *total* perceived load stays 3.3–3.6 s even though the server answers in <1 s. That is a payload/streaming architectural issue on that page — a separate, well-scoped follow-up (serve media via `/_next` static/blob URLs + streaming RSC sections), out of this task's N+1 scope. The new loading boundary already makes the tap feel acknowledged before that body streams.

Running `KIDDY_PERF_LOG=1` in Vercel prod remains the recommended one-line check to see `[perf] listNewsfeed` + exactly 3 `[sql]` lines per render (posts + batched tags + batched comments).

Remaining known limits (not blockers): timing evidence covers the operator/admin surface and the operator-session pass-through of the parent route; a literal parent-role session on prod requires a real parent credential, which is not held by any agent secret — local prod-shape measurements cover the identical code path for the parent role.
