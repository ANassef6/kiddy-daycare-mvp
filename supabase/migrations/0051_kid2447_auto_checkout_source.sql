-- KID-2447: a check-out row must say WHY it exists.
--
-- The end-of-working-hours sweep writes a check-out with no pickup person,
-- because nobody picked the child up — the system closed the attendance day.
-- Until now every `check_in` row looked identical (actor = system account plus
-- a timestamp), so attendance history and dashboards could not tell an
-- automatic close from a real pickup.
--
-- `source` is NULL for every existing/manual/staff/parent write. The sweep
-- writes the literal 'auto_end_of_day'. Readers use it only as a display
-- marker; no rule depends on it.
--
-- Idempotent: safe to apply on every app startup.

ALTER TABLE check_in ADD COLUMN IF NOT EXISTS source TEXT;
