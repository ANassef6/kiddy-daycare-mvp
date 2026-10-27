-- KID-245: Finance/2 — the daycare_invoice record (parent KID-243).
--
-- One invoice per BILLED cycle (monthly: one per calendar month; annual: one
-- per 12-month block). Uniqueness is (institute_id, cycle_month) — a cycle is
-- billed once, and the lazy generator (lib/billing.ts) plus the migration
-- ledger together make concurrent sweeps idempotent: re-running inserts
-- nothing. cycle_month is the FIRST month of the billed cycle, YYYY-MM:
--   - monthly plan: the calendar month being billed (2026-03 bills March).
--   - annual plan: the first month of the 12-month block (2026-03 bills
--     2026-03 .. 2027-02).
--
-- Amounts are INTEGERS in Egyptian Pounds (EGP); currency is carried for
-- display and stays 'EGP'. The formula fields snapshot the configuration the
-- invoice was computed with (Finance/1 settings can change later without
-- rewriting history):
--   max_active_children  the PEAK number of active children at any point in
--                        the cycle (KID-245: not the end-of-month count)
--   billable_children    max(0, max_active_children - free threshold); only
--                        children from #11 onward add money
--   flat_rate_amount     the flat rate charged every monthly cycle
--   incremental_rate     the per-extra-child rate
--   incremental_amount   billable_children x incremental_rate
--   total_amount         the payable amount; manually overridable by the
--                        platform operator BEFORE payment (the override
--                        persists; the formula fields keep their snapshot)
--   manual_adjustment    the operator's note explaining an override
--
-- Lifecycle (lib/billing.ts):
--   pending  generated at cycle end, due by the 5th of the following month
--   overdue  past due_date and still unpaid -> the daycare's institute.active
--            is set to 0 (existing KID-199.3 setInstituteActive), blocking
--            all of its users at login with the billing-specific message
--   paid     operator marks it paid (paid_at); the daycare is re-activated
--            when no other overdue invoice remains

CREATE TABLE IF NOT EXISTS daycare_invoice (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  cycle_month TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'monthly' CHECK (plan IN ('demo', 'monthly', 'annual')),
  max_active_children INTEGER NOT NULL DEFAULT 0,
  billable_children INTEGER NOT NULL DEFAULT 0,
  flat_rate_amount INTEGER NOT NULL DEFAULT 0,
  incremental_rate INTEGER NOT NULL DEFAULT 0,
  incremental_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EGP',
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue')),
  paid_at TIMESTAMPTZ,
  manual_adjustment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A cycle is billed once. The full unique index (not partial) is what lets
-- both engines insert with ON CONFLICT (institute_id, cycle_month) DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS uq_daycare_invoice_cycle
  ON daycare_invoice (institute_id, cycle_month);

-- Overdue enforcement scans by status + due date; the /platform invoice list
-- reads one institute's history in cycle order.
CREATE INDEX IF NOT EXISTS idx_daycare_invoice_status_due
  ON daycare_invoice (status, due_date);
CREATE INDEX IF NOT EXISTS idx_daycare_invoice_institute
  ON daycare_invoice (institute_id, cycle_month DESC);
