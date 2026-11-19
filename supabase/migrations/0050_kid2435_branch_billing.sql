-- KID-2435: one subscription per branch (pricing plan v3, billing rule 12).
--
-- The founder answered the branch-subscription card on 19 Nov 2026:
--   * the BRANCH record holds the subscription;
--   * a branch with no active children is billed 0 (it is not invoiced until
--     its first active child);
--   * a new branch that joins a founding group uses ONE new founding slot and
--     gets the founding rate for 12 months from its own start;
--   * a branch's first billed month starts on the 1st of the month after the
--     branch is created (the demo covers the gap).
--
-- Before this migration billing was keyed by institute (one row in
-- daycare_billing, one invoice per (institute_id, cycle_month)). The branch
-- table existed but had no billing anchor. This migration:
--   1. creates `branch_billing`, keyed by branch_id, with the plan, first
--      cycle, founding flag/dates, pilot end, cancellation date and the
--      legacy amount columns (kept for historic contract snapshots);
--   2. backfills one row per existing branch. The institute's first branch
--      (usually "Main") copies today's daycare_billing row; additional
--      branches start on the same plan with their own cycle date;
--   3. makes sure every institute has at least one branch, so no daycare can
--      exist without a subscription record;
--   4. adds `branch_id` to daycare_invoice, backfills existing invoices to
--      the institute's first branch, and replaces the old unique
--      (institute_id, cycle_month) index with (branch_id, cycle_month).
--
-- `daycare_billing` is retained as the group-level defaults row: the create
-- form and the owner portal still read it, and operator edits there
-- propagate to every branch. The engine now bills from branch_billing only.

CREATE TABLE IF NOT EXISTS branch_billing (
  branch_id TEXT PRIMARY KEY REFERENCES branch(id) ON DELETE CASCADE,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'demo' CHECK (plan IN ('demo', 'monthly', 'annual')),
  monthly_rate_egp INTEGER NOT NULL DEFAULT 500,
  per_child_rate_egp INTEGER NOT NULL DEFAULT 50,
  free_child_threshold INTEGER NOT NULL DEFAULT 10,
  first_cycle_start DATE,
  founding_client SMALLINT NOT NULL DEFAULT 0,
  founding_started_at DATE,
  pilot_end_date DATE,
  cancel_at TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branch_billing_institute
  ON branch_billing (institute_id);
CREATE INDEX IF NOT EXISTS idx_branch_billing_plan
  ON branch_billing (plan);
CREATE INDEX IF NOT EXISTS idx_branch_billing_founding
  ON branch_billing (founding_client);

-- Every institute needs a subscription record. Older demo data (and some
-- imported institutes) have no branch row yet; give them a "Main" branch
-- before the backfill so the billing row has an anchor.
INSERT INTO branch (id, institute_id, name)
SELECT 'main-' || i.id, i.id, 'Main'
FROM institute i
WHERE NOT EXISTS (SELECT 1 FROM branch b WHERE b.institute_id = i.id);

-- One branch_billing row per branch. The first branch (by creation order)
-- copies the institute's current billing settings; every later branch starts
-- on the same plan with its own cycle date (the 1st of the month after it was
-- created) and keeps the legacy amounts only as defaults.
INSERT INTO branch_billing (
  branch_id, institute_id, plan, monthly_rate_egp, per_child_rate_egp,
  free_child_threshold, first_cycle_start, founding_client,
  founding_started_at, pilot_end_date, cancel_at, updated_at
)
SELECT
  br.id,
  br.institute_id,
  COALESCE(db.plan, 'demo'),
  COALESCE(db.monthly_rate_egp, 500),
  COALESCE(db.per_child_rate_egp, 50),
  COALESCE(db.free_child_threshold, 10),
  COALESCE(db.first_cycle_start, date_trunc('month', br.created_at) + interval '1 month'),
  CASE WHEN br.id = (
    SELECT b2.id FROM branch b2 WHERE b2.institute_id = br.institute_id
    ORDER BY b2.created_at, b2.id LIMIT 1
  ) THEN COALESCE(db.founding_client, 0) ELSE 0 END,
  CASE WHEN br.id = (
    SELECT b2.id FROM branch b2 WHERE b2.institute_id = br.institute_id
    ORDER BY b2.created_at, b2.id LIMIT 1
  ) THEN db.founding_started_at ELSE NULL END,
  CASE WHEN br.id = (
    SELECT b2.id FROM branch b2 WHERE b2.institute_id = br.institute_id
    ORDER BY b2.created_at, b2.id LIMIT 1
  ) THEN db.pilot_end_date ELSE NULL END,
  db.cancel_at,
  COALESCE(db.updated_at, now())
FROM branch br
LEFT JOIN daycare_billing db ON db.institute_id = br.institute_id
WHERE NOT EXISTS (SELECT 1 FROM branch_billing bb WHERE bb.branch_id = br.id);

-- The branch is the subscription record: an invoice now belongs to a branch.
ALTER TABLE daycare_invoice ADD COLUMN IF NOT EXISTS branch_id TEXT
  REFERENCES branch(id) ON DELETE CASCADE;

UPDATE daycare_invoice di
SET branch_id = (
  SELECT br.id FROM branch br
  WHERE br.institute_id = di.institute_id
  ORDER BY br.created_at, br.id
  LIMIT 1
)
WHERE di.branch_id IS NULL;

-- A branch is billed once per cycle. Two branches of the same group are two
-- separate subscriptions and may share a cycle month.
DROP INDEX IF EXISTS uq_daycare_invoice_cycle;
CREATE UNIQUE INDEX IF NOT EXISTS uq_daycare_invoice_branch_cycle
  ON daycare_invoice (branch_id, cycle_month);
CREATE INDEX IF NOT EXISTS idx_daycare_invoice_branch
  ON daycare_invoice (branch_id, cycle_month DESC);
