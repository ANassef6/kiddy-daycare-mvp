-- KID-2437: each center carries an explicit IANA timezone.
--
-- Working hours (institute.opening_hours) are wall-clock values for the
-- CENTER, not for the server. Every working-hours rule (check-in gate,
-- pickup-time validation, auto check-out / auto off-bus cutoffs, attendance
-- day boundaries) must project the stored UTC instant into this zone before
-- comparing clocks or calendar days.
--
-- Default: Africa/Cairo. Every center on the platform at migration time is
-- Egyptian, so the backfill keeps their current local rules rather than
-- silently shifting them to UTC. Centers in another zone change the value in
-- Settings → Center details (admin-only).
--
-- Idempotent: safe to apply on every app startup.

ALTER TABLE institute ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Africa/Cairo';

UPDATE institute
SET timezone = 'Africa/Cairo'
WHERE timezone IS NULL OR btrim(timezone) = '';
