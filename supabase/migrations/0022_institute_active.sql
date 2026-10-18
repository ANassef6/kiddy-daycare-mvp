-- KID-199.3: platform foundation — institute activation flag.
--
-- `active = 1` (default) an enabled daycare; `active = 0` a disabled one.
--
-- Enforcement (this migration only carries the data flag):
--   - Staff and parents whose whole tenancy sits on a disabled institute are
--     blocked at login (lib/actions.ts loginAction) and at portal / parent
--     entry (lib/require.ts requireSessionWithWithdrawalCheck), with a
--     friendly message in the family `no_access` style.
--   - Re-enabling (active back to 1) restores access; nothing is deleted.
--
-- SMALLINT + 0/1 matches the column style used elsewhere (child.active,
-- staff.active) and stays readable from both engines.

ALTER TABLE institute ADD COLUMN IF NOT EXISTS active SMALLINT NOT NULL DEFAULT 1;
