# KID-2476 — production cut record (marketing reveal re-arm)

Status: **complete — the production Worker is cut, deployed and verified.**

The branch verification and reproduction live in `README.md`. This record
covers the production cut only.

## Approval

The founder accepted the human-only confirmation card
`662df33d-52a3-4305-8f3d-c03d6b6ba659` ("Founder sign-off: KID-2476 production
cut") on **2026-11-25T14:46:36Z**.

## What shipped

`master` never received the KID-2458 re-arm fix, so production still ran the
early-return `SiteReveal` and blanked every marketing hero after a client-side
navigation. This cut ships both changes:

- `f1840f8` — KID-2458: `SiteReveal` keyed on `usePathname()`, the four
  `section-head` heroes removed from `[data-reveal]`.
- `2740817` — KID-2476: reveal pass extracted to `lib/marketing-reveal.ts`,
  unit re-arm guard, real-browser nav probe, evidence.

| Item | Value |
| --- | --- |
| Pull request | #116 `kid2476-prod-cut` → `master` |
| Merge commit | `101c837430e324525b00f6dc294193f494ca2be9` (2026-11-25T14:48:46Z) |
| Worker | `kiddy-web` version `8ba54e27-29a7-4e6c-9954-ef1ec00abb0b` (2026-11-25T14:55:10Z) |
| Deploy message | `KID-2476-marketing-reveal-master-101c837` |
| Previous worker version (rollback) | `6cad1a8a-57e2-4366-8428-d6921748c091` (KID-2466 build, 2026-11-24T00:24Z) |
| Routes / DNS | unchanged |
| Migrations | none |

Only `master` code changes since the previous Worker were the KID-2458 and
KID-2476 reveal commits; the remaining commits were evidence documents. The
deploy is additive: Worker secrets, the Hyperdrive binding, the cron trigger
and zone routes were not touched.

### Build inputs

The same public values as the previous production build:

- `NEXT_PUBLIC_SITE_URL=https://kiddyapp.net`
- `NEXT_PUBLIC_SUPABASE_URL=https://sfetmfmtoubtdyyeyudd.supabase.co`
- `NEXT_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.kiddyapp.net`
- `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` — public value already present in the
  live `layout-*.js` chunk
- `PUBLIC_APEX_DOMAIN=kiddyapp.net`
- `KIDDY_CSP_MODE=report-only`
- `SESSION_SECRET` — build-only boot check; the Worker keeps its runtime secret
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` was not set at build time, matching the
  previous build

Deploy method: `npx opennextjs-cloudflare build` on `101c837`, then
`npx wrangler deploy --message KID-2476-marketing-reveal-master-101c837`.

## Live verification (production, 2026-11-25T15:00:15Z)

Probe: `scripts/verify-marketing-reveal-nav.mjs`, real Chromium 131 at
1366×900. Landing page loaded once, then header nav clicks with no reload.
Raw copy: `prod-verify.json`.

| Flow | Failures | In-viewport hidden (immediate) | Hidden after scroll-through | Hero opacity |
| --- | --- | --- | --- | --- |
| forward: `/` → `/features` → `/for-parents` → `/for-centers` → `/contact` → `/` | 0 | 0 | 0 | 1 on every page |
| reverse: `/` → `/contact` → `/for-centers` → `/for-parents` → `/features` → `/` | 0 | 0 | 0 | 1 on every page |
| `prefers-reduced-motion: reduce` | 0 | 0 | 0 | 1 on every page |
| JavaScript disabled | 0 | — | — | hero visible on all five pages, HTML never armed |

Top-level `pass: true`; all four result groups have `failures: []`.

Captures: `prod-cut-forward-for-centers.png`,
`prod-cut-reverse-for-centers.png`, `prod-cut-forward-features.png`,
`prod-cut-forward-for-parents.png`, `prod-cut-forward-contact.png`,
`prod-cut-forward-home.png`, `prod-cut-reduced-motion-home.png`,
`prod-cut-no-js-for-centers.png`.

### Served bundle

| Check | Result |
| --- | --- |
| `GET /` | `200`, `server: cloudflare`, `x-opennext: 1` |
| Served layout chunk | `layout-b9b001025e95fe32.js` (build output of `101c837`) |
| Chatwoot token inlined in that chunk | yes (launcher unchanged) |
| `/for-centers` hero server HTML | `<section class="section section-head">` — no `data-reveal` |
| Marketing page chunk | `app/*/page-957058e318e17b38.js`, contains the re-arm driver |
| Direct load / hard reload | correct on all five pages |

## Rollback

```sh
npx wrangler rollback --name kiddy-web
```

That returns the Worker to `6cad1a8a-57e2-4366-8428-d6921748c091` (KID-2466)
and restores the blank-hero defect. No route, DNS or migration change was made.
