-- KID-489 item 2 (KID-491): the Instapay payment link.
--
-- Two optional TEXT URL columns:
--   institute.instapay_url  the center-level default link, saved from Center
--                           details; every new child invoice form prefills it.
--   child_billing.payment_link the link stored PER invoice, so a daycare can
--                           override (or clear) the center default for one
--                           invoice. NULL (never set) and blank are the same
--                           thing at the boundaries: no payment link.
--
-- Nothing here is a NOT NULL or defaulted write — existing invoices and
-- centers render/keep the exact shape they had before this migration, and the
-- app validates http/https URLs at its boundaries (lib/instapay.ts), so no
-- DB-side CHECK duplicates that logic.
--
-- Idempotent: safe to apply on every app startup.

ALTER TABLE institute ADD COLUMN IF NOT EXISTS instapay_url TEXT;
ALTER TABLE child_billing ADD COLUMN IF NOT EXISTS payment_link TEXT;
