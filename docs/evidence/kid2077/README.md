# KID-2077 — landing page motion: scroll-reveal, card hover lift, button press

Commit: `ea914ae` (based on `master` @ `c5e73c8`, which already carries the KID-1960 contrast fixes)
Preview (NOT production): https://kiddy-lcsfl3vmc-kiddy2.vercel.app — deployment `dpl_12Yi6Ltk38jLHriASc4NPim43P5b`, `readyState READY`, `target: preview`, built by the Vercel CLI from a clean checkout of commit `ea914ae` (a `git worktree`, so KID-2072's uncommitted switcher changes in the shared worktree were deliberately NOT shipped).
Inspector: https://vercel.com/kiddy2/kiddy/12Yi6Ltk38jLHriASc4NPim43P5b

## Temporary Vercel Authentication bypass (revoke after board review)

Deployment protection (`vercel_authentication`) blocks anonymous access. A temporary **Protection Bypass for Automation** secret was created for this review (note: "KID-2077 preview review - temporary", created 2026-11-12):

- Pass it as an HTTP header: `x-vercel-protection-bypass: JZj0mVVLE57ttvxbD3CP0nyxoXn22rKr` (recommended), or as a query parameter `?x-vercel-protection-bypass=…` for tools that cannot set headers.
- Verified: `200` with the header / `302` Vercel SSO redirect without it.
- **Revoke after review:** project Settings → Deployment Protection → Protection Bypass for Automation → delete the "KID-2077 preview review - temporary" secret (API: `PATCH /v1/projects/prj_LmRn4uWkd9XY4ykXey9SCXG2442M/protection-bypass` with `{"revoke":{"secret":"JZj0mVVLE57ttvxbD3CP0nyxoXn22rKr","regenerate":false}}`).

## What shipped

1. **Scroll-reveal per section** — `components/SiteReveal.tsx` (one small client component, no dependency). After hydration it arms a `data-reveal-ready` state on `<html>`, synchronously pre-reveals anything already in viewport (same style recalc — no flash, no CLS), and reveals every `[data-reveal]` element once on first viewport entry via `IntersectionObserver` (`threshold 0.1`, `rootMargin -8%` bottom, unobserved after reveal → no re-trigger on scroll-up). `data-reveal-stagger` groups cascade their direct children (60 ms steps capped at 240 ms, cleared after reveal so later hover/press transitions are never delayed). The hero carries no `data-reveal` — it keeps its KID-1826 load animation and is never re-revealed. Server HTML is always fully visible, so no-JS visitors, crawlers and reduced-motion users never see a blank section.
2. **Card hover lift** — `translateY(-3px)` + stronger shadow at 180 ms on the marketing-only panels (`.feature-card`, `.audience-panel`, `.day-panel`, `.cta-card`, `.cta-band`, `.contact-card`, `.contact-side` — verified absent from portal/child/auth/platform surfaces, where plain `.card` must stay still). Gated behind `@media (hover: hover)` + `prefers-reduced-motion: no-preference`; mirrored for `:focus-visible`. The hero day panel's load animation moved from fill `both` to `backwards` (final keyframe == base style, render identical) so the finished animation no longer overrides `transform` and the lift can play.
3. **Button press feedback** — every `.btn` variant gets `:active` `scale(0.97)` + shadow drop at 90 ms, no layout shift, no text reflow; placed after the `.btn-deep` block so the deep variant's background transition carries forward.
4. **Shared tokens** — `:root` `--motion-press: 90ms`, `--motion-lift: 180ms`, `--motion-reveal: 450ms`, `--ease-out-soft`.
5. **RTL/reduced-motion safety** — all movement is vertical (fade + 10 px rise), so EN/AR are identical and no horizontal overflow is possible; under `prefers-reduced-motion: reduce` the driver returns early (state never armed), plus a CSS safety net forces every section to `opacity: 1`.

Diff scope: `app/globals.css`, `components/SiteReveal.tsx` (new), and the five public marketing pages (`/`, `/features`, `/for-parents`, `/for-centers`, `/contact`). No dependency added; no portal/app surface touched.

## Verification (60 browser combos on the preview)

Real Chromium (Playwright 1.49 driving Chrome for Testing 151), 5 pages × 2 locales (EN, AR via `kiddy_lang=ar`) × 4 widths (360/768/1280/1440) + a reduced-motion emulation pass. Raw data: `motion-report.json`; full-page captures: `screenshots/` (40 PNGs); scroll-through recordings of the landing reveal: `videos/reveal-home-{en,ar}-1280.webm`.

| Check | Result |
|---|---|
| Every `[data-reveal]` section revealed after one scroll pass | ✅ all (16 targets on `/`, per-page counts in report) |
| Nothing left hidden (`opacity < 1`) after the pass | ✅ 0 |
| Re-trigger on scroll-up | ✅ none — all targets stay `.is-revealed` |
| Hero re-revealed | ✅ never — 0 reveal targets inside `.hero` on all 8 probed home combos |
| Stagger `transition-delay` cleared after reveal | ✅ (so hover/press transitions are never delayed) |
| Hover lift (computed `transform` changes + shadow appears) | ✅ every probed card/page |
| Button press (`:active` transform changes) | ✅ every page |
| Horizontal overflow (EN + AR, 360–1440) | ✅ none |
| CLS (buffered `layout-shift`, hero + reveals + header) | ✅ **0.0000** on all 60 combos |
| `prefers-reduced-motion: reduce` | ✅ state never armed, every section immediately visible, `transition-duration 0s` everywhere |
| Console errors | one pre-existing favicon 404 (no favicon route; production behaves identically) |
| Non-2xx app responses | none |

Screenshot note: full-page captures pin `.site-header` to `position: static` for the capture only (Chromium paints `position: sticky` elements at the scroll offset current when a stitched capture starts, which drops the header mid-page or overlays the hero). The shipped CSS keeps the sticky header unchanged.

## Gates

- `tsc --noEmit` clean
- `next lint`: 0 errors (pre-existing `<img>` warnings only)
- `next build` green
- Unit suites: kid240-landing-links, kid368-def004-ar-i18n, kid489-branding, kid230-platform-open-links, kid2072-site-language-switch — 54 tests green

## Coordination

The shared worktree holds KID-2072's uncommitted `nextPath` switcher changes in the same five page files. Commit `ea914ae` was staged around them (index built from HEAD + only KID-2077 hunks; verified the residual unstaged diff contains exactly the KID-2072 lines), and the preview was deployed from a clean worktree of the commit — neither change includes or clobbers the other.

## Production gate

**No direct production deploy.** Production cut only after board approval of this preview. Rollback references: current production `dpl_D4MEdrFVX2ZoDzZMxfDVhvPHtQkC` @ `c5e73c8`; prior `dpl_FcMZdoFG6wRv2fByZ1umH7Q4fwUx` @ `051aaf4`.

**Deploy mechanics:** this project's Vercel production deploys are driven by GitHub pushes to `master` (deployment `dpl_D4MEdrFVX2ZoDzZMxfDVhvPHtQkC` carries `githubDeployment: 1`, `githubCommitRef: master`). The three KID-2077 commits (`ea914ae`, `5a4572f`, `014d5b6`) are therefore committed locally only — the branch is ahead of `origin/master` by 3 and MUST NOT be pushed until the board approves. The approved production cut is then just `git push origin master` (plus the bypass revocation above).
