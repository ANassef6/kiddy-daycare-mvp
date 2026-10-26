# KID-236 evidence — "Enter as admin" verified in production

Run stamp: 2026-10-26T19:1xZ, head `4f543d8`, deploy `dpl_e8PAsCkK` (READY),
production `https://kiddyapp.net` only (never preview hosts, per KID-237).

| # | Check | Result |
| --- | --- | --- |
| P1 | `https://kiddyapp.net/login` renders on the apex host | pass |
| P2 | Operator sign-in lands on `https://kiddyapp.net/platform` | pass |
| P3 | Every daycare row shows the two distinct actions: public "Open daycare" link + "Enter as admin" | pass |
| P4 | Enter as admin on Sunshine Daycare lands INSIDE that daycare's own portal (`https://sunshine.kiddyapp.net/portal/dashboard`) — Sunshine branding, Sunshine data (7 children / 6 staff / 4 rooms) | pass |
| P5 | Persistent banner on the tenant surface: "Viewing Sunshine Daycare as platform operator" + Exit | pass |
| P6 | The same operator-view session on the second daycare's host (`maple-grove-daycare-2.kiddyapp.net`) is fail-closed refused to its branded login — no Maple data, no signed-in state | pass |
| P7 | Exit clears ONLY the view cookie and returns to `https://kiddyapp.net/platform` | pass |
| P8 | After exit the tenant portal is anonymous again (view cookie really cleared; the apex operator session is untouched) | pass |
| P9 | Disabled row refuses at the platform page (`/platform?error=enter-disabled`, friendly message) — Maple Grove Daycare is already Disabled in production, so the check used the row as-is with NO state mutation | pass |
| P10 | Replaying the spent single-use grant URL on its own host is refused (`/login?error=operator-entry-invalid`) | pass |

Raw output: `kid236-report.json`. Script: `kid236-verify.mjs` (credentials are
read from a run-local 0600 temp file at execution time; they never appear in
source, report, or screenshots). Screenshots are redacted in the DOM before
capture: the operator account identifier shows as `[operator email]`, and a
real child name surfaced by a tenant dashboard widget shows as
`[child name]`. No credential material anywhere.

## Production audit trail (platform_access_log, read-only query)

The same verification window left exactly the expected records:

```
refused  <operator> detail=malformed  19:12:10Z   <- the no-grant probe (curl)
enter    <operator> nonce=9121fc5a    19:13:56Z   <- first full Enter
exit     <operator>                   19:14:05Z   <- its Exit
enter    <operator> nonce=70fa1821    19:15:36Z   <- Enter (final pass)
exit     <operator>                   19:15:45Z   <- Exit
refused  <operator> detail=replay     19:15:52Z   <- P10 replay of the spent nonce
```

(Operator identifier omitted here per the no-credentials rails; the full
email is on the rows themselves in the production table.)

## Pre-deploy verification (same head, local https mirror of the topology)

Full unit suite green on the final code: `npm run test` 377/377 (36 files),
`npm run build` clean, `npm run lint` clean (one pre-existing `<img>` warning
in `app/portal/newsfeed/page.tsx`, untouched by this ticket),
`npm run db:verify-migrations` applies the whole chain incl.
`0026_platform_access_log.sql` on real Postgres (PGlite) and passes all
tenant-isolation invariants. Local browser pass (apex + two wildcard
subdomains over https on :443, Playwright) walked the same flow — enter →
banner → admin surfaces (Tools nav, staff page) → cross-tenant refusal →
disabled refusal → replay refusal → exit — before the push.
