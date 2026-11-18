-- KID-2434: Kiddy pricing v2 product configuration (approved on KID-2433).
--
-- Pricing is operator-editable configuration, not code. The six standard
-- bands live in pricing_band and the demo/founding-cohort policy lives in
-- pricing_config; the platform operator edits both from /platform/pricing.
--
-- Annual is always 10x monthly for a standard band (two months free, paid
-- upfront). Enterprise+ is the only quote band: its annual amount is null
-- until the operator supplies a per-client quote.
--
-- The founding cohort keeps its year-1 monthly amount on the band row. The
-- standard amount remains the year-2 amount, so reverting after year 1 needs
-- no data rewrite.

CREATE TABLE IF NOT EXISTS pricing_band (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  min_children INTEGER NOT NULL CHECK (min_children >= 1),
  max_children INTEGER CHECK (max_children IS NULL OR max_children >= min_children),
  monthly_egp INTEGER NOT NULL CHECK (monthly_egp >= 0),
  annual_egp INTEGER CHECK (annual_egp IS NULL OR annual_egp >= 0),
  annual_is_quote INTEGER NOT NULL DEFAULT 0,
  per_child_overage_egp INTEGER NOT NULL DEFAULT 0 CHECK (per_child_overage_egp >= 0),
  founding_monthly_egp INTEGER CHECK (founding_monthly_egp IS NULL OR founding_monthly_egp >= 0),
  bus_tracking_included INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (annual_is_quote = 1 OR annual_egp = monthly_egp * 10)
);

CREATE INDEX IF NOT EXISTS idx_pricing_band_order ON pricing_band (sort_order);

INSERT INTO pricing_band
  (key, name, min_children, max_children, monthly_egp, annual_egp, annual_is_quote,
   per_child_overage_egp, founding_monthly_egp, bus_tracking_included, sort_order)
VALUES
  ('seed', 'Seed', 1, 15, 600, 6000, 0, 0, 510, 1, 1),
  ('core', 'Core', 16, 30, 950, 9500, 0, 0, 810, 1, 2),
  ('standard', 'Standard', 31, 50, 1400, 14000, 0, 0, 1190, 1, 3),
  ('plus', 'Plus', 51, 80, 1900, 19000, 0, 0, 1620, 1, 4),
  ('enterprise', 'Enterprise', 81, 120, 2500, 25000, 0, 0, 2130, 1, 5),
  ('enterprise_plus', 'Enterprise+', 121, NULL, 2500, NULL, 1, 20, NULL, 1, 6)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE daycare_billing ADD COLUMN IF NOT EXISTS founding_client INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daycare_billing ADD COLUMN IF NOT EXISTS founding_started_at DATE;
ALTER TABLE daycare_billing ADD COLUMN IF NOT EXISTS pilot_end_date DATE;

CREATE TABLE IF NOT EXISTS pricing_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO pricing_config (key, value) VALUES
  ('demo.trial_days', '30'),
  ('demo.room_limit', '1'),
  ('demo.child_limit', '20'),
  ('demo.branded_app', '0'),
  ('demo.bus_tracking', '0'),
  ('founding.enabled', '1'),
  ('founding.cap', '10'),
  ('founding.offer_days', '90'),
  ('founding.launch_date', ''),
  ('founding.pilot_fee_egp', '350'),
  ('founding.pilot_days', '30'),
  ('founding.pilot_room_limit', '1'),
  ('founding.pilot_child_limit', '20'),
  ('founding.pilot_credit_days', '14'),
  ('founding.glide_max_increase_pct', '20')
ON CONFLICT (key) DO NOTHING;
