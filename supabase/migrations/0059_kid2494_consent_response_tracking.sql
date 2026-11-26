-- KID-2494: consents keep one request row per targeted child, and now need
-- two things the founder asked for:
--
--   batch_id                 one value per send, so the detail view can show
--                            every recipient of a classroom (or All) request.
--   responded_at             when the parent answered.
--   responded_by_account_id  which parent account answered.
--
-- Existing rows predate batching. Backfill batch_id = id, so each old row is
-- its own one-recipient batch and the detail view still opens it. The response
-- columns stay NULL until a parent answers.
--
-- Idempotent: safe to apply on every app startup.
ALTER TABLE consent_request ADD COLUMN IF NOT EXISTS batch_id TEXT;
ALTER TABLE consent_request ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;
ALTER TABLE consent_request ADD COLUMN IF NOT EXISTS responded_by_account_id TEXT
  REFERENCES account(id) ON DELETE SET NULL;

UPDATE consent_request SET batch_id = id WHERE batch_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_consent_request_institute ON consent_request (institute_id);
CREATE INDEX IF NOT EXISTS idx_consent_request_child ON consent_request (child_id);
CREATE INDEX IF NOT EXISTS idx_consent_request_batch ON consent_request (batch_id);
