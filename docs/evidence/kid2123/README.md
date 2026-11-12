# KID-2123 — scroll-reveal no-op fixed: CSS retargeted to the `data-reveal-ready` attribute

Defect: KID-2077 shipped with the scroll-reveal half inert. `SiteReveal.tsx` arms the hidden state by
setting the **attribute** `data-reveal-ready` on `<html>`, but the deployed CSS gated the hidden/reveal
states on a **class** `.reveal-ready` that nothing ever adds — so reveal targets were never hidden,
`is-revealed` changed nothing, and computed `transition-duration` on targets was `0s`. Hover lift and
button press were unaffected (verified independently on production 2026-11-12).

## Root cause

Selector-contract mismatch, introduced when KID-2077's CSS was written against a class the component
never sets (plan: "CSS class vs data attribute mismatch"). Not a design change.

## Fix (minimal, CSS-only — `app/globals.css`)

1. **Reveal rules retargeted to the attribute the component already sets**
   (recommended option from the plan; the alternative — adding a `reveal-ready` class in
   `SiteReveal.tsx` — was not used, per "do not do both"):
   - `.reveal-ready [data-reveal]` → `[data-reveal-ready] [data-reveal]`
   - `.reveal-ready [data-reveal].is-revealed` → `[data-reveal-ready] [data-reveal].is-revealed`
   - reduced-motion safety net → `[data-reveal-ready] [data-reveal]` (inside the existing
     `@media (prefers-reduced-motion: reduce)` block, `!important` kept)
2. **Revealed rule now carries the reveal transition.** Once the contract actually matched, a latent
   specificity problem surfaced: the revealed-state rule (0,3,0) outranks the lift cards' own base
   transition (0,1,0), so at the reveal moment card targets would inherit the 180ms lift transition
   (no opacity transition → snap). Keeping `transition: opacity/transform var(--motion-reveal)` on the
   revealed rule (0,3,0) makes every target play the reveal at `--motion-reveal` (450ms).
3. **Hover/keyboard lift re-armed with `:is([data-reveal-ready], :root)` prefix.** The same working
   contract would have permanently pinned revealed cards at `transform: none` (0,3,0 beating
   `.audience-panel:hover` at 0,2,0) — killing the KID-2077 hover lift and `:focus-visible` lift on
   every revealed card. The prefix raises those rules to (0,3,0); being later in the file they win the
   tie, and `:root` inside `:is()` keeps the lift working for no-JS visitors where the attribute is
   never set. The `:hover` rule also carries the 180ms transition explicitly (the revealed rule's
   450ms transition would otherwise govern the hover-in); the un-hover settle falls back to the
   slower reveal transition — a gentle settle, accepted. The lift **base** transition block stays
   unprefixed and low-specificity so it never beats the armed hidden rule.

No component changes; server HTML stays fully visible before JS (arming still happens only after
hydration, only with `IntersectionObserver` available and reduced motion off).

## Verification (local production build `next build` + `next start`, Playwright Chromium)

Probe scripts: `kid2123-probe.js` (reveal contract), `kid2123-probe2.js` (overflow/CLS/hero/interactions),
`kid2123-pages.js` (all-pages scroll-through). Raw outputs:
`computed-style-probe.json`, `overflow-cls-interactions.json`.

