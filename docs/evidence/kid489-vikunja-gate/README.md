# KID-496 (KID-489 item 7) — Superadmin-only Vikunja link + enhancements table header fix

Branch: `kid489-vikunja-gate` (PR to master). Issue KID-496, parent KID-489 enhancement batch item 7.

## What shipped

1. **Superadmin-only link gate** (`app/portal/enhancements/page.tsx`). The request
   table's Vikunja column — header "Vikunja" and cell link "Open in Vikunja" /
   "افتح في Vikunja" (`lib/platform` sentinel role AND operator-allowlist email,
   the exact double gate every `/platform` surface uses). Center owners
   (the page's primary audience), admins, staff, carers and parents never see a
   trace of the link surface — the column is omitted entirely, not blanked. The
   page stays fully usable for owners, and every daycare role is still refused
   exactly as before (owner gate unchanged). The platform operator reaches the
   page through the production "Enter as admin" operator-view path on the
   daycare's own subdomain (their sidebar has no Tools tab; this is a
   link-checking surface, not a clone of the owner view).
2. **Table header fix** (`app/globals.css` + the page). Header cells stop using
   `.label` — that class sets `display: block`, which stacked every `<th>`
   vertically inside the table row (the reported bug). A new `.table-label`
   class keeps the label's visual weight (13px / 600 / muted) with
   `text-align: start` and `white-space: nowrap`, so the header row renders on
   one line inline with its columns on desktop and stays readable on mobile
   (the table wrapper already scrolls horizontally). Other tables using
   `th.label` (account billing, platform invoices) are intentionally untouched —
   this ticket's scope is the enhancements page.
3. **Labels/docs** — the Vikunja naming was already shipped by KID-466
   ("Open in Vikunja" / "افتح في Vikunja" in `lib/i18n.ts`; no "Open in Linear"
   string remains anywhere). `docs/ENHANCEMENTS_REQUESTS.md` now documents the
   superadmin-only link gate.

## Tests

`tests/unit/kid489-vikunja-gate.test.tsx` (11 tests), riding the real host→tenant
rule with a seeded Sunshine subdomain and a request that carries a real Vikunja
task URL:

- Owner sees the list but never the "Vikunja" header, the task URL, or the
  "Open in Vikunja" link (any language).
- The platform superadmin (role + allowlist email) gets the link column with
  the stored task URL.
- The gate needs BOTH: a sentinel-role session with a non-allowlisted email is
  redirected to `/portal/dashboard`.
- Header cells use `.table-label`, never `<th class="label">`; the CSS rule
  keeps label styling without `display: block`.
- EN + AR label parity for "Open in Vikunja" / "افتح في Vikunja".
- Every daycare role (admin/staff/carer/parent) is still redirected.

Local commands (run on this branch before merge, all green):

- `npm test` — **83 test files / 893 tests, all passed** (includes the 11 new
  `kid489-vikunja-gate` tests; duration ~59 min wall clock on the shared runner).
- `npx tsc --noEmit` — clean.
- `npm run lint` — no errors (the pre-existing `app/portal/newsfeed/page.tsx`
  `<img>` warning is untouched by this branch).
- `npm run build` — production build succeeds.
- `npm run db:verify-migrations` — "All migration checks passed" (no schema
  change in this item).

## Screenshot evidence (local throwaway demo dataset)

Local `next start` on a seeded SQLite dataset (`PUBLIC_APEX_DOMAIN=kiddy.localhost`,
demo daycare at `sunshine.kiddy.localhost:3901`), screenshots taken at
1366×768 desktop and 390×844 mobile. The demo dataset's throwaway passwords are
never recorded here; no production data was touched.

| File | What it shows |
|---|---|
| `before-owner-desktop.png` | BEFORE (master): the bug — header labels stacked vertically under each other inside the table card, and "Open in Vikunja" visible to the daycare owner. |
| `after-owner-desktop.png` | AFTER: header row on one line inline with its columns; NO Vikunja column/link anywhere in the owner's page. |
| `after-owner-mobile.png` | AFTER at 390×844: header row still on one line, table usable. |
| `after-super-desktop.png` | AFTER as the platform superadmin: same clean header plus the "Vikunja" column with the "Open in Vikunja" link to the task. |

## Merge/deployment

- PR to master; merge after local checks pass. Master auto-deploys on Vercel.
- Merge commit + deployment evidence recorded in `DEPLOY-README.md` after merge.
