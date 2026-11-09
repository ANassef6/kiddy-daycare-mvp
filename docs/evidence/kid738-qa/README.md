# QA evidence — KID-738: account billing Instapay link and payment proof

**Verdict: RELEASE** with one Medium defect (D1, below) and one environment
method note. Tested 2026-11-09 against the KID-737 fix commit **a65062b**,
which is an ancestor of production deploy commit **405ba6e** (Vercel status
`success`, "Deployment has completed", 2026-11-09T09:18:25Z — see
`transcripts/00-deploy-evidence.txt`). The interactive loop ran on a local
production build (`next build` + `next start`) of that exact commit with a
seeded SQLite dataset and a local Supabase-Storage-compatible stub; the
public and non-owner legs ran live on `https://kiddy-one.vercel.app`.

## Gate matrix

| Gate | Result | Evidence |
|---|---|---|
| Operator sets a valid Instapay link | **PASS** | Card on `/platform` saved `https://instapay.example.com/kid738-qa`; DB `platform_setting` row exact; success banner + "Updated" date; audit `Set …` with `cleared:false` and **no URL in metadata**. `screenshots/04-instapay-saved.png`, `transcripts/audit-proof-trail.json` |
| Invalid input refused (browser + server rails) | **PASS** | `javascript:alert(738)` → `?instapay=invalid` + banner, nothing stored (`02`); relative `/pay/relative` blocked by `input[type=url]` (`03`) **and** by a direct server-action POST (303 → `?instapay=invalid`, `transcripts/local-log.txt`); direct `javascript:` POST also 303-refused; `platform_setting` stayed empty after every refusal |
| Clearing the link hides the owner button | **PASS** (via blank + Save) / **D1 on the Clear button** | Blank field + Save deletes the row (audit `Cleared … cleared:true`); owner page then shows the no-link hint on every unpaid row and no Pay button (`16-owner-paylink-hidden-no-link.png`); restoring the link brings both buttons back (`17`). The dedicated **"Clear link" button does not clear — see D1** (`16a-platform-clear-button-noop.png`) |
| Owner sees "Pay with Instapay" on unpaid invoices only | **PASS** | Pending (2026-10) and overdue (2026-09) rows each render the button `target=_blank`; clicking opens exactly the stored URL in a popup (route-fulfilled, URL asserted); after mark-paid the paid row shows neither button nor upload form while the unpaid row keeps both (`10`, `20-owner-paid-row-no-upload.png`) |
| Owner uploads PNG / JPG / PDF with a reference | **PASS** | PNG → `?proof=uploaded` + banner, status stayed `pending`, proof URL + date + reference stored and rendered (`11`); JPG onto the overdue invoice → stored, status stayed `overdue` (`25`); PDF replacement → new URL, new reference, old object retained (`14`) |
| Upload never changes status; operator still marks paid | **PASS** | Every upload audit carries `statusBefore: pending`; only `markInvoicePaidAction` wrote `paid` (`transcripts/db-state-final.json`, `audit-proof-trail.json`) |
| Operator sees the proof; paid invoice refuses new upload | **PASS** | Proof column shows view link + `Uploaded:` date + `Ref:` for the pending invoice, `—` for the proof-less one (`18`); after **Mark as paid** the proof stays visible (`19`); a direct owner POST at the paid invoice → 303 `?proofError=paid`, row and storage unchanged (`transcripts/rail-paid-refusal.txt`) |
| Cross-tenant: owner A ≠ owner B | **PASS** | Second daycare + owner created through the real operator flow (`22`); owner B sees only their invoice and the Pay button (`23`); owner A's page never lists B's invoice (`24`); **A → B's invoice and B → A's invoice both 303 → `/login?error=wrong-tenant` with zero writes** (`transcripts/rails-cross-tenant.txt`); positive controls: each owner's own invoice passes tenancy and reaches file validation |
| Non-owner roles cannot upload | **PASS** | Parent session → 303 `?error=wrong-tenant`; anonymous → 303 `/login`; live production: staff fixture and parent fixture both bounced off `/portal/account-billing` to `/portal/dashboard`, no billing content (`prod-02`, `prod-03`); page-level gate also verified live for anonymous (`prod-01`) and `/platform` (`prod-04`) |
| Oversize and wrong-type refused, no partial record | **PASS** | `.txt` → `?proofError=proofType` banner, stored proof untouched, **0** new objects (`12`); 5 MB + 1 B PNG → `?proofError=proofSize`, same result (`13`); storage object count after all refusals still equals the number of successful uploads (3: PNG, PDF, JPG — `transcripts/storage-objects.txt`) |
| Audit trail | **PASS** | Exactly one audit per successful proof upload (`statusBefore`, ids only), one per link save/clear, one per mark-paid; **no audit row for any refused attempt** (`transcripts/audit-proof-trail.json`) |
| Gates | **PASS** (full battery not completed — see below) | `tsc --noEmit` exit 0; `next lint` exit 0 (pre-existing `no-img-element` warnings only); `next build` green; `db:verify-migrations` all passed; focused battery at the deployed commit — **7 files / 140 tests, 0 failures** (`transcripts/gate-tests-focused.txt`), including the full KID-737 suite |

