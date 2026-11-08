# KID-747 — QA acceptance: daycare contracts (pack, auto-generation, signed upload)

**Verdict: RELEASE** (with 2 defects to schedule and 1 environment limitation stated below).
Template version tested: **v1.0** — KID-744 `template-en` rev `1642f71b` / `template-ar` rev `d000ac31`,
copied onto KID-746 as rev `7eccbbb8` / `fb61e230` (the copies are **byte-identical** to the approved originals).

| Gate (plan) | Result |
|---|---|
| No contract can leak across daycares | **PASS** — page guard and action guard both bounce every non-operator (`307 /login`) for read *and* upload; anonymous control identical |
| Generated drafts match the approved template | **PASS** — embedded template strings are byte-identical to Adel's approved pack; every variable filled; EN/AR clause numbering identical; **D1** (wrapper text, low) below |
| Signed upload works | **PASS** — upload, card render, replacement, wrong-type and oversize refusals (nothing written), all through the real browser UI |

## Inputs read

- **KID-744** (Adel, `in_review` per the wake — v1.0 is stable): documents `template-en`, `template-ar`,
  `version-log` (variable register §5), `order-schedule`, `cover-note`, `sunshine-contract-*`.
- **KID-745** — commit `371e3a5` (signed upload, migration 0038, `lib/contract.ts` boundary, card, 19 assertions).
- **KID-746** — commit `3065643` (migration 0039 `draft_url_ar/en`, `lib/contract-templates.ts`, generator,
  operator notification, queue/badge/push card, 18 assertions).
- **KID-816** — commit `ac9616e` (web-push default-import fix; needed for the push leg, see D2).

## Test environment (honest about what is real and what is a harness)

- **App**: local production build (`next build` + `next start`, Next 14.2.35) of commit `3065643` for the
  contract legs, rebuilt at `ac9616e` for the push leg (only `lib/push.ts` + its two test mocks differ).
  Fresh seeded SQLite (`lib/seed.ts`), `SESSION_SECRET` set, VAPID keypair generated for the push leg.
- **Browser**: Skyvern real browser (`engine=skyvern-1.0`) against `http://172.21.0.3:3210`.
  The run injects a signed `kiddy_sess` cookie through Skyvern's `extra_http_headers`: the production
  `Secure` cookie set over plain http is not replayed by Chromium on server-action POSTs in this harness,
  so the session is supplied explicitly. The session token is minted with the same HMAC/payload as
  `lib/auth.ts` — no product code was modified.
- **Storage**: no Supabase project credentials are granted to this agent, so `kiddy-public` was served by a
  local Supabase-Storage-compatible stub (`/storage/v1/object/...` + `/storage/v1/object/public/...`,
  multipart unwrapping identical to what the real API accepts). Round-trip through the app's own
  `@supabase/supabase-js` client stored **byte-identical** objects (`roundtrip` proof: 260/260 bytes).
  The real-bucket upload therefore still needs its confirm-at-deploy tick (same call pattern as the
  KID-489 payment proof, which was proven against real Supabase Storage in production).

## Check battery (isolated worktree at the fix commits)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run db:verify-migrations` | exit 0 ("All migration checks passed", 40 migrations) |
| `npm test` | **91 files / 1005 tests passed**, 0 failed, exit 0 (3471 s under concurrent-load) |
| `next build` | exit 0 (both `3065643` and `ac9616e`) |

Transcripts: `transcripts/check-battery.txt`.

## 1. Template fidelity (static, against the approved pack)

- `CONTRACT_TEMPLATE_EN` / `CONTRACT_TEMPLATE_AR` in `lib/contract-templates.ts` are **byte-identical**
  (54 252 / 47 371 chars) to the KID-746 copies **and** to the KID-744 approved originals; `CONTRACT_TEMPLATE_VERSION = "1.0"`.
- Variable sets: **52 in EN = 52 in AR, identical names**. The `version-log` §5 register lists 47 entries
  (`SUBPROCESSOR_1_NAME etc.` covers the 9 sub-processor slots; the 5 NDA-only names belong to the pack's
  separate `nda` document, which is not part of this template) — every register variable that appears in the
  master template is filled by `contractDraftValues` (+ `termValues` for the four term fields).
