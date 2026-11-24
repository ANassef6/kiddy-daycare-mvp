# KID-2476 — public-page headers/hero blank after client-side navigation

## Symptom

Founder report via KID-215 (2026-11-24T15:59Z): after clicking through the
public site, the **For centers** page showed a completely blank hero and
missing section headers — only the nav bar and the feature cards were visible.
A hard reload of the same URL rendered it correctly.

This is the same defect class as KID-2458. It is a production-only recurrence:
the KID-2458 fix was merged to **staging** and verified there, but it was never
cut to `master`, so the production Worker still serves the old client code.

## Reproduction (production, 2026-11-24)

Probe: `scripts/verify-marketing-reveal-nav.mjs`, real Chromium 131 at
1366×900, landing page loaded once, then header nav clicks (no reload).

| Flow | Hero effective opacity | Stuck `[data-reveal]` in viewport |
| --- | --- | --- |
| `/` → `/features` | 0 | `.container` (hero) |
| `/features` → `/for-parents` | 0 | hero + closing section |
| `/for-parents` → `/for-centers` | 0 | hero + closing section |
| `/for-centers` → `/contact` | 0 | hero |
| `/contact` → `/` | 1 | in-viewport landing headings |
| reverse direction (`/` → `/contact` → … → `/features`) | 0 on every inner page | same |

`prod-repro.json` records 48 failing assertions in both directions;
`prod-repro-for-centers.png` is the founder's blank hero band.
Direct load / hard reload of `/for-centers` is correct (10 reveal targets, 0
hidden). `prefers-reduced-motion: reduce` and JavaScript-disabled loads are
already fully visible on production, so the defect is isolated to the armed
client-side reveal state.

## Root cause

`components/SiteReveal.tsx` sets the document-global `data-reveal-ready`
attribute on `<html>`; `app/globals.css` hides every `[data-reveal]` element
until `.is-revealed` is added.

Each marketing page mounts its own `<SiteReveal />`. On `master` the effect is
keyed on `[]` and starts with:

```ts
if (root.hasAttribute("data-reveal-ready")) return;
```

After the landing page arms `<html>`, every later client-side navigation mounts
a new `SiteReveal` that returns immediately. The new page's server-rendered
`[data-reveal]` sections (the `section-head` hero and closing CTA) stay at
`opacity: 0`. The `data-reveal-stagger` cards stay visible because only the
driver adds `data-reveal` to those children.

## Current state of the branches

| Ref | KID-2458 fix | Behaviour |
| --- | --- | --- |
| `origin/master` (production) | missing | blank hero after nav (reproduced) |
| `origin/staging` | present (`d25555c`) | fixed |
| Vercel staging `kiddy-staging-orcin.vercel.app` | present | fixed (`staging-current.json`) |
| Cloudflare staging Worker `kiddy-web-staging…workers.dev` | **stale** | still serves pre-KID-2458 code: `/for-centers` HTML still carries `data-reveal` on the hero container |

The Cloudflare staging Worker was deployed before KID-2458 and has not been
refreshed since; it is not the founder-facing staging surface
(`docs/CLOUDFLARE_MIGRATION.md` keeps Vercel staging live until sign-off).

## What this branch adds

1. **`lib/marketing-reveal.ts`** — the reveal pass is now a plain function over
   `document`/`window` plus a small observer factory. Behaviour is unchanged;
   it is now testable without a browser.
2. **`components/SiteReveal.tsx`** — supplies the real DOM and keeps the effect
   keyed on `usePathname()` (KID-2458), with the early return permanently gone.
3. **`tests/unit/kid2476-site-reveal-rearm.test.ts`** — CI regression guard:
   a second pass must reveal/observe the new page's targets; in-viewport targets
   reveal synchronously; below-fold targets are observed and unobserved after
   reveal; delay is cleared after the reveal window; reduced motion and missing
   `IntersectionObserver` never arm; source guards pin `usePathname`/`[pathname]`
   and keep the four `section-head` heroes out of `[data-reveal]`.
4. **`scripts/verify-marketing-reveal-nav.mjs`** — reusable real-browser probe:
   both directions across all five pages, reduced-motion pass, no-JS pass.

## Verification

Local production build of this branch (`next build` + `next start`, exact tree):

| Check | Result |
| --- | --- |
| `scripts/verify-marketing-reveal-nav.mjs` forward + reverse | **pass** — 0 hidden in viewport, 0 hidden after scroll-through, hero opacity 1 on all pages |
| `prefers-reduced-motion: reduce` | **pass** — `data-reveal-ready` never set, 0 hidden targets |
| JavaScript disabled | **pass** — hero heading visible on all five pages, HTML never armed |
| Targeted suites (`kid2476`, `kid2072`, `kid240`, `kid2406`, `kid2407`) | 5 files / 63 tests passed |
| `tsc --noEmit` | exit 0 |
| `next lint` | 0 errors (pre-existing `no-img-element` warnings only) |
| `next build` | green |

Raw output: `branch-local-verify.json`. Captures:
`branch-local-for-centers.png` (forward),
`branch-local-reverse-for-centers.png` (reverse),
`branch-local-reduced-motion-home.png`, `branch-local-no-js-for-centers.png`.

The live Vercel staging surface was also probed before the refactor
(`staging-current.json`, `staging-current-for-centers.png`): 0 hidden,
confirming the KID-2458 behaviour this branch preserves.

## Production gate

`master` does not contain `d25555c`. Production requires a targeted cut
(cherry-pick `d25555c` + this branch's commit) after founder sign-off, followed
by an OpenNext build/deploy and a live re-run of the probe. No database,
route or DNS change is involved.
