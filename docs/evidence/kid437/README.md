# KID-437 — Sunshine branding landed on production + tenant brand header on the auth pages

The KID-434 chain close-out: the KID-435 Sunshine title fix (`kid435-sunshine-parity` @ `299bdbb`) and
the KID-436 FAIL 1b fix (tenant brand header on `/register` + `/forgot-password`) plus the
`kid435-mobile-tenant-branding` @ `ae2c9cc` multi-daycare brand rule are all merged into master and
served by the web production deployment.

## Merges

| What | Where |
| --- | --- |
| PR #4 — Sunshine Parity titles + the KID-427 button removal that had not landed on master | `kid435-sunshine-parity` → master @ `cef83e509` |
| PR #5 — `ae2c9cc` mobile lineage lands on master + KID-436 FAIL 1b brand header | `kid437-mobile-tenant-branding` → master @ `ed20d91ac`; merge-commit `0c735f1` brings `ae2c9cc` in with parents `cef83e509` + `ae2c9cc`, the 1b fix is `3653328` |

**Mobile lineage decision (item 2):** master could not take `ae2c9cc` literally as "already in master"
(master's platform-rework lineage has never carried the mobile API layer at all — verified `app/api/mobile/*`
and `lib/mobile-api.ts` were absent). The merge landed everything the kept surface needs (the mobile API    		
routes, `lib/mobile-api.ts`, the RN app dir, the demo setup script, and the two ae2c9cc-lineage unit suites,
now PASSING against master's backend) while keeping master's side on the 12 conflicted core files and
dropping the M3-era parent-billing layer + old-lineage backend suites that master's KID-244/245/246 billing
superseded (the KID-421 keep-master precedent). `kiddy-mobile-api.vercel.app` keeps serving the `ae2c9cc`
build (`dpl_AzfL4HDbu43yy5Cd51D6q7k2hTXu`, promoted in `299bdbb`).

## KID-436 FAIL 1b fix (`3653328`)

`/register` and `/forgot-password` (and `/login`'s SSR paint) kept a hardcoded
`<span className="brand">Kiddy</span>` on a daycare's own subdomain. All three auth pages now share
`components/AuthBrand.tsx` (the KID-368 client-side `/api/branding` fetch) with the server pages
resolving the first paint through `lib/theme.ts brandNameForTitle()` — the exact rule the KID-435 titles
use, so a known subdomain paints the tenant brand even before hydration. Regression test:
`tests/unit/kid437-auth-brand-header.test.tsx` (7 tests).

## Deployment

Normal Vercel prod path (git integration): the master merges triggered production builds.
**`dpl_DEqMPgubGAMecYyMxU5ediwDGU3y`** (`ed20d91ac`, READY) serves
`kiddyapp.net`, `*.kiddyapp.net` (incl. `sunshine.kiddyapp.net`), `kiddy-one.vercel.app`.
The prior prod (`dpl_6Ehkamtx` @ `0095020e`) is superseded.

## Live evidence (raw captures in this folder, summary in live-probes.json)

Raw `curl` SSR on `https://sunshine.kiddyapp.net` (captured 2026-11-02 14:48Z):

| Surface | `<title>` | body `Kiddy` hits | SSR brand span |
| --- | --- | --- | --- |
| `/login` | Sunshine Daycare — childcare, in your pocket | **0** | Sunshine Daycare |
| `/register` | Sunshine Daycare — childcare, in your pocket | **0** | Sunshine Daycare |
| `/forgot-password` | Sunshine Daycare — childcare, in your pocket | **0** | Sunshine Daycare |
| `/child` (signed in as the Sunshine parent via `/api/mobile/login`) | Sunshine Daycare — childcare, in your pocket | 3 (invisible RSC/flight payload strings only — the signOutLabel dict, "Ask the Kiddy team" subtitle, "using Kiddy." help subtitle; zero rendered-DOM Kiddy) | Sunshine Daycare |
| `kiddyapp.net/` (apex control) | Kiddy — childcare management software for Egyptian daycares | — | — |
| `kiddyapp.net/manifest.webmanifest` | `"name":"Kiddy"`, `"theme_color":"#3B82F6"` (generic, unchanged) | — | — |

`kiddy-mobile-api.vercel.app`: `/api/mobile/bootstrap` → 401 JSON, `/api/mobile/login` → 400 structured
error — the `ae2c9cc`-lineage build keeps serving, unchanged.

## Full-suite gate

`kid437-mobile-tenant-branding` @ `3653328` (the PR #5 head, byte-identical to merged master `ed20d91`):
**626/626 tests** (58 files: 612 base + 4 mobile-child-idor + 3 kid435-mobile-tenant-branding + 7 new
kid437-auth-brand-header), `tsc --noEmit` clean, `next lint` clean except the 6 pre-existing `<img>`
warnings (`AuthBrand`'s img is explicitly disabled), `next build` clean. `tests/unit/kid435-tenant-title.test.tsx`
stays green across both merges.

No Play Store / keystore / signing action — packaging stays human-owned (`docs/WHITE_LABEL_APPS.md`).
