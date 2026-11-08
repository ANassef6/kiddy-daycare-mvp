-- KID-745: the signed daycare contract, stored per daycare and surfaced on
-- the platform's per-daycare settings page (/platform/daycares/[id]/billing).
--
-- One row per daycare (institute_id is the primary key, so the per-daycare
-- settings page can never show two contract rows for one center):
--   institute_id            tenant scope + identity of the contract.
--   template_version        the version of the contract template the draft
--                             was generated from (filled by the content
--                             task; NULL until then).
--   draft_url               the generated draft's Storage URL (content task).
--   draft_generated_at      when that draft was generated.
--   signed_url              the CURRENT signed contract's Storage URL. An
--                             upload always replaces the whole signed
--                             snapshot (url + file name + date + uploader
--                             move together), so a re-upload can never
--                             leave a stale pointer behind.
--   signed_file_name        the operator-visible original file name.
--   signed_uploaded_at      ISO timestamp of the current signed upload.
--   uploaded_by_account_id  the operator who uploaded it (SET NULL so
--                             deleting an account never breaks history —
--                             same style as 0015/0026/0030).
--   created_at / updated_at database timestamps (pg now() /
--                             SQLite datetime('now')), matching every
--                             other table in this schema.
--
-- Contract files are confidential. Storage follows the existing
-- kiddy-public bucket pattern with a long random object suffix (see
-- lib/contract.ts) — the app reads the URL through the operator-only page,
-- never a public link surface.
--
-- Idempotent: safe to apply on every app startup (ensurePgSchema skips the
-- applied ledger; a manual re-run hits CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS daycare_contract (
  institute_id TEXT PRIMARY KEY REFERENCES institute(id) ON DELETE CASCADE,
  template_version TEXT,
  draft_url TEXT,
  draft_generated_at TIMESTAMPTZ,
  signed_url TEXT,
  signed_file_name TEXT,
  signed_uploaded_at TIMESTAMPTZ,
  uploaded_by_account_id TEXT REFERENCES account(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
