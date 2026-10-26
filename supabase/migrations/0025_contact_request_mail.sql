-- KID-238: platform-inbox notification tracking for public contact requests.
--
-- Every "Book a demo / Contact us" submission is now notified best-effort to
-- the platform contact inbox (lib/site PLATFORM_CONTACT_EMAIL) through the
-- app's existing mail path. These columns record that attempt's outcome on
-- the request row so "did this reach the inbox?" is answerable from the
-- database, not only from server logs — the same pattern the invite row uses
-- (0014_parent_invite_email.sql):
--
-- - email_sent_at: last time the provider accepted the notification (NULL = never).
-- - email_error:   last failure/no-provider detail (NULL = last attempt succeeded).
--
-- ADD COLUMN IF NOT EXISTS keeps the file idempotent, matching the migration
-- properties in docs/CONTACT_AND_ACCOUNTS.md (no transaction wraps a file, so
-- a partial re-run must be safe).

ALTER TABLE contact_request ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;
ALTER TABLE contact_request ADD COLUMN IF NOT EXISTS email_error TEXT;