- Clause numbering: **24 master clauses + 14 DPA clauses in both languages, identical sequence**
  (`1…24, 1…14`, 47 headings each) — `transcripts/draftcheck.json` (`clauseParity.equal: true`, 38 numbered + 9 unnumbered headings each).
- CEO-only open points carry the pack's own markers (`[TO BE CONFIRMED BY CEO]` / `[مطلوب للتأكيد من الرئيس التنفيذي]`),
  not invented text.

## 2. Create a test daycare → drafts + operator notification (browser leg)

Run `tsk_594557960146243080`, screenshots `screenshots/create-final.png`, `create-push3-final.png`:

- Green banner **"Daycare created. The owner can sign in right away."**
- **Contracts awaiting review** card lists the new daycare: `QA KID747 Browser Center | Plan: demo | 2026-11-08`.
- Per-row badge **"Contract: awaiting review"**; **Operator push notifications** card renders.
- DB (`transcripts/dbcheck.json`): one `daycare_contract` row, `template_version = "1.0"`,
  `draft_url_ar` + `draft_url_en` both set (the legacy single `draft_url` stays NULL), `draft_generated_at` set.
- Storage: exactly 2 draft objects (`draft-ar-*.html`, `draft-en-*.html`).
- Notification: `kind=contract_draft`, `ref=contract-draft-<instituteId>`, **`institute_id = NULL`** (operator-scoped),
  payload carries `daycareId`, `daycareName`, `plan`, `deepLink: /platform/daycares/<id>/billing`.
  4 such rows exist for the 4 test daycares — **never** for the daycare owner's account.
- Audit: `entity_type=daycare_contract`, `summary="Contract drafts generated (Arabic + English)"`,
  `metadata {"contractDrafts":true,"templateVersion":"1.0"}`.

## 3. Download both drafts (content + clause parity)

`transcripts/draftcheck.json` — both URLs return 200 `text/html`:

- Filled from the platform's own record: daycare name, owner full name + email, plan `demo`,
  rates `500 / 50 / 10 / 24,000`, currency `EGP`, first cycle `2026-12-01`, `KIDDY-<instituteId>`,
  subdomain, `info@kiddyapp.net`, template version `1.0`, CEO markers present — **all `true` in both languages**.
- **No unfilled `{{…}}` remains** except `{{VARIABLE}}`, which lives inside the pack's own HTML instruction
  comment (deliberate — pinned by `tests/unit/kid746-contract-drafts.test.tsx`).
- EN `dir="ltr"`, AR `dir="rtl"`; 47 headings each; **numbered-clause sequences identical** (`clauseParity.equal`).
- Rendered in the real browser: `screenshots/draft-en-render.png`, `draft-ar-render.png` (full-page).

## 4. Signed upload / replacement / refusals (browser legs, real file inputs)

| Leg | Run | Evidence |
|---|---|---|
| Upload signed PDF | `tsk_594560777644788556` | `screenshots/upload-v1-final.png` — banner "Signed contract uploaded."; card shows `signed-v1.pdf`, "Uploaded 8 Nov 2026, 05:19", "by Platform Operator"; label flips to **Replace the signed contract…**; DB `signed_*` + storage object + audit `{"contractUpload":true}` (ids only, no URL) |
| Wrong type (`.txt`) | `tsk_594561718242626742` | `screenshots/wrongtype-final.png` — "Rejected: the contract must be a PDF, PNG or JPG file, and it cannot be empty."; signed row **unchanged**, **0** new storage objects |
| Oversize (10 MB + 1 B) | `tsk_594562461271969074` | `screenshots/oversize-final.png` — "Rejected: the contract file is larger than 10 MB."; signed row **unchanged**, **0** new storage objects |
| Replace | `tsk_594565038252347016` | `screenshots/replace-final.png` — new file name/date/URL, draft columns untouched; downloaded object = **260 bytes, byte-identical to the fixture PDF** |
| Queue lifecycle | `tsk_594564471316663854` | `screenshots/create-final.png` (awaiting review) → `screenshots/queue-postsig.png` (**"No contracts awaiting review."** + badge **"Contract: signed"**) |

Storage object count for the signed daycare after all five upload attempts: 5 (2 drafts + 3 signed versions —
one per *successful* upload only). Refusals write nothing anywhere.

## 5. Non-operator cannot open or upload another daycare's contract

