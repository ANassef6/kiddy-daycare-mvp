-- KID-2481: rooms can carry a photo, not only a colour.
--
-- Renumbered from 0055_kid2481_room_photo.sql by KID-2506 (duplicate prefix
-- cleanup); the body is unchanged and the column add is already guarded.
--
-- The column stores the same private REF model as child/staff photos
-- ("kiddy-private:<path>" or "r2-private:<path>"); render sites mint a signed
-- URL from it. A NULL photo_url means the room keeps its colour-only dot.
--
-- Idempotent: safe to apply on every app startup.

ALTER TABLE room ADD COLUMN IF NOT EXISTS photo_url TEXT;
