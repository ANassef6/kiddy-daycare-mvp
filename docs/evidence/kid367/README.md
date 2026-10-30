# KID-367 / DEF-006 — child-detail tap inside the stalled-prefetch window

Live A/B verification of the fix (branch kid367-def006-prefetch-tap) against
the KID-257 audit's DEF-006 protocol: load /child, tap a child card while the
/child/[id] prefetch request is still in flight, and record when the URL
changes and when the aria-busy skeleton (KID-254 loading boundary) appears.

## Setup

- `next build` + `next start` on the production build of both revisions:
  baseline = aa91dbf (origin/master, pre-fix), fix = this branch
  (components/ChildCard.tsx with `prefetch={false}` on the card link).
- A local stall proxy (`stall-proxy.js`, listed in `tap-check.mjs`'s header /
  repo-external harness) holds any request carrying the
  `Next-Router-Prefetch: 1` header for /child/<id> for 8 s, emulating the
  audit's stalled detail prefetch; navigation requests (no prefetch header)
  pass through instantly, exactly like the audit run `after_stalledPrefetch`.
- Chromium 320×800 (Android-ish), same parent session as the audit
  (parent@example.test on sunshine-daycare.<apex>, seeded SQLite DB).
- `node kid367-tap-check.mjs label=prefix|postfix` drives: login → /child →
  tap the first card at ~150 ms (inside the in-flight prefetch window on the
  baseline) → sample URL / `div[aria-busy="true"]` visibility at
  200/400/600/1s/…/16s → a second tap after the prefetch settled for the
  warm path.

## Results

| metric (ms after tap) | pre-fix aa91dbf | post-fix (this branch) | acceptance |
| --- | --- | --- | --- |
| detail prefetches in flight before tap | 4 | 0 | window eliminated |
| URL changed | 8504 (prefetch settle) | 209 | ≤500 ✓ |
| aria-busy skeleton visible | never (silent until data) | 209 | ≤500 ✓ |
| detail content rendered | 8504 | 403 | then loads ✓ |
| warm path: URL / skeleton / content | quiet network run: 104 / — / 111 (prefetch reuse) | 104 / 104 / 349 | not regressed ✓ |

- `prefix-tap-silent-207ms.png` — 207 ms after the tap: still on /child,
  URL unchanged, no skeleton (the parent-visible "tap does nothing").
- `postfix-skeleton-209ms.png` — 209 ms after the tap: URL committed to
  /child/[id] and the KID-254 aria-busy skeleton renders while the detail
  data streams in.
- `kid367-timeline-prefix.json` / `kid367-timeline-postfix.json` — raw
  request/sample traces for both runs.

The baseline numbers match the audit's measured 7.4 s silent window (the
prefetch was held 8 s here); the fix removes the in-flight window entirely,
so there is nothing for the tap to join, and every tap commits a fresh
navigation.
