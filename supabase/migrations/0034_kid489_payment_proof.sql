-- KID-489 item 3 (KID-492): the parent's payment-proof upload.
--
-- Three optional TEXT columns on child_billing:
--   payment_proof_url         the Supabase Storage URL of the uploaded
--                             screenshot/PDF, stored under
--                             payments/<instituteId>/<billingId>/…
--   payment_proof_uploaded_at when the CURRENT proof was uploaded ( ISO text).
--                             Every upload replaces both values — the row
--                             carries at most one "current" proof, so a
--                             re-upload can never leave a stale file pointer.
--   payment_reference         the parent's optional free-text reference
--                             (receipt number, transaction id, ...).
--
-- Nothing here is a NOT NULL or defaulted write — invoices without a proof
-- keep the exact shape they had before this migration. The invoice STATUS is
-- never touched by an upload: a proof arriving does NOT mark the invoice
-- paid; the center admin reviews the proof and updates the status themselves
-- through the existing status control.
--
-- Idempotent: safe to apply on every app startup.

ALTER TABLE child_billing ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;
ALTER TABLE child_billing ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at TEXT;
ALTER TABLE child_billing ADD COLUMN IF NOT EXISTS payment_reference TEXT;
