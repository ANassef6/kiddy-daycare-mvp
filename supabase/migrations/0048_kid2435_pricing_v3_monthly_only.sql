-- KID-2435: pricing v3 — monthly only (approved 19 Nov 2026, KID-2430).
--
-- The annual product is removed at launch: no annual price, no prepaid term,
-- no renewal and no proration. This migration removes the stored annual
-- amounts and the 20% glide setting, and adds the 7-day payment grace setting.
--
-- The monthly band ladder, the Enterprise+ overage formula and the founding
-- year-1 amounts stay unchanged. The founding rate now steps to the standard
-- band amount once, at month 13, so the glide cap is gone.
--
-- There are no paying clients at this date, so the plan rewrite below is a
-- safety net rather than a data migration. Historic invoices keep their
-- plan/amount snapshot; only the selectable product and the configuration
-- lose annual.

-- 1. Configuration: drop the glide setting, add the payment grace window.
DELETE FROM pricing_config WHERE key = 'founding.glide_max_increase_pct';
INSERT INTO pricing_config (key, value) VALUES ('billing.grace_days', '7')
ON CONFLICT (key) DO NOTHING;

-- 2. Bands: annual is no longer stored. The monthly ladder is untouched.
ALTER TABLE pricing_band DROP COLUMN IF EXISTS annual_egp;
ALTER TABLE pricing_band DROP COLUMN IF EXISTS annual_is_quote;

-- 3. Per-daycare billing: drop the annual amount and stop accepting the
--    annual plan. Any stray annual row becomes monthly; no paying client
--    exists at launch, per the approved plan.
ALTER TABLE daycare_billing DROP COLUMN IF EXISTS annual_amount_egp;
ALTER TABLE daycare_billing DROP CONSTRAINT IF EXISTS daycare_billing_plan_check;
UPDATE daycare_billing SET plan = 'monthly' WHERE plan = 'annual';
ALTER TABLE daycare_billing ADD CONSTRAINT daycare_billing_plan_check
  CHECK (plan IN ('demo', 'monthly'));
