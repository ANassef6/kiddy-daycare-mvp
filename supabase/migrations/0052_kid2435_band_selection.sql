-- KID-2435: the operator can pick the band when a branch is on the monthly
-- plan, and bus tracking / branded app are always on.
--
-- The founder's 19 Nov 2026 feedback on the staging test:
--   * show a short band reference (counts and prices) at the top;
--   * choose demo or monthly from a plan drop-down;
--   * when monthly is chosen, also choose the band;
--   * remove the bus-tracking and branded-app ticks — both are always on.
--
-- `band_key` is the contracted band. An empty value keeps the automatic
-- behaviour (the band is resolved from the cycle peak child count). A set
-- value pins the branch to the chosen band, so a new account with no children
-- yet can still be sold the band the client signed up for.
--
-- `daycare_billing` keeps the group-level default the create form writes;
-- `branch_billing` is the subscription record the engine reads.

ALTER TABLE daycare_billing ADD COLUMN IF NOT EXISTS band_key TEXT NOT NULL DEFAULT '';
ALTER TABLE branch_billing ADD COLUMN IF NOT EXISTS band_key TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_branch_billing_band ON branch_billing (band_key);

-- Bus tracking is included in every paid band, and branded app + bus tracking
-- are on for demo accounts. The checkboxes are gone from the operator page, so
-- existing rows are normalised to the always-on state.
UPDATE pricing_band SET bus_tracking_included = 1;

UPDATE pricing_config
SET value = '1', updated_at = CURRENT_TIMESTAMP
WHERE key IN ('demo.branded_app', 'demo.bus_tracking');
