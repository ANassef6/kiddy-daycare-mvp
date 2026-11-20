-- KID-2455: per-message attachments + per-participant thread archive
--
-- 1. A message can carry one attachment. The URL is either an R2 private REF
--    (KID-2453) or a legacy data URL; the name is the original file name.
-- 2. Archiving is a per-viewer preference. It lives on the participant row so
--    one participant archiving a thread never hides it for anyone else.
--
-- Idempotent on databases where a fresh install already has the columns.

DO $$
BEGIN
  EXECUTE 'ALTER TABLE message ADD COLUMN attachment_url TEXT';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'ALTER TABLE message ADD COLUMN attachment_name TEXT';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'ALTER TABLE message_thread_participant ADD COLUMN archived_at TIMESTAMPTZ';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;
