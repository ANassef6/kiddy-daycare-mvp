# KID-2478 — superadmin Excel bulk upload (children + staff)

Source: KID-215 conversation `05271084-ce27-419f-bc41-dd9391e241a0`, plan Part 2B
(revision `e5742d88-4a80-4ad4-bb3b-15e047bc190e`).

## Review gate

Satisfied. The founder reviewed the two draft templates and approved them:
"Awesome job Mika. Go for it." (KID-215 comment
`5e9e531f-8f48-4c81-aebe-424d24cad59b`, 2026-11-25).

## What shipped

| Area | Change |
| --- | --- |
| Templates | `lib/xlsx-write.ts` writes the approved children/staff workbooks byte-for-byte from the draft spec: same headers, grey sample row, header colours, cell notes, frozen header and the staff role dropdown. Copies are checked in under this folder. |
| Downloads | `GET /api/platform/bulk-upload/template/[children\|staff]` — operator-only, `.xlsx`, `no-store`. |
| Upload | `bulkUploadAction` in `lib/actions.ts` — operator-only, `.xlsx` only, non-empty, ≤5 MB, ≤500 data rows. |
| Parsing | `lib/xlsx-lite.ts` reads the first worksheet directly (inline strings, shared strings, cached numbers, Excel date serials). This also reads the approved draft files, which carry cell comments that ExcelJS 4.4 cannot reconcile. |
| Children rows | child + enrollment + `child_health`; parent contacts; parent account per parent email with `DEFAULT_ACCOUNT_PASSWORD` (`12345678`) and `must_change_password = 1`; existing parent accounts are linked, not duplicated. |
| Staff rows | staff + `staff_room`; login account with the mapped role (`admin` → admin account, `teacher`/`caregiver` → staff account); default password and forced-change flag; phone stored in `staff.phone`. |
| Duplicates | Child duplicate = same name + DOB at that daycare → skipped. Staff duplicate = existing account/staff email → skipped. Every skip is listed in the report. |
| Malformed rows | Reported with the spreadsheet row number and a stable reason (names, DOB, email, role, classroom, duplicate). Unknown child classroom follows the draft note: the child is created with a warning and no classroom. Unknown staff classroom is an error and creates nothing. |
| Atomicity | `withTransaction()` in `lib/db.ts` wraps each row. A late failure (for example a parent email that belongs to a non-parent account) rolls the whole row back. |
| Report | `bulk_upload` (migration 0055 + SQLite mirror) stores one bounded JSON report per run. `GET /api/platform/bulk-upload/report/[id]` downloads it as UTF-8 CSV with a BOM for Excel. |
| Settings UI | `app/platform/daycares/[id]/settings/page.tsx` renders `components/BulkUploadCard.tsx`; `app/platform/daycares/[id]/settings/bulk-upload/page.tsx` redirects to that section. The `/platform` daycare row links to Settings. |
| Emails | None. The uploader never calls GoTrue signUp, an invite path, or a mail helper. |
| i18n | EN + AR strings under `platform.bulkUpload*` / `platform.daycareSettings*`; the existing parity and divergence guards cover them. |

## Acceptance mapping

- **Both templates download from Settings and match the approved draft.** Rendered on the Settings page and route; files in this folder show the exact headers/notes/sample row/dropdown.
- **Upload creates children, staff accounts and linked parent accounts with the default password + forced-change flag; zero emails.** Pinned in `tests/unit/kid2478-bulk-upload.test.ts` (verify the scrypt hash with `12345678`, read `must_change_password`, no mail path in the writer).
- **Duplicate/malformed rows skipped and listed; row-level report downloadable.** Tested per kind; CSV includes row, status, reason and record id.
- **Non-operator upload rejected server-side.** The action calls `requirePlatformOperator()` (sentinel role + env allowlist); both download routes return 403 without it.
- **EN + AR verified.** Page render test in both locales; i18n keys parity/divergence suite green.

## Verification run (local, 2026-11-25)

```
npx tsc --noEmit                                  clean
npm run lint                                      clean (only pre-existing <img> warnings)
SESSION_SECRET=<random> npm run build             green
npx vitest run kid2478-* i18n-page-coverage       25 passed / 25
env -u DATABASE_URL -u KIDDY_DATABASE_URL \
  npm run db:verify-migrations                    all checks passed (PGlite)
```

`db:verify-migrations` was run against PGlite because this workspace shares a
live `DATABASE_URL` with a concurrent run; the shared schema produced a DDL
deadlock in 0040. The isolated PGlite run applied the full chain (including
0055) and its checks. 0055 also enables RLS on `bulk_upload` and revokes
anon/authenticated, because 0040 only covered tables that existed when it ran.

## Staging / production cut

- Branch: `kid2478-bulk-upload` (based on `origin/master` `75aa732`).
- The staging Worker build needs the deployment `NEXT_PUBLIC_*`, Supabase and
  `SESSION_SECRET` values (see `docs/CLOUDFLARE_MIGRATION.md`); those secrets
  are not present in this workspace, so the live staging deploy is the next
  step on a machine/CI with the deploy environment.
- Production remains gated on the founder's production sign-off after the
  template review (already approved at draft level). Do not cut production
  before that sign-off.

## Coordination with KID-2477 (Platform Settings restructure)

KID-2477 is moving `Billing` / `Invoices` under Settings. This task adds the
same Settings landing page (`app/platform/daycares/[id]/settings/page.tsx`) with
the bulk-upload card. If KID-2477's navigation lands first, keep the card as the
"Bulk upload" tab/section and keep the two template/download routes unchanged;
the card is self-contained (`components/BulkUploadCard.tsx`).
