-- Kiddy — auto-confirm invited-parent accounts (KID-30).
--
-- GoTrue on this project has email confirmation ENABLED and rate-limits
-- confirmation sends. A parent who registers with a daycare invite code is
-- already authenticated by that code (they are family_member-linked to a
-- child), so they should never be gated on a GoTrue confirmation email.
-- registerAction now creates invited-parent accounts with email_confirmed=1
-- going forward; this migrates any previously-registered invited parents
-- (parent accounts that already have at least one family_member link) to the
-- confirmed state so they can sign out and back in without a confirm click.

UPDATE account
SET email_confirmed = 1
WHERE role = 'parent'
  AND email_confirmed = 0
  AND id IN (SELECT account_id FROM family_member);