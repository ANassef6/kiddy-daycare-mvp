-- KID-2448: the bus cycle records WHY an attendance row exists.
--
-- The bus off-bus transition now writes a real `check_in` row (morning off-bus
-- auto-checks the child in, afternoon off-bus auto-checks them out). Marking
-- those rows with `source = 'bus'` lets attendance history, exports and
-- dashboards distinguish a bus-driven transition from a manual check-in/out.
--
-- `source` is NULL for every manual/staff/parent write, so existing rows and
-- readers keep their behavior. The same column also carries KID-2447's
-- `auto_end_of_day` marker; both features share one nullable column instead of
-- one column each.
--
-- Idempotent: safe to apply on every app startup (and safe to apply alongside
-- the KID-2447 migration that adds the same column).

ALTER TABLE check_in ADD COLUMN IF NOT EXISTS source TEXT;
