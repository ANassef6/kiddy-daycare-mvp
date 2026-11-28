# KID-2527 — finalize KID-2479 (supplies child selector) on staging and production

Status: **shipped to staging and production, 2026-11-28.**

## Approval

| Item | Value |
| --- | --- |
| Founder authorization | KID-215 comment `2aaa406e-4bae-4f63-8ea2-8bc45cf75a0c`, 2026-11-28T10:53Z: "Yes, finalize KID-2479 please. I need to make sure that production is fully up to date." |
| Scoped task | KID-2527 |
| Validation model | Founder sign-off given up front; tester validation happens on production instead of a separate founder staging pass. |
| Sequenced after | KID-2526 (migration numbering and cherry-pick base stable). |

## State at task start

| Item | Value |
| --- | --- |
| Stale branch | `kid2479-supplies-child`, PR #121, targeted `master`, never merged. The earlier "done on staging" report was stale. |
| Branch base | `d2e1ed2` — 186 commits behind `origin/staging`. |
| Migration collision | The branch carried `0055_kid2479_supply_child.sql`; staging/master next free slot was `0064` after the 27 Nov renumber cut (0055–0063). |
| Runtime | `staging` at `ff88ab6`; `master` at `d278e1a` (KID-2526 cut report). |

## What changed

| Step | Result |
| --- | --- |
| Refresh | Cherry-picked `1b5e0d0` onto `origin/staging`, resolved the `page.tsx` / `actions.ts` / `sqlite-schema.ts` conflicts, kept KID-2482's recipients picker. |
| Migration | Renamed to `0064_kid2479_supply_child.sql` — additive only: nullable `supply_request.child_id` + `idx_supply_child`, `ON DELETE SET NULL`. |
| Newsfeed precedence | A picked child wins the newsfeed tag (only that child); with no child picked, KID-2482's recipients audience behaves exactly as before. |
| Staging merge | PR #121 retargeted to `staging`, checks green, merged at 2026-11-28T11:34:50Z (`607a4e5`). |
| Production cut | Cherry-picked `e7b9081` onto `master` (clean), PR #185, checks green, merged at 2026-11-28T12:06:23Z (`b92e63e`). |

## CI / local gates

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean (staging tree and master cut tree) |
| Targeted suites | 20/20 — KID-2479 (6), KID-2432 migration versions (3), db-split (6), KID-2482 recipient surfaces (5) |
| `node scripts/audit-gate.mjs` | PASS — no unresolved critical/high vulnerabilities |
| GitHub checks | staging `Cloudflare Workers verify` run `46140332525` success; cut PR runs `46142765949` (verify) and `46142765927` (audit) success |
| Known unrelated red test | `tests/unit/kid472-audit-trail.test.ts` fails `checkInOutAction` on `origin/staging` before this change (verified on a pristine staging worktree); it is not part of the CI gate and is untouched here. |

## Staging deployment

| Item | Value |
| --- | --- |
| Source | `origin/staging` @ `607a4e5` |
| Worker build | `npx opennextjs-cloudflare build`, then `npx wrangler deploy --env staging` |
| Deployed version | `be821ede-0cac-411e-90c7-2e92294eebae` (2026-11-28T11:39:09Z) |
| Rollback target (defined before deploy) | `9e081270-7a40-41b1-88f5-e95e4c6736fd` (KID-2525 staging build) |
| Host | https://staging.kiddyapp.net |

### Staging migration

The Worker runtime does not execute `supabase/migrations` SQL (the SQL files are
not part of the uploaded module graph), and the staging ledger was behind. The
migration was applied to the staging project `pjubkhhuccoqboypgpty` with the
Supabase Management query API in one transaction, then recorded by filename:

```sql
BEGIN;
ALTER TABLE supply_request ADD COLUMN IF NOT EXISTS child_id TEXT REFERENCES child(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_supply_child ON supply_request (child_id);
INSERT INTO public.schema_migrations(file) VALUES ('0064_kid2479_supply_child.sql') ON CONFLICT (file) DO NOTHING;
COMMIT;
```

Verified after apply: `supply_request.child_id` is `text`, nullable; `idx_supply_child` exists; FK `supply_request_child_id_fkey` has `confdeltype = n` (`ON DELETE SET NULL`); ledger has `0064_kid2479_supply_child.sql`.

## Staging verification (real sessions, Founder Test Daycare)

Signed in through `/api/mobile/login` and requested `/portal/supplies` with the
returned `kiddy_sess` cookie.

