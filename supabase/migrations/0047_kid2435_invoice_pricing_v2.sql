-- KID-2435: the invoice engine's pricing-v2 snapshot columns.
--
-- The engine now resolves the standard band from the measured peak child
-- count and applies the founding-cohort policy from pricing_band /
-- pricing_config. The original KID-245 formula columns stay (flat_rate_amount,
-- incremental_rate, incremental_amount, total_amount) so historic invoices
-- keep their shape; these columns record exactly which configured values the
-- engine used, so a later pricing edit never rewrites an issued invoice.
--
--   band_key / band_name            the standard band selected for the cycle
--   standard_monthly_egp            the band's standard monthly price (incl.
--                                   Enterprise+ overage) before founding/glide
--   standard_amount_egp             the standard amount for THIS cycle (monthly
--                                   or annual) before founding/glide
--   applied_monthly_rate_exact      the unrounded glide rate used for the term
--                                   (the 20% cap compounds on the exact value,
--                                   so 810 -> 972 -> 1166.4 -> 1399.68)
--   applied_monthly_rate            applied_monthly_rate_exact rounded to EGP
--   founding_applied                the founding year-1 / glide rate was used
--   founding_term_index             0 for the first 12 months, 1 for year 2…
--   glide_capped                    the 20% cap held the rate below the band
--   pilot_credit_egp                pilot fee credited against this invoice
--
-- annual_is_quote bands (Enterprise+) never auto-generate an annual invoice:
-- the operator supplies the per-client quote.

ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS band_key TEXT NOT NULL DEFAULT '';
ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS band_name TEXT NOT NULL DEFAULT '';
ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS standard_monthly_egp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS standard_amount_egp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS applied_monthly_rate_exact DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS applied_monthly_rate INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS founding_applied INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS founding_term_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS glide_capped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS pilot_credit_egp INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_daycare_invoice_band ON daycare_invoice (band_key);
