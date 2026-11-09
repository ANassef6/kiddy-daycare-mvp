# KID-850 — Contract drafts: strip the markdown wrapper before rendering

Fixes KID-747 defect D1. The KID-744 pack documents ship as markdown (heading,
prose, one ```html fence); KID-746 embedded the WHOLE document in
`lib/contract-templates.ts`, so every generated draft rendered ~600 characters
of wrapper above the contract. The legal text itself was never wrong — only
the envelope around it was.

## Fix

- `lib/contract-templates.ts`: `extractContractTemplateHtml(document, label)`
  lifts the exactly-one ```html block out of each pack document at module
  load. It **throws** (breaking the import) when a document has 0 fences,
  more than one fence, an unclosed fence, or an empty block — it can never
  silently store a broken draft. `CONTRACT_TEMPLATE_EN` / `CONTRACT_TEMPLATE_AR`
  now export the fenced HTML only, byte-identical to the pack block (no
  trimming, no re-encoding; no clause edited, pack v1.0 untouched).
- No change to `fillContractTemplate` or `generateDaycareContractDrafts` —
  they already substitute values only; the wrapper simply stopped coming in.

## Tests (fail on pre-fix code, pass on the fix)

`tests/unit/kid850-contract-drafts-wrapper.test.ts` — 7 assertions:

1. Both templates start with `<!DOCTYPE html>` and contain no fence, heading
   or wrapper prose (`Machine-Fillable Template`, «قالب قابل للتعبئة آليًا», …).
2. Extraction is byte-identical to the ```html block recovered from the
   `lib/contract-templates.ts` pack-document strings.
3.-5. The extractor fails loudly on: missing fence, unclosed fence, two fences.
6. The full AR + EN fill starts with `<!DOCTYPE html>`, holds no wrapper, keeps
   the legal version stamp (EN "Version 1.0" / AR «الإصدار 1.0») and its `dir` attr.
7. End to end: `generateDaycareContractDrafts` uploads AR + EN files that start
   with `<!DOCTYPE html>` and carry no wrapper, containing the daycare data.

Verified failing: 7/7 FAIL on the pre-fix template (wrapper present).
Verified passing: 7/7 PASS on the fix.

## Regeneration of existing drafts — route: idempotent regeneration script

Provided AND exercised: `scripts/regenerate-contract-drafts.ts`
(`npx tsx scripts/regenerate-contract-drafts.ts`).

Every `daycare_contract` row is walked; each pointed-to draft is downloaded
and marked dirty only when it is not a clean contract file (no
`<!DOCTYPE html>`/`<html` top, or a ```html fence inside). Dirty daycares get
their wrapper objects best-effort deleted, ONLY their draft columns cleared
(signed snapshot never moves), and the real generator re-run — same fill, same
kiddy-public path, operator notification deduped by `(account_id, ref)`.
Clean daycares are never touched, so a second run is a no-op.

Local production-shape verification (fake kiddy-public storage REST server +
scratch SQLite seeded with the exact pre-fix stored drafts):

```
Found 1 daycare(s) with stored drafts.
REGENERATING: Sunshine Daycare (...)
  reason: ... still holds the markdown wrapper (fence present)  [x2]
  regen OK — clean AR + EN drafts verified for Sunshine Daycare
VERIFY OK: 1 daycare(s) regenerated with clean fenced-HTML drafts.
-- second run:
CLEAN, skipping: Sunshine Daycare
VERIFY OK: every stored draft starts as clean HTML — nothing to regenerate.
```

Old wrapper objects were deleted; the replacement drafts start with
`<!DOCTYPE html>` and hold 0 fences.

Deployed lists: the wrapper drafts from KID-746 QA live in the deployed
Supabase (not reachable from this environment). Run
`npx tsx scripts/regenerate-contract-drafts.ts` with
`KIDDY_DATABASE_URL` (production) + the Supabase vars; it discovers, lists
and regenerates every affected daycare — including any created since — and
exits non-zero with per-daycare reasons if any rewrite fails. No local dev
database holds draft rows (verified `data/kiddy.db`, `kid472-qa.db`,
`kid489-branding.db` — no `daycare_contract` table populated), so nothing in
this repo needed cleanup.

## Rendered draft evidence

Files generated through the real production fill path
(`contractDraftValues` + `fillContractTemplate`, exactly what the generator
uploads), via the `generateDaycareContractDrafts` pipeline against the fix:

- `draft-en.html` — head: `<!DOCTYPE html>\n<html lang="en" dir="ltr">`
- `draft-ar.html` — head: `<!DOCTYPE html>\n<html lang="ar" dir="rtl">`

`grep -c '```'` over both files: 0. Honesty note: these captures ran through
tsx (same TS source Next bundles; `next build` passed with the fix). A
headless-Chromium screenshot attempt failed in this environment (missing
system libs), and the plan allows "screenshot or HTML head" — the HTML heads
above are the evidence, hosted together with the full rendered files.

## Gates (this tree)

- `npx tsc --noEmit` clean
- `npm run lint` clean (single pre-existing KID-489 `<img>` warning)
- `npm run build` green
- `npm run db:verify-migrations` all passed
- `npm test` 92 files / 1013 tests green (incl. the 7 new KID-850 pins)
