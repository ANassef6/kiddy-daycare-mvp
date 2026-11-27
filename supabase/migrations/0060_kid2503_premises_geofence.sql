-- KID-2503: geofenced check-in/out.
--
-- Center settings gain a premises latitude/longitude and a radius preset
-- (150 / 300 / 600 m, default 150). Both coordinates unset means the geofence
-- is OFF and the historical behavior is unchanged.
--
-- Every staff status row and every child check-in/out ledger row keeps the
-- coordinates captured for that write (plus GPS accuracy when the device
-- reports it) so a decision can be audited after the fact. The override flag
-- marks a row written by an admin for someone else without the fence.
--
-- Idempotent: safe to apply on every app startup.

ALTER TABLE institute
  ADD COLUMN IF NOT EXISTS premises_lat DOUBLE PRECISION;
ALTER TABLE institute
  ADD COLUMN IF NOT EXISTS premises_lng DOUBLE PRECISION;
ALTER TABLE institute
  ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER NOT NULL DEFAULT 150;

ALTER TABLE staff_status
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE staff_status
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE staff_status
  ADD COLUMN IF NOT EXISTS accuracy_m DOUBLE PRECISION;
ALTER TABLE staff_status
  ADD COLUMN IF NOT EXISTS geofence_override SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE check_in
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE check_in
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE check_in
  ADD COLUMN IF NOT EXISTS accuracy_m DOUBLE PRECISION;
ALTER TABLE check_in
  ADD COLUMN IF NOT EXISTS geofence_override SMALLINT NOT NULL DEFAULT 0;
