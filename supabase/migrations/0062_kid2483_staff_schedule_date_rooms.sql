-- KID-2483: staff schedules can target a specific date and one or more rooms.
--
-- Renumbered from 0056_kid2483_staff_schedule_date_rooms.sql by KID-2506
-- (duplicate prefix cleanup); the body is unchanged and every statement is
-- already guarded, so re-applying it is a no-op.
--
-- `schedule_date` is NULL for the existing weekly pattern (`day_of_week`) and
-- an ISO date (YYYY-MM-DD) for a one-off shift. A dated row overrides the
-- weekly pattern for that staff member on that day; legacy weekday-only rows
-- keep working unchanged.
--
-- Rooms live in a join table so a shift can cover several rooms. Deleting a
-- schedule or a room removes its links; the shift itself is never deleted by
-- a room deletion.
--
-- Idempotent: safe to apply on every app startup.

ALTER TABLE staff_schedule
  ADD COLUMN IF NOT EXISTS schedule_date TEXT;

CREATE INDEX IF NOT EXISTS idx_schedule_date ON staff_schedule (schedule_date);
CREATE INDEX IF NOT EXISTS idx_schedule_staff_day ON staff_schedule (staff_id, day_of_week);

CREATE TABLE IF NOT EXISTS staff_schedule_room (
  schedule_id TEXT NOT NULL REFERENCES staff_schedule(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  PRIMARY KEY (schedule_id, room_id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_room_room ON staff_schedule_room (room_id);
