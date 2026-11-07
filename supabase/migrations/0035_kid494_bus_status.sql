-- KID-489 item 5 (KID-494): the child bus on/off status ledger.
--
-- One appended row per bus transition, mirroring how `check_in` records
-- attendance events: `type` is 'on' (child got on the bus / picked up by bus)
-- or 'off' (child got off the bus). `auto` marks system-written transitions
-- (the close+2h sweep that auto-sets off-bus when staff forget), so the UI
-- and tests can distinguish "staff set it" from "the system swept it".
--
-- There is deliberately NO mutable status column on child: today's bus
-- status is always derived from the latest `bus_event` of the day. Showing
-- the state as a derivation keeps repeated sweeps idempotent and preserves
-- the full transition history for attendance reports.
--
-- Nothing else in the schema changes: the auto check-in/check-out side
-- effects keep riding the existing `check_in` rows so todayStatus /
-- attendanceOn and the 3h auto-checkout sweep behave exactly as before.
--
-- Idempotent: safe to apply on every app startup.

CREATE TABLE IF NOT EXISTS bus_event (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('on', 'off')),
  auto SMALLINT NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Latest-event reads are (child, recorded_at) scans, both from the staff
-- roster and the close+2h auto-off sweep.
CREATE INDEX IF NOT EXISTS idx_bus_event_child ON bus_event (child_id, recorded_at DESC);
