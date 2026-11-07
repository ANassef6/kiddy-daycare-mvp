-- KID-737: the platform Instapay link and the daycare invoice payment proof.
--
-- Two pieces, both additive:
--
-- 1. platform_setting — a tiny key/value table for PLATFORM-WIDE operator
--    settings (tenant-less: it lives outside any institute). KID-737 writes
--    exactly one row, key 'instapay_url' — the subscription payment link the
--    owner's Account billing page opens for every unpaid daycare invoice.
--    The link is validated at its boundaries (lib/instapay.ts
--    parsePaymentLink: blank clears, absolute http/https stored, anything
--    else refused), so no DB-side CHECK duplicates that logic.
--
-- 2. daycare_invoice gains the three nullable proof columns — the same shape
--    child_billing carries since 0034, but for the DAYCARE'S OWN subscription
--    invoices:
--      payment_proof_url         the Supabase Storage URL of the owner's
--                                uploaded screenshot/PDF, stored under
--                                payments/<instituteId>/<invoiceId>/…
--      payment_proof_uploaded_at when the CURRENT proof was uploaded.
--                                Every upload replaces both values — the row
--                                carries at most one "current" proof.
--      payment_reference         the owner's optional free-text reference
--                                (receipt number, transaction id, ...).
--
-- Nothing here is a NOT NULL or defaulted write. The invoice STATUS is never
-- touched by an upload: a proof arriving does NOT mark the invoice paid; the
-- platform operator reviews the proof and marks it paid through the existing
-- control, and the proof stays visible for history afterwards.
--
-- Idempotent: safe to apply on every app startup.

CREATE TABLE IF NOT EXISTS platform_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_by_account_id TEXT REFERENCES account(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;
ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at TEXT;
ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS payment_reference TEXT;
