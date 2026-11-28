-- KID-2479: a supply request may target one child instead of the whole centre.
--
-- The request form only had item/quantity/unit/notes, so a parent could not
-- tell which child a request was for. `child_id` is nullable: general
-- centre-wide requests keep working exactly as before, while a staff member
-- can pick a child from the dropdown. ON DELETE SET NULL keeps the historical
-- request (and its status/audit trail) if the child record is later removed,
-- turning it back into a general request instead of losing the row.
--
-- Idempotent: safe to apply on every app startup.

ALTER TABLE supply_request ADD COLUMN IF NOT EXISTS child_id TEXT REFERENCES child(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_supply_child ON supply_request (child_id);
