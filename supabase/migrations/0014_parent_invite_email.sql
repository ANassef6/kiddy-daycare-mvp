-- KID-111: parent-invite email delivery tracking.
--
-- Root cause: `inviteParentAction` wrote an `invite` row but never sent (or
-- logged) any email, while the "Send invite" button implied delivery. These
-- columns record every delivery attempt so missing activation emails are
-- visible in the database instead of silently lost.
--
-- - email_sent_at: last time a provider accepted the invite email (NULL = never).
-- - email_error:   last delivery failure message (NULL = last attempt ok/pending).
-- - resend_count:  how many admin resends were attempted.
--
-- Invite codes are single-use (consumed on register) and have no time expiry;
-- see lib/invite-email.ts.

ALTER TABLE invite ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;
ALTER TABLE invite ADD COLUMN IF NOT EXISTS email_error TEXT;
ALTER TABLE invite ADD COLUMN IF NOT EXISTS resend_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_invite_email_status ON invite (email, status);
CREATE INDEX IF NOT EXISTS idx_invite_code ON invite (code);
