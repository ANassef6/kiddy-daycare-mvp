-- KID-489 item 1 (KID-490): center-level default currency.
--
-- The finance page hardcoded AED and child billing hardcoded CAD as display
-- and insert fallbacks. Each daycare now carries its own default currency
-- (seeded to EGP, the platform's operating currency) that new child invoices
-- pick up and finance display fallbacks resolve to. Existing child_billing
-- rows keep their stored currency — nothing here rewrites amounts.
--
-- Idempotent: safe to apply on every app startup.

ALTER TABLE institute ADD COLUMN IF NOT EXISTS default_currency TEXT NOT NULL DEFAULT 'EGP';
