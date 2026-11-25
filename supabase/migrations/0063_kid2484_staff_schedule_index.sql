-- KID-2484: the working-hours tab loads every staff member's schedule in one
-- `staff_id IN (...)` query. Index the foreign key so that lookup does not
-- scan the whole table as the roster grows.
CREATE INDEX IF NOT EXISTS idx_staff_schedule_staff_day
  ON staff_schedule (staff_id, day_of_week);
