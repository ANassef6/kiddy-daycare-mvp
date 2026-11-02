# KID-427 — "Open the support inbox" button removed from Help & Support

Run stamp: 2026-11-01T04:41Z, commit `0095020e7a7aa3cfdaff69691150324929ed92fa` (branch `kid427-no-support-inbox-button`, PR #3), deployment `dpl_6Ehkamtx4MZMFRVKQKymnJToYJQy` — target `production`, status `● Ready`, aliased to `https://kiddyapp.net` (+ wildcard `*.kiddyapp.net`).

## What changed

- `app/portal/support/page.tsx`: the `<p><Link href="/portal/support-inbox">{tr(dict, "help.inboxLink")}</Link></p>` block under the HelpCenter island is gone, together with its now-unused `next/link` import. The page comment updated.
- `lib/i18n.ts`: `help.inboxLink` key dropped from both dictionaries (EN "Open the support inbox" / AR "فتح صندوق طلبات الدعم").
- Nothing else touched: the HelpCenter no-result "Contact support" link (staff), the family on-page support request form, `/portal/support-inbox` itself, and the KID-403 EN/AR help-language chrome control are all unchanged.

## Tests

- `tests/unit/kid427-support-inbox-button-removed.test.tsx` (new): 6 tests — no inbox button/href on both surfaces under EN and AR help language, `help.inboxLink` absent from both dicts, kept staff article contact exit still points at the inbox.
- `tests/unit/kid403-help-chrome-language.test.tsx`: the two `help.inboxLink` presence assertions inverted to pin the removal.

## Gates

- `npx vitest run`: 56 files / 612 tests, all green (one first-run flake: a 10s `beforeEach` hook timeout in `parent-account-enhancements.test.ts` on `KID-142` seeding, unrelated to this change — the file passes 14/14 on re-run).
- `npx tsc --noEmit`: clean.
- `npx next lint`: clean of errors (pre-existing `<img>` warnings only).
- `npx next build`: success.

## Production evidence

Playwright (headless chromium) against the live production hosts, owner (staff) login and parent login:

| Check | Portal staff `/portal/support` | Family `/child/support` |
|---|---|---|
| "Open the support inbox" text | absent | absent |
| AR label "فتح صندوق طلبات الدعم" | absent | absent |
| `href="/portal/support-inbox"` | absent | absent |
| KID-403 EN/AR toggle → `?lang=ar` shows `مركز المساعدة` | yes | yes |

Screenshots (in this folder):

- `portal-staff-1-help-support.png` — staff Help & Support after removal (EN)
- `portal-staff-2-after-ar-toggle.png` — staff page, Arabic chrome still working (KID-403 intact)
- `family-parent-1-help-support.png` — family Help & Support (EN, request form intact)
- `family-parent-2-after-ar-toggle.png` — family page, Arabic chrome still working
- `evidence-curl.txt` — raw Playwright check transcript

Deploy was promoted via `vercel deploy --prod` from commit `0095020e7a7aa3cfdaff69691150324929ed92fa` (CLI pattern, as in KID-239) — status `● Ready`, aliased to `https://kiddyapp.net` (all tenant subdomains inherit via the wildcard `*.kiddyapp.net`).
