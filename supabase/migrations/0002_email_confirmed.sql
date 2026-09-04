-- Kiddy — email-confirmation gating for self-service signups.
--
-- Decision (KID-13): keep GoTrue email confirmation ENABLED. The management
-- API token available in this environment returns 401, so the demo project's
-- auth settings cannot be changed programmatically, and confirmation-on is the
-- safer default anyway. `email_confirmed` tracks the pending state so the app
-- stays usable while GoTrue sign-in waits for a confirmation click.
--
-- Accounts created by the seed / staff tools (no GoTrue user) default to
-- confirmed. Only GoTrue signups can be unconfirmed.

ALTER TABLE account ADD COLUMN IF NOT EXISTS email_confirmed SMALLINT NOT NULL DEFAULT 1;