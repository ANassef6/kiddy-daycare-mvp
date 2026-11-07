# KID-492 (KID-489 item 3): Invoice payment-proof upload and admin notification

Parent uploads a payment screenshot/PDF on an invoice; the center admin is notified to
review and update the invoice status. The upload NEVER marks the invoice paid — the
admin keeps the existing status control.

## What shipped

1. **Schema** — `supabase/migrations/0034_kid489_payment_proof.sql` adds three nullable
   `child_billing` columns (idempotent `ADD COLUMN IF NOT EXISTS`, no NOT NULL/default
   write; existing invoices keep their shape):
   - `payment_proof_url` (the Storage URL),
   - `payment_proof_uploaded_at` (ISO text; the upload's timestamp — proof + time always
     move together so a re-upload can never leave a stale pointer),
   - `payment_reference` (the parent's optional reference/transaction text).

   Mirrored in `lib/sqlite-schema.ts`; `npm run db:verify-migrations` applies the whole
   chain on PGlite (Postgres 17) and passes.

2. **Boundary validation** — `lib/payment-proof.ts`: PNG/JPG only, `application/pdf`,
   5 MB cap (`MAX_PAYMENT_PROOF_BYTES`). Wrong type, oversize and empty files are
   rejected with a code before ANY storage or database write, so a rejection can never
   create a partial record.

3. **Upload action** — `uploadPaymentProofAction` (lib/actions.ts), in the KID-372
   fail-closed style:
   - authorize FIRST from the raw `billingId`: the invoice row's `institute_id` must be
     the request tenant, and the session must hold its own `family_member` link
     (`role != 'no_access'`) to the invoice's child — a same-center outsider parent, a
     foreign-institute invoice id, a center admin/staff account, or an anonymous caller
     are all refused with `/login?error=wrong-tenant` (or `/login`), with no write;
   - validate the file (`/child/<id>?error=proofType` / `?error=proofSize` banner redirects);
   - storage upload under `payments/<instituteId>/<billingId>/proof-<ts>-<uuid>.<ext>`
     (random suffix keeps a sibling family's object unguessable) to the existing
     `kiddy-public` bucket pattern; a storage failure redirects `?error=proofUpload`
     without touching the row;
   - only then write `payment_proof_url`, `payment_proof_uploaded_at`,
     `payment_reference` via `setChildBillingPaymentProof` — the STATUS column is never
     written by the upload;
   - audit event (KID-477 attribution: "Payment proof uploaded for an invoice",
     `hasPaymentProof` marker, no URL on the trail).

4. **Admin notification** — the center admin's in-app activity feed
   (`/portal/notifications`, `recentActivityFeed`) gains a derived payment-proof slice:
   invoices whose current proof was uploaded inside the 7-day feed window and are still
   unpaid render "Payment proof for <child> needs review" (EN/AR), body carries the
   invoice description, meta the parent's reference, linking to the child's billing
   page. Dedupe per upload event is structural: at most one CURRENT proof per invoice
   row, the item id is stable (`proof-<billingId>`), and the item exists only while the
   upload is within the window and the invoice is still unpaid — never on page reads.
   Email: the existing mail path is the GoTrue templated invite channel
   (lib/invoice-notify.ts); it cannot carry ad-hoc content to already-registered admins
   (the send is degraded to "already registered" for every existing account), so the
   in-app feed + web push-eligible durable pipeline stays the notification channel and
   no email is faked.

5. **Parent surface** (`/child/<id>`) — each unpaid invoice card gains an upload form
   (file input accepting png/jpg/jpeg/pdf, optional payment-reference field) and, once a
   proof exists, a "View uploaded proof" link plus a replace option; paid invoices show
   neither. Rejection/success states render localized banners (`?error=proof*`,
   `?proof=uploaded`).

6. **Admin invoice view** (`/portal/children/<id>/billing`) — a new "Proof" column with
   the proof link (new tab), upload date, and reference, next to the untouched
   status control (pending/paid/overdue/cancelled) the admin uses to mark it paid after
   viewing the proof.

## Tests

`tests/unit/kid489-payment-proof.test.tsx` — 24 tests:
- migration file pins + SQLite mirror columns (all NULL on a fresh invoice);
- `validatePaymentProof` accept/reject matrix incl. the 5 MB boundary;
- happy path (URL shape, uploaded_at, reference stored, status stays `pending`, audit
  carries no URL);
- re-upload replaces both proof columns and keeps ONE feed item;
- missing/wrong-type/oversize/storage-failure rejections redirect with the right
  `?error=proof*` and write nothing;
- cross-tenant/family denials: same-center outsider parent, foreign-institute invoice,
  center admin account, anonymous caller — all refused, no write;
- feed dedupe: exactly one item per invoice (re-upload, second invoice), item cleared
  once the invoice is paid; the derived item also renders on the admin
  `/portal/notifications` page;
- admin table proof column + placeholder cell; parent surface form/link/banners;
  paid invoices lose the upload form; outsider parent cannot render the child page;
- EN + AR label parity for every new string.

## Checks

- `npm run db:verify-migrations` — all migration checks passed (PGlite).
- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors (pre-existing `<img>` warnings only).
- `npm run build` — passes.
- Kid-492 suite green; full `npm test` result recorded below.

## Checks result

- `npm test` (full suite) — **76/76 test files green, 815/815 tests passed**
  (2026-11-07, worktree box-shared with the concurrent KID-491 run).
- Post-rebase on master (after the concurrent KID-481 merge) : tsc clean,
  kid489 suite re-run 24/24, db:verify-migrations green, lint 0 errors,
  next build green.

## Merge + deployment

- PR **#30** merged to master: merge commit **fe9b72149a2b1ad53507aa03b7001d5669f90999**
  (branch `kid489-payment-proof`, commit a9465b6).
- Vercel production deployment for the merge commit: **success**
  (commit status "Vercel" state=success on 2026-11-07, ~04:35Z).
- Post-deploy production smoke on `https://kiddyapp.net`: `/` → 200, `/login` → 200.
- NOTE (pre-existing, not from this change): the "Supabase Preview" CI check fails with
  `duplicate key ... (version)=(0032)` in `supabase_migrations.schema_migrations` —
  the ledger PK collides on the two files both prefixed `0032_`
  (0032_center_default_currency.sql, 0032_push_subscriptions.sql). The identical
  failure is present on the previous KID-491 merge commit (48f4aab). The App's own
  migration chain (db:verify-migrations on PGlite) applies in filename order and is
  green; the app's runtime PG schema path does not depend on the Supabase CLI ledger.
  Fixing the ledger requires renaming an already-recorded migration — a Supabase
  project-owner action, raised for the board rather than patched here.

## Honest limitations

- The proof URL targets the existing public `kiddy-public` bucket (task: reuse the
  existing upload pattern). URL-level singularity is mitigated with the random suffix in
  the storage key; the app surface (parent card, admin table) reaches the URL only for
  the family's own invoices (KID-372 gates) and the admin of that center. Signing URLs /
  a private bucket is a Supabase-project change and stays out of this task.
- If no Supabase Storage is configured (local/test), the upload degrades to the
  `?error=proofUpload` banner — nothing is stored.