## Gates

`tsc --noEmit` exit 0, `next lint` exit 0 (pre-existing warnings only),
`next build` green, `db:verify-migrations` all passed, and a focused battery
at the deployed commit — `kid737-platform-payment`,
`kid489-payment-proof`, `kid489-instapay-payment-link`, `kid244/245/246`,
`kid372` — **7 files / 140 tests, 0 failures**
(`transcripts/gate-tests-focused.txt`). The full 89-file battery was started
twice and stopped: this host is running two other runs' vitest batteries
concurrently (measured ≈150 s per file, ≈5 h projected). Files completed
green before stopping (0 failures): `kid737-platform-payment` (23),
`parent-account-enhancements` (26), `sibling-family-link-backfill` (22) —
raw outputs in `transcripts/gate-tests.txt` and
`transcripts/gate-tests-full.txt`. KID-737's own full battery at this fix
commit: 90 files / 988 tests — 975 pass, remaining failures pre-existing
(`activityTitle` KID-733 keys, one flaky kid216 timeout that passes on
rerun).

## Defects

| # | Severity | Summary | Location / fix |
|---|---|---|---|
| **D1** | **Medium** | The `/platform` **"Clear link" button does not clear the link**: it re-saves the same URL. The pre-filled `<input name="instapayUrl">` precedes the `<button name="instapayUrl" value="">` in the form, so `formData.get("instapayUrl")` returns the input's value (proved by dumping the exact `FormData` — `transcripts/defect-d1-formdata.txt`) and the action records a `Set … cleared:false` audit (`transcripts/audit-proof-trail.json`, 10:15:27). An operator who clicks "Clear link" is shown the success banner while owners keep seeing the Pay button. Clearing **is** possible by emptying the field and pressing Save (verified), so the loop itself is not blocked. | `app/platform/page.tsx:159-182` — give the input a distinct name (or clear it before submit / handle the submitter explicitly in `setPlatformInstapayAction`). Evidence: `screenshots/16a-platform-clear-button-noop.png`, `transcripts/defect-d1-clear-button.txt` |

## Method and environment notes (not product defects)

- **Production owner/operator credentials are not granted to this agent.**
  The documented demo pairs are rejected on production by design (KID-199.4r,
  re-confirmed live → invalid-credentials banner, `prod-05`), the Vercel
  token is not granted, and the `demo/sunshine-admin-password` secret
  proposed in KID-472 is still pending. The owner/operator loop therefore
  ran on a **local production build of the exact production commit 405ba6e**
  with seeded demo credentials — the same split used and accepted for
  KID-489 QA and KID-747 QA. Live production legs used the granted fixtures
  (`staff`, `parent`) and are listed above.
- **Storage**: no Supabase credentials are granted, so `kiddy-public` was
  served by a local Supabase-Storage-compatible stub
  (`/storage/v1/object/...` + `/storage/v1/object/public/...`). The app's
  own `@supabase/supabase-js` upload path round-trips byte-identical
  objects through it (3 objects, listed in `transcripts/storage-objects.txt`).
  Confirm the real bucket upload at deploy — same call pattern as the
  production-proven KID-489 parent payment proof.
- **Invoice fixtures**: the pending invoice (2026-10, due 2026-11-05) was
  generated by the real engine (`runBillingSweep` with a controlled clock of
  2026-11-02 — on the real date the same sweep would immediately mark a
  2026-11-05 invoice overdue); the overdue row (2026-09) is a direct SQL
  fixture covering the second unpaid state. The overdue fixture trips the
  real enforcement rule on any later sweep, which disabled Sunshine once
  mid-run; the row was re-activated and no product path was implicated
  (`transcripts/local-log.txt`, s5 note).
- **Re-runs**: the mark-paid step was run twice (a first pass was reset to
  `pending` for a clean instrumented re-run), hence two `Marked an invoice
  paid` audit rows; both are genuine operator actions in this throwaway
  dataset.

## Evidence index

- `screenshots/` — 27 PNGs: `01`–`05` operator link + billing setup,
  `10`–`17` owner upload/refusal/link-visibility loop, `18`–`20` operator
  review + mark-paid + paid state, `22`–`25` second daycare, scoping, JPG,
  `prod-01`–`prod-05` live production legs.
- `transcripts/` — full assertion log (`local-log.txt`), live production
  probe results, cross-tenant/role/anonymous refusal transcripts, paid and
  anonymous refusal transcripts, final DB state, audit trail, storage
  object list, deploy evidence, gate outputs, and the D1 FormData dump.
