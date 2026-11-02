# KID-453 evidence — RTL portal shell grid fix

Run stamp: 2026-11-02, branch `kid453-rtl-shell-grid` off `origin/master`
(`4b96fab`), merged as PR #7 → `master` @ `04a1cbb`, Vercel production deploy
completed. Geometry measured with `getBoundingClientRect` + `getComputedStyle`
in headless Chromium at DPR 1; screenshots are viewport-only.

Two passes: a **local** one (`next build` + `next start` on `127.0.0.1:4560`,
SQLite demo seed) and a **production** one against https://sunshine.kiddyapp.net
after the deploy (`KID-453-production-report.json`). A branch-preview pass was
not possible: Vercel deployment protection redirects `*.vercel.app` previews to
team SSO, so verification went straight to production.

## The fix

`app/globals.css` — the KID-57 rule

```css
html[dir="rtl"] .shell { grid-template-columns: 1fr 220px; }
```

is deleted (replaced by a comment explaining why no RTL override belongs
there). CSS Grid puts track 1 on the right under `dir="rtl"` and the first grid
child is `aside.shell-side`, so the base `.shell { grid-template-columns: 220px 1fr }`
already places the 220px sidebar on the right. The deleted rule also
out-specified `@media (max-width: 720px) { .shell { grid-template-columns: 1fr } }`,
so RTL phone widths kept a sidebar track too — both defects go with it.

## Checks — `kid453-verify.mjs` (report: `KID-453-local-report.json`) 8/8 pass

| # | Check | Result |
| --- | --- | --- |
| A1 | staff/owner sign-in lands in the portal | pass (`/portal/dashboard`) |
| A2 | Account → App language → العربية flips `html[dir]` to `rtl` | pass |
| A3 | RTL @1080x1920 `/portal/children`: aside x=860 w=220 (right), main x=0 w=860, `scrollWidth == clientWidth == 1080`, computed grid `220px 860px` | pass |
| A4 | RTL @1080x1920 `/portal/support`: same geometry, no overflow | pass |
| A5 | RTL @700x1200: single track `700px`, aside stacked above main, both full width, `scrollWidth == 700` | pass |
| A6 | LTR @1080x1920 `/portal/children`: aside x=0 w=220 (left), main x=220 w=860, `scrollWidth == 1080` | pass |
| A7 | LTR @1080x1920 `/portal/support`: same geometry | pass |
| Z1 | console errors during the whole pass | pass (none) |

Raw per-check payloads are in `KID-453-local-report.json`.

## Negative control — `kid453-negative-control.mjs` (report: `KID-453-negative-control-report.json`) 4/4 pass

The harness must fail when the defect is present, otherwise the pass above is
vacuous. The deleted rule is re-injected into the fixed build at runtime
(`page.addStyleTag`), no rebuild:

| # | Check | Result |
| --- | --- | --- |
| N1 | old override reproduces the bug report exactly: aside x=220 w=860, main x=0 w=220, `scrollWidth 1144` @1080 | pass |
| N2a | injected stylesheet is parsed and carries the rule (explicit wait, no sleeps) | pass |
| N2 | LTR geometry identical with and without the pre-fix rule | pass |
| N3 | LTR PNG bytes identical fixed vs pre-fix (`56370 == 56370`) | pass — literal pixel-identity for the LTR acceptance criterion |

## Production pass — `kid453-verify.mjs` against https://sunshine.kiddyapp.net (report: `KID-453-production-report.json`) 8/8 pass

Same script, same checks, signed in with the sanctioned QA staff fixture
(`qa_kid186_staff_sunshine_login`) on the live host after the deploy:

- A3/A4 RTL @1080x1920 — aside x=860 w=220, main x=0 w=860,
  `scrollWidth == clientWidth == 1080`, computed grid `220px 860px`;
- A5 RTL @700x1200 — single `700px` track, stacked, no overflow;
- A6/A7 LTR @1080x1920 — aside x=0 w=220, main x=220 w=860, unchanged;
- Z1 console errors — none.

## Regression test (in the suite)

`tests/unit/kid453-rtl-shell-grid.test.ts` — 5 tests, resolves the cascade the
browser would apply to `<div class="shell">` (media queries, specificity, source
order) out of `app/globals.css` for both directions at 1080 and 720:

- desktop both directions → `220px 1fr`, RTL won by the base `.shell` rule;
- ≤720px both directions → `1fr` won by the media rule;
- no `dir=rtl` selector anywhere declares `grid-template-columns`;
- LTR and RTL resolve to the same declaration at 720/721/820/1080/1920.

Verified to fail (5/5) when the old override is restored, pass (5/5) with it
deleted.

## Suite / gates

- `vitest run`: **62 files / 646 tests green** (includes the 5 new ones).
- `tsc --noEmit`: clean. `next lint`: clean (pre-existing `<img>` warnings only).
- `next build`: compiled successfully.

## Screenshots

| File | Size | Shows |
| --- | --- | --- |
| `KID-453-01-rtl-children-1080.png` | 1080x1920 | fixed RTL portal — sidebar right, main left |
| `KID-453-02-rtl-support-1080.png` | 1080x1920 | fixed RTL support page |
| `KID-453-03-rtl-children-700.png` | 700x1200 | RTL single-column at ≤720px |
| `KID-453-04-ltr-children-1080.png` | 1080x1920 | LTR unchanged |
| `KID-453-05-ltr-support-1080.png` | 1080x1920 | LTR unchanged |
| `KID-453-06-old-override-bug.png` | 1080x1920 | negative control: pre-fix cascade, the reported inversion |
| `KID-453-07-prod-rtl-children-1080.png` | 1080x1920 | production after deploy — fixed RTL child list (also the source of KID-451's `KID-451-05` replacement) |
| `KID-453-08-prod-rtl-children-700.png` | 700x1200 | production after deploy — RTL single column at ≤720px |

PNG dimensions verified from the IHDR chunk (ImageMagick is not installed).

## KID-451 follow-through

The two AR shots were re-captured on production and attached to KID-451 as
`KID-451-05-child-list-ar.png` and `KID-451-06-support-chat-ar.png`
(1080x1920, `PASS`); KID-451's `screenshots-manifest` document gained a
"Replacements after KID-453" section and marks GAP-1 RESOLVED. GAP-2 (English
body copy on `/portal/children`) is unchanged and still open.

## Known gap carried over (NOT this issue)

`/portal/children` body copy stays English under an Arabic shell (KID-451
GAP-2) — the shell/sidebar/nav are Arabic, the page body is not. Unchanged by
this fix.

## Reproduce

```bash
LD_LIBRARY_PATH=/tmp/kid239/pw/libs/usr/lib/x86_64-linux-gnu \
BASE_URL=http://127.0.0.1:4560 CRED_FILE=<run-local json {email,password}> \
OUT=docs/evidence/kid453 PREFIX=KID-453 \
node docs/evidence/kid453/kid453-verify.mjs
```

Credentials are read from a run-local file and never appear in this source, the
reports, or the screenshots.
