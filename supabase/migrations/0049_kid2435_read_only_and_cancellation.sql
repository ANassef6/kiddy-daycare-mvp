-- KID-2435 v3: failed-payment read-only and end-of-month cancellation.
--
-- Approved 19 Nov 2026 (KID-2430, pricing plan v3):
--   * Failed payment: 7 days' grace, then the account becomes READ-ONLY.
--     Data is never deleted. The account is no longer disabled for billing.
--   * Cancellation takes effect at the end of the paid month.
--
-- Before this migration the overdue sweep called setInstituteActive(false),
-- which blocked every user at login. The login gate could tell a billing
-- block apart from a manual disable only by the presence of an overdue
-- invoice. This migration records the reason explicitly:
--   * `institute.disabled_reason` = 'manual' for a hand-disabled row,
--   * a row that the billing sweep disabled (active = 0 + an overdue
--     invoice) is re-enabled and its reason cleared, because billing now
--     yields read-only access instead of a hard block.
--
-- `daycare_billing.cancel_at` stores the last day of the paid month. The
-- invoice engine stops at the next cycle, and access becomes read-only the
-- day after it. NULL means "no cancellation".

ALTER TABLE institute ADD COLUMN IF NOT EXISTS disabled_reason TEXT;

UPDATE institute SET disabled_reason = 'manual'
  WHERE active = 0 AND disabled_reason IS NULL;

UPDATE institute SET disabled_reason = 'billing'
  WHERE active = 0
    AND EXISTS (
      SELECT 1 FROM daycare_invoice di
      WHERE di.institute_id = institute.id AND di.status = 'overdue'
    );

UPDATE institute SET active = 1, disabled_reason = NULL
  WHERE disabled_reason = 'billing';

ALTER TABLE daycare_billing ADD COLUMN IF NOT EXISTS cancel_at TEXT;
