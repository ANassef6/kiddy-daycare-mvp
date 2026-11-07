-- KID-489 item 6 (KID-495): temporary passwords must be changed on first use.
--
-- `must_change_password = 1` marks an account whose current password was a
-- temporary credential shared out-of-band by the daycare (staff added with a
-- temp password, parent login created beside the invite flow). The flag is
-- UI guidance only: after login the app shows a NON-blocking prompt pointing
-- at account settings — it never locks the user out and never expires the
-- session. Account settings (staff/admin and parent) clear the flag on a
-- successful change-password.
--
-- SMALLINT + 0/1 matches the flag style used elsewhere (institute.active,
-- staff.active). All existing accounts default to 0 (no Kiddy code path
-- before this migration created temp-password accounts without a later
-- self-service change being possible via "Forgot password").

ALTER TABLE account ADD COLUMN IF NOT EXISTS must_change_password SMALLINT NOT NULL DEFAULT 0;
