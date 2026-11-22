# KID-2458 — blank hero band on public marketing pages after client-side navigation

## Symptom

Clicking a nav link from the landing page to any other public marketing page
left the hero (and the closing CTA band) invisible: a ~250px empty light band
between the nav and the feature cards. A direct load or refresh of the same URL
rendered correctly.

## Root cause

`components/SiteReveal.tsx` sets the document-global `data-reveal-ready`
attribute on `<html>`; `app/globals.css` hides every `[data-reveal]` element
until `.is-revealed` is added.

Each marketing page mounts its own `<SiteReveal />`, but the effect started
with:

```ts
if (root.hasAttribute("data-reveal-ready")) return;
```

After the landing page arms `<html>`, every subsequent client-side navigation
mounts a new `SiteReveal` that returns immediately. The new page's
server-rendered `[data-reveal]` sections (the `section-head` hero and the
closing CTA band) stay at `opacity: 0`. The `data-reveal-stagger` feature cards
stay visible because only the driver adds `data-reveal` to those children, so
they never had the hidden attribute. The landing page looked fine because its
hero is intentionally not tagged `data-reveal`.

## Triage: pre-existing, not a KID-2452/Worker regression

- Production Worker (`https://kiddyapp.net/`): landing → **For centers** shows
  the blank band (`before-prod-for-centers-client-nav.png`).
- Vercel-hosted build (`https://kiddy-one.vercel.app/`, same CSS hash
  `bc17054c23b5c37b.css`, `server: Vercel`): the same flow produces a
  **byte-identical** screenshot (`before-vercel-for-centers-client-nav.png`,
  same sha256 as the production capture).
- Direct load/refresh of `/for-centers` is correct on both hosts.

The bug is in request-independent client code, so it is not specific to
workerd/OpenNext.

## Fix

1. `components/SiteReveal.tsx`
   - Removed the early return when `<html>` is already armed; arming is
     idempotent.
   - The effect now depends on `usePathname()`, so each client-side navigation
     reveals or observes the new page's targets instead of leaving them hidden.
2. `app/{features,for-parents,for-centers,contact}/page.tsx`
   - Removed `data-reveal` from the above-the-fold `section-head` hero. The
     hero is now visible in the server HTML and never depends on client JS,
     matching the plan's "render server-side where possible" direction.
   - Below-the-fold reveal sections (cards, CTA bands) keep their animation.

Landing (`app/page.tsx`) is untouched.

## Verification

Local (worktree off `origin/staging` @ `8120917`):

- `npx tsc --noEmit` — exit 0.
- `npm run lint` — 0 errors (pre-existing `<img>` warnings only).
- `npx opennextjs-cloudflare build` — green.
- `npx vitest run` on the marketing-relevant suites
  (`kid2072-site-language-switch`, `kid240-landing-links`, `kid2406-nav-perf`,
  `kid2407-contact-notify-split`) — 57/57 passed.

Staging Worker (`https://kiddy-web-staging.trois4ever.workers.dev`, deployed
from this branch via `opennextjs-cloudflare deploy --env staging`):

| Flow (start at `/`, click nav link) | Result | Screenshot |
| --- | --- | --- |
| → For centers (EN) | Hero + closing CTA visible | `after-staging-for-centers-client-nav.png` |
| → Features (EN) | Hero + CTA card visible | `after-staging-features-client-nav.png` |
| → For parents (EN) | Hero + closing section visible | `after-staging-for-parents-client-nav.png` |
| → Book a demo / contact (EN) | Hero + form visible | `after-staging-contact-client-nav.png` |
| `/?lang=ar` → للحضانات (AR, RTL) | Arabic hero visible, RTL layout intact | `after-staging-for-centers-ar-client-nav.png` |

All captures via Skyvern (real Chromium). No new console errors on staging
(only the pre-existing `favicon.ico` 404). The change is vertical/opacity only
and does not touch layout, contrast tokens, or horizontal geometry.

## Production

Not deployed by this task. Production still serves the Cloudflare Worker;
the cut requires coordination with Mika per the plan.
