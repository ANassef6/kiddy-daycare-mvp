-- KID-258 A1 (KID-264): the daycare owner's "Enhancements requests" record.
--
-- One row per feature/enhancement a daycare OWNER submits from the portal
-- (/portal/enhancements). The app NEVER calls Linear itself (no app-side
-- Linear token — decision locked on KID-258); the KID-258 Linear sync agent
-- (child task A2) owns everything Linear-side and writes its results back
-- through app/api/enhancements/write-back. This table is the hand-off point
-- between the two halves:
--
-- Lifecycle (lib/enhancements.ts):
--   queued          the owner just submitted it; the sync agent has not
--                   picked it up yet
--   linear_created  the sync agent created the Linear issue; linear_issue_id
--                   / linear_issue_url are set
--   synced          the Linear write-back (priority, estimate, due_date,
--                   expected_delivery) has been applied; a TERMINAL state
--   sync_error      the last sync attempt failed (retryable — still an OPEN
--                   request, not terminal); sync_error_detail carries the
--                   failure text from the sync agent
--
-- customer_request is the HUMAN-facing daycare name (e.g. "Sunshine"),
-- denormalized at submit time so the sync agent can paste it into the Linear
-- issue title/description without a second tenant lookup.
--
-- The open-title de-dup is schema-enforced like the KID-245 cycle uniqueness:
-- a partial unique index keeps one OPEN request per (daycare, exact title),
-- so two concurrent submits cannot both win. Open = not yet terminal, i.e.
-- status <> 'synced' (sync_error is retryable and still counts as open).

CREATE TABLE IF NOT EXISTS enhancement_request (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'linear_created', 'synced', 'sync_error')),
  linear_issue_id TEXT,
  linear_issue_url TEXT,
  priority TEXT,
  estimate INTEGER,
  due_date DATE,
  expected_delivery DATE,
  sync_error_detail TEXT,
  customer_request TEXT,
  requested_by_account_id TEXT REFERENCES account(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ
);

-- The list view reads one daycare's requests newest-first; the sync agent
-- sweeps by status (queued/sync_error first). Both get an index (foreign keys
-- and WHERE/ORDER BY columns are always indexed in this repo).
CREATE INDEX IF NOT EXISTS idx_enhancement_request_institute
  ON enhancement_request (institute_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enhancement_request_status
  ON enhancement_request (status, created_at);
CREATE INDEX IF NOT EXISTS idx_enhancement_request_requested_by
  ON enhancement_request (requested_by_account_id);

-- KID-258 A1: block identical OPEN titles per daycare at the schema level
-- (not just in the action), so a race between two submits stays impossible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_enhancement_request_open_title
  ON enhancement_request (institute_id, title)
  WHERE status <> 'synced';
