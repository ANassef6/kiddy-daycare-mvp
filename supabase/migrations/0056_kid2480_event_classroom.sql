-- KID-2480: events can target one classroom instead of the whole center.
--
-- NULL keeps the existing behavior: the event is visible to every family in
-- the center. A non-NULL classroom_id scopes the event to the children in
-- that room; a parent sees center-wide events plus events for their own
-- children's rooms, never another room's event.
--
-- ON DELETE SET NULL: deleting a room must not delete its events — they fall
-- back to center-wide rather than vanishing (or blocking the room delete).
--
-- Idempotent: safe to apply on every app startup.

ALTER TABLE event
  ADD COLUMN IF NOT EXISTS classroom_id TEXT REFERENCES room(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_classroom ON event (classroom_id);
