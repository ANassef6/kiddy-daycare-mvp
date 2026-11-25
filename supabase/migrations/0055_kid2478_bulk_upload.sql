-- KID-2478: the superadmin bulk-upload run record.
--
-- Every Excel upload (children or staff) writes exactly one row here so the
-- operator can read the created/skipped/error summary and download the
-- row-level report afterwards. The report body is bounded JSON (one object per
-- spreadsheet row) and never contains passwords — accounts created by the
-- upload carry the platform default password and the forced-change flag.
--
-- Tenant-scoped: institute_id is the daycare the sheet was uploaded against.
-- Deleting the daycare removes its reports. Deleting the operator account
-- keeps the report (SET NULL) so the audit trail does not lose the run.

CREATE TABLE IF NOT EXISTS bulk_upload (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('children', 'staff')),
  actor_account_id TEXT REFERENCES account(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL DEFAULT '',
  total_rows INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  details TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bulk_upload_institute
  ON bulk_upload (institute_id, created_at DESC);

-- 0040 enabled RLS over the tables that existed when it ran; this table is
-- newer, so carry the same deny-by-default posture explicitly. The app reads
-- and writes it as the owning role (exempt from RLS); anon/authenticated get
-- nothing.
ALTER TABLE bulk_upload ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bulk_upload FROM anon, authenticated;
