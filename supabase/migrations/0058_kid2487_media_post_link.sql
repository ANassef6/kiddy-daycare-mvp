-- KID-2487: a newsfeed post photo can be tagged to one or more children.
--
-- The photo itself stays on newsfeed_post.media_url. Tagging only adds a media
-- row per child that points at the SAME stored object (same URL/REF); the
-- child profile media section already renders those rows. One physical file,
-- multiple child links — never a duplicated upload.
--
-- post_id is NULL for media that did not come from a newsfeed post (child
-- photos, event galleries, seed media). ON DELETE CASCADE: deleting the post
-- removes its links, never the child rows themselves.
--
-- Idempotent: safe to apply on every app startup.

ALTER TABLE media
  ADD COLUMN IF NOT EXISTS post_id TEXT REFERENCES newsfeed_post(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_media_post ON media (post_id);
CREATE INDEX IF NOT EXISTS idx_media_child ON media (institute_id, child_id);