| Criterion | Result |
| --- | --- |
| 1. Below-fold `[data-reveal]` hidden with computed `opacity: 0` + `transition-duration` = `--motion-reveal` pre-viewport | ✅ 10/16 landing targets below fold at 1366×900: `opacity: 0` (two mid-animation `~1.7e-05` from the probe's own scroll timing), `transform: matrix(1,0,0,1,0,10)`, `transition-duration: 0.45s, 0.45s` = `--motion-reveal` on **all** pre-reveal targets (uniform `0.45s, 0.45s` set — the specificity fix keeps card targets on the reveal duration, not the 180ms lift) |
| 2. Scroll-in reveals to `opacity: 1` once; no re-hide on scroll-up | ✅ scroll back to top: 16/16 at `opacity: 1`, observer unobserves after reveal |
| 3. All 16 landing targets end at `opacity: 1`, zero stuck hidden | ✅ 16/16 after one top-to-bottom pass (`stillHidden: 0`); `/features` 14/14, `/for-parents` 8/8, `/for-centers` 10/10, `/contact` 3/3 |
| 4. Hero not re-hidden/re-animated | ✅ hero carries no `data-reveal`; `h1` computed `opacity: 1` at load on every width |
| 5. `prefers-reduced-motion: reduce` | ✅ `data-reveal-ready` never set (component returns early), all targets `opacity: 1`, zero transitions (`anyTransition: false`), `!important` safety net also present if armed mid-session |
| 6. CLS 0; no horizontal overflow EN+AR at 360/768/1280/1440 | ✅ `layout-shift` total 0.0000 and `scrollWidth - clientWidth = 0` in all 8 combinations (AR via `kiddy_site_lang=ar`, RTL unaffected — movement is vertical only) |
| 7. Hover lift with `(hover:hover)=true`; press scale 0.97 | ✅ hover on a **revealed** `.audience-panel`: `transform: matrix(1,0,0,1,0,-3)` (= `translateY(-3px)`) at `transition: 0.18s` = `--motion-lift`; `.btn` pressed via real mouse event: `matrix(0.97, 0, 0, 0.97, 0, 0)` + shadow removed |
| 8. Evidence shows computed opacity/transition-duration before/after on 3+ sections | ✅ `computed-style-probe.json` records per-element computed `opacity`, `transitionDuration`, `transform`, `is-revealed` for all 16 landing targets before scroll, after scroll, and after scroll-back-to-top (three feature-row / heading / paragraph sections shown hidden → revealed) |
| 9. `tsc` clean, lint 0 errors, build green, tests pass | ✅ `tsc --noEmit` exit 0; `next lint` 0 errors (only pre-existing `<img>` warnings); `next build` ✓ (CSS `76c041f22639740b.css` contains the three `[data-reveal-ready]` rules, zero dead `.reveal-ready` selectors); vitest **109 files / 1209 tests passed** |
| 10. Preview first; board approval before production master | ✅ preview verified below; board approval `ad153cb0-611c-4285-890a-321b88f8bc7a` **approved** by user `lyE62Zgr6bR5WJmxlgQNzJmI3uSGkAVJ` at 2026-11-12T15:59:11Z; cut executed (below). Rollback reference: `dpl_3iQycMmc4jCPbfyMgWZgVXF13Q4w` @ `ac81542` |

## Preview (NOT production)

- URL: https://kiddy-nm8uxikhr-kiddy2.vercel.app — deployment `dpl_HMaJkQRjucdQNYVAzsbzNgtjmSA9`,
  `readyState READY`, `target: preview`, deployed with the Vercel CLI from a clean
  `git worktree` checkout of commit `9cbde05` (linked to the existing project
  `prj_LmRn4uWkd9XY4ykXey9SCXG2442M`, so it carries the project's env config; KID-2072's stacked
  commits were not included — the worktree checked out only this commit's tree).
- Deployment protection: anonymous GET → `302` SSO redirect; with the standing review bypass
  `x-vercel-protection-bypass: hMkfx9…` (owned by KID-2072's gate) → `200`. Review access untouched;
  nothing revoked.
- Served CSS `/_next/static/css/76c041f22639740b.css` contains the three `[data-reveal-ready]` rules
  and zero dead `.reveal-ready` class selectors.
- Full probe suite re-run **against the preview** with identical results: armed on load, 10/16
  pre-reveal hidden at `opacity: 0` + `translateY(10px)` + `transition-duration 0.45s` uniformly,
  16/16 revealed after one scroll pass with no re-hide on scroll-up, reduced-motion never arms and
  shows everything with zero transitions, hover lift on a revealed card `matrix(1,0,0,1,0,-3)` at
  0.18s, button press `matrix(0.97,0,0,0.97,0,0)`, CLS 0.0000 and zero horizontal overflow in EN+AR
  at 360/768/1280/1440, and all six public pages end with `stillHidden: 0`
  (`preview-pages.json`, `preview-probe.json`, `preview-probe2.json`).
- Screenshots: `screenshots/preview-landing-top.png` (hero at load) and
  `screenshots/preview-landing-revealed.png` (audience panels + CTA band fully revealed mid-page).

## Production cut (board-approved 2026-11-12)

- Gate: board approval `ad153cb0-611c-4285-890a-321b88f8bc7a` (request_board_approval for the KID-2123
  cut) **approved** 2026-11-12T15:59:11Z. The approved payload stated the cut = push `9cbde05` +
  `7fa6762`, `app/globals.css` + evidence docs only, no other code changes ride along.
- Push: `git push origin master` → `28d4d7f..7fa6762` (fast-forward; the pushed delta verified as
  exactly the two approved commits, diff = `app/globals.css` + `docs/evidence/kid2123/*` only).
- Production deployment: `dpl_8uH8hmiP8W3jhFZitKcNovwjDW7N` (`kiddy-kagre34en-kiddy2.vercel.app`),
  `target: production`, built by Vercel from the master push @ `7fa6762`, QUEUED → READY at
  ~16:03 UTC. Serves `kiddyapp.net`, `*.kiddyapp.net`, `kiddy-one.vercel.app`.
  Rollback remains: `dpl_3iQycMmc4jCPbfyMgWZgVXF13Q4w` @ `ac81542`.
- Post-cut smoke (fresh responses, browser UA): `/`, `/features`, `/for-parents`, `/for-centers`,
  `/contact`, `sunshine.kiddyapp.net/` all **200**. Served CSS is the new build
  `/_next/static/css/76c041f22639740b.css` — same hash the preview served: carries the three
  `[data-reveal-ready]` rules (armed hidden / revealed + transition / reduced-motion `!important`)
  and the `:is([data-reveal-ready],:root)`-prefixed hover-lift rules, with **zero** dead
  `.reveal-ready` selectors.
- **Post-cut QA on live `kiddyapp.net`** (full probe suite re-run against production, raw outputs
  `prod-probe.json` / `prod-pages.json` / `prod-probe2.json`):
  - armed on load (`data-reveal-ready` set, `reveal-ready` class count 0);
  - 10/16 landing targets below fold pre-scroll at `opacity: 0`, `transform:
    matrix(1,0,0,1,0,10)` (translateY 10px), `transition-duration 0.45s, 0.45s` uniformly; the 6
    in-viewport targets revealed at `opacity: 1`;
  - after one scroll pass 16/16 at `opacity: 1`; scroll back to top → 0 hidden (no re-hide);
  - all six public pages `stillHidden: 0` (`/` 16, `/features` 14, `/for-parents` 8, `/for-centers`
    10, `/contact` 3, `/privacy` 0);
  - reduced motion: never arms, all visible, zero transitions; `/for-centers` armed with 10/10
    targets revealed, 0 hidden;
  - hero untouched at every width (`heroRevealTags: 0`, h1 `opacity: 1`); CLS 0.0000 and zero
    horizontal overflow EN+AR at 360/768/1280/1440;
  - hover-capable context: revealed `.audience-panel` hover `none` → `matrix(1,0,0,1,0,-3)` at
    `--motion-lift`; `.btn` press `matrix(0.97,0,0,0.97,0,0)`.
  Identical to the preview verification. tsc/lint/build/tests were run pre-push on this exact tree
  (green; see criterion 9) — the push contained no code beyond the verified `globals.css` change.

## Notes / known deviations

- Un-hover settle after a revealed card's lift animates at the 450ms reveal duration instead of the
  pre-fix 180ms (the hover-in stays 180ms). Consequence of keeping the reveal transition on the
  revealed state so the reveal itself plays at 450ms on card targets; not covered by any criterion and
  visually a gentle settle.
- Hover lift now requires a JS-capable visit **only** through the `:is(..., :root)` design — `:root`
  keeps it working without JS as before; behavior change is nil.
- Hover verified headlessly with a hover-capable context (`(hover:hover)=true` in this Playwright
  config, matching a real mouse); per plan, re-confirm with a real mouse on the preview if desired.
