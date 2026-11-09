-- KID-1329: one center-level toggle for the parent check-in/out surface.
--
-- The parent app (web + mobile) lets parents check their children in/out and
-- register pickup times. Some daycares want that flow staff-only, so the
-- institute carries a single toggle: "Allow parents to check
-- in/out", default ON (the behavior every existing deployment had). When OFF:
-- the parent-facing check-in/out control disappears, the web server action
-- (lib/actions.ts checkInOutAction) and the mobile POST
-- /api/mobile/children/[id]/check-in reject the write with a clear error,
-- and the attendance status display stays visible. The pickup role's
-- dedicated pickup-time registration and the staff attendance controls are
-- NOT governed by this toggle.
--
-- Idempotent: safe to apply on every app startup.

ALTER TABLE institute ADD COLUMN IF NOT EXISTS allow_parent_check_inout SMALLINT NOT NULL DEFAULT 1;
