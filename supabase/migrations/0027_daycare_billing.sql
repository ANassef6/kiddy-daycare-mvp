-- KID-244: billing foundation — per-daycare subscription settings for the
-- platform operator (Finance/1, parent KID-243).
--
-- One row per institute (PK = institute_id, CASCADE on delete) because every
-- daycare has exactly one billing configuration, like the 0024 subdomain
-- unique rule. All amounts are integers expressed in Egyptian Pounds (EGP)
-- and are manually configurable by the platform operator at any time; the
-- billing COMPUTE itself (who is charged what, when) ships with Finance/2 —
-- this migration + the settings surface only store the configuration.
--
-- Columns:
--   plan                  demo | monthly | annual (default demo; demo bills 0)
--   monthly_rate_egp      flat monthly rate (default 500 EGP)
--   per_child_rate_egp    incremental rate for children above the threshold
--                         (default 50 EGP)
--   free_child_threshold  children included in the flat rate; charging
--                         starts at child #11 (default 10)
--   annual_amount_egp     the annual plan's full-year amount (default 24000
--                         EGP — per KID-243, "monthly ... 24000EGP per year"
--                         in the original request is the ANNUAL plan)
--   first_cycle_start     the first billed month, ISO date (the 1st of the
--                         month AFTER signup; the signup month is free).
--                         Always set at daycare creation by the store —
--                         never NULL in practice; left nullable so the row
--                         can be upserted independently.
--
-- Every existing institute gets a backfilled row with the defaults.

CREATE TABLE IF NOT EXISTS daycare_billing (
  institute_id TEXT PRIMARY KEY REFERENCES institute(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'demo' CHECK (plan IN ('demo', 'monthly', 'annual')),
  monthly_rate_egp INTEGER NOT NULL DEFAULT 500,
  per_child_rate_egp INTEGER NOT NULL DEFAULT 50,
  free_child_threshold INTEGER NOT NULL DEFAULT 10,
  annual_amount_egp INTEGER NOT NULL DEFAULT 24000,
  first_cycle_start DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daycare_billing_plan ON daycare_billing (plan);

-- Backfill every pre-existing institute: default settings, and the same
-- first_cycle_start convention the store writes at creation — the 1st of the
-- month AFTER the institute's signup (truncating to the month FIRST, then
-- advancing, so a signup late in the month stays one month out, not two).
INSERT INTO daycare_billing (institute_id, plan, first_cycle_start)
SELECT i.id, 'demo', date_trunc('month', i.created_at) + interval '1 month'
FROM institute i
WHERE NOT EXISTS (SELECT 1 FROM daycare_billing b WHERE b.institute_id = i.id);