| Check | Result |
| --- | --- |
| Optional child dropdown | `/portal/supplies` renders `<select name="childId">` with `General request (all children)`, `Layla Founder`, `Omar Founder`. |
| Empty = general request | A general request was created and its card shows **General request (all children)**. |
| Child request card | A request for Omar was created and its card shows **for Omar Founder**. |
| Newsfeed tagging | Child-specific post tagged exactly `[Omar]`; general post tagged both children (Layla + Omar), the KID-2482 fallback. |
| Parent scoping | Parent account (linked to Layla + Omar) sees the general and Omar requests; a temporary request for an unlinked third child was **not** visible to the parent and **was** visible to the owner. The temporary child and request were deleted afterwards. |
| Arabic | With the account language set to `ar` (restored to `en` afterwards), the dropdown is `طلب عام (كل الأطفال)`, the card is `لـ Omar Founder`, and the page renders `dir="rtl"`. |

Staging fixtures left for tester inspection: `KID-2527 staging check` (for Omar)
and `KID-2527 general check` (general), plus their newsfeed posts.

## Production cut

| Item | Value |
| --- | --- |
| Source | `origin/master` @ `b92e63e` |
| Worker build | `npx opennextjs-cloudflare build`, then `npx wrangler deploy --env="" --message KID-2527-production-cut-master-b92e63e` |
| Deployed Worker version | `987e8d3c-549e-4aee-a3cc-0dee03347d02` (2026-11-28T12:11:43Z) |
| Worker rollback target (defined before deploy) | `5a6b5576-c58d-42d7-9a44-1f703f82d273` (KID-2526 cut) |
| Vercel deployment | `dpl_BpvogQdi9GqnuWfBCvKtN1yuh9CQ`, READY, production |
| Vercel URL | https://kiddy-982i1b0lj-kiddy2.vercel.app |
| Vercel aliases | `kiddyapp.net`, `*.kiddyapp.net`, `kiddy-one.vercel.app`, `sunshine.kiddyapp.net`, `maple-grove.kiddyapp.net`, `maple-grove-daycare.kiddyapp.net`, `maple-grove-daycare-2.kiddyapp.net` |
| Vercel rollback target | `dpl_96WHwLiLYH5mrJvhtaqH8JLehSZy` (KID-2526 build) |

### Production migration

Applied to project `sfetmfmtoubtdyyeyudd` in one transaction with the same
statement and ledger insert as staging, before the Worker deploy.

| Check | Result |
| --- | --- |
| `supply_request.child_id` | present, `text`, nullable |
| `idx_supply_child` | present |
| FK `supply_request_child_id_fkey` | `ON DELETE SET NULL` (`confdeltype = n`) |
| Ledger | `0064_kid2479_supply_child.sql` recorded |
| `supply_request` rows | unchanged (3 before and after; migration is additive) |

## Production verification

| Check | Result |
| --- | --- |
| Worker version | `kiddy-web` current version `987e8d3c` (2026-11-28T12:11:43Z) |
| Served bundle matches the cut | `https://kiddyapp.net/login` references `layout-4bfb6996dd1c3eca.js`, identical to the local `master` build. |
| New strings in the cut bundle | `General request (all children)`, `for {name}`, `idx_supply_child` present in the built server bundle. |
| Vercel alias | `kiddy-982i1b0lj-kiddy2.vercel.app` and `kiddy-one.vercel.app` serve the same layout chunk (`layout-115501a2d37e6172.js`), so the production alias points at the new deployment. |
| `/`, `/login`, `/features` | `200` on `kiddyapp.net` and `kiddy-one.vercel.app` |
| `/portal/supplies`, `/child` | `307 -> /login` on both hosts |
| `/api/notifications/open?id=test` | `307 -> /login` (no open redirect) |
| Headers | `server: cloudflare`, `x-opennext: 1`, CSP still report-only |

Production parent/owner credentials are not available in this workspace, so no
signed-in production click was made. This follows the same production-evidence
method as KID-2487, KID-2511, KID-2519, KID-2524, KID-2525 and KID-2526: the
behaviour was verified with real sessions on staging, the production database has
every column/index/FK the paths read, and the production Worker bundle contains
the cut code. Testers validate the signed-in production flow.

## Rollback

Worker:

```sh
npx wrangler rollback --env="" --version-id 5a6b5576-c58d-42d7-9a44-1f703f82d273
```

Vercel: promote `dpl_96WHwLiLYH5mrJvhtaqH8JLehSZy` back to the production
aliases. No database rollback is needed; `0064` is additive and the older builds
ignore the new nullable column.

## Notes

- Staging's ledger was also missing the renamed `0061`–`0063` filenames, although
  the schema they add already exists under the old `0055`/`0056` names. This is
  pre-existing and not changed by this cut; only `0064` was applied.
