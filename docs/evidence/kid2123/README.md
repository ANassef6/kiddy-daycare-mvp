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
| 10. Preview first; board approval before production master | ⏳ this document + preview deployment; rollback reference unchanged: `dpl_3iQycMmc4jCPbfyMgWZgVXF13Q4w` @ `ac81542` |

## Notes / known deviations

- Un-hover settle after a revealed card's lift animates at the 450ms reveal duration instead of the
  pre-fix 180ms (the hover-in stays 180ms). Consequence of keeping the reveal transition on the
  revealed state so the reveal itself plays at 450ms on card targets; not covered by any criterion and
  visually a gentle settle.
- Hover lift now requires a JS-capable visit **only** through the `:is(..., :root)` design — `:root`
  keeps it working without JS as before; behavior change is nil.
- Hover verified headlessly with a hover-capable context (`(hover:hover)=true` in this Playwright
  config, matching a real mouse); per plan, re-confirm with a real mouse on the preview if desired.