Curl with minted, valid session cookies (`transcripts/*-get.txt`, `*-post.txt`, `anon2.txt`), all against
`/platform/daycares/mw7di7uu-rfny9k93/billing`:

| Caller | GET page | POST `uploadDaycareContractAction` (browser wire format, `$ACTION_ID_…` + `Accept: text/html`) |
|---|---|---|
| Daycare owner of that centre (`qa-kid747-browser@…`) | **307 → /login** | **307 → /login**, no storage write, no row change |
| Owner of *another* centre (Sunshine owner) | **307 → /login** | **307 → /login**, no storage write |
| Anonymous | **307 → /login** | — |

Browser confirmation: `screenshots/owner-denied-final.png` — the owner opening the contract URL lands on the
tenant **Sign in** page with no contract content.

## 6. Operator push path

- Durable notification row written for every test daycare (`institute_id NULL`, deep link to the contract card).
- **At `3065643`** (the KID-745/746 tree) the fan-out reached `sendNotification` but threw
  `TypeError: Cannot read properties of undefined (reading 'sendNotification')` — the web-push default-import
  defect that **KID-816 fixed in `ac9616e`** (server log line `KID-480 push send failed … ref=contract-draft-…`).
- **After `ac9616e`**: a real-format `push_subscription` row for the operator (P-256 `p256dh` + `auth`,
  VAPID keypair in env) and a 4th test daycare produced a **successful VAPID POST to an HTTPS endpoint** —
  `transcripts/push-sink.log` shows `Authorization: vapid t=eyJ0…` with the 341-byte encrypted payload at
  05:59:22, and **0** `KID-480 push send failed` lines in the server log.
- Device delivery to a real browser/FCM is **not** claimed here (no real device subscription exists in this
  harness); the delivery re-verdict after the KID-816 fix is tracked separately by **KID-817**.

## 7. Idempotency

Re-running `generateDaycareContractDrafts` for an already-generated daycare returns
`{ ok: false, reason: "draft-exists" }`, notification count unchanged (4 → 4), no new storage file
(`transcripts/idempotency.txt`). Pinned again by the generator unit tests.

## Defects

| # | Severity | Summary | Evidence | Proposed fix / location |
|---|---|---|---|---|
| **D1** | **Low** | Generated drafts embed the pack **document** (markdown `#` heading, explanatory prose and the ```` ```html ```` fence) instead of the pack's authoritative HTML block, so a browser renders ~600 characters of wrapper text above the contract. The pack itself says "The full HTML source follows in a code block. The source is the authoritative template" and promises a *clean* downloadable file. Legal text is unaffected — it is reproduced verbatim. | `draftcheck.json` (`startsWithMarkdownWrapper: true`, `<!DOCTYPE` at offset 611 EN / 507 AR); visible at the top of `screenshots/draft-en-render.png` / `draft-ar-render.png` | Embed/extract only the fenced HTML in `lib/contract-templates.ts` (or slice it in `fillContractTemplate`, `lib/contract.ts:148`); re-generate the stored drafts afterwards |
| **D2** | **Medium** (fixed outside this task) | Operator contract push could not deliver at the KID-745/746 commit: `web-push@4.0.0` has no default export, so `defaultSender` threw before any network call. | server log line in §6; fixed by **KID-816** (`ac9616e`), verified working by this run (push-sink VAPID POST) | `lib/push.ts` — already fixed; delivery re-verdict is **KID-817** |

No other defects were found. Everything the plan asks to record is in the transcripts and screenshots above.

## Environment limitation (not a product defect)

- Storage objects were written to a local Supabase-Storage-compatible stub because no Supabase credentials
  are granted to this agent; the app's upload/download code paths, validation order, row writes and public-URL
  construction are the real ones under test. **Confirm the real `kiddy-public` bucket upload at deploy**
  (identical call pattern to the production-proven KID-489 payment proof).
- Skyvern could not attach a file by file-id (`Failed to download file from …`), so fixtures are served over
  HTTP by the same harness stub and attached by URL; the browser → Next server action → storage chain is otherwise real.

## Reproducing

Fixtures, harness scripts (storage stub, cookie minting, Skyvern launchers) live in the QA run workspace, not
in this repository; the evidence folder contains everything the report cites.
