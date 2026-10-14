-- KID-178/4 (KID-182): composer attachments
--
-- Attachments sent through the composer are stored on the thread itself so
-- both the staff portal and the parent view render/download them. The
-- migration is idempotent: on a database where the columns already exist
-- (fresh installs get them at CREATE TABLE time) the DO block does nothing.

DO $$
BEGIN
  EXECUTE 'ALTER TABLE message_thread ADD COLUMN attachment_url TEXT';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'ALTER TABLE message_thread ADD COLUMN attachment_name TEXT';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;
