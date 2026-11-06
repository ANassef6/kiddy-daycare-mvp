-- KID-472 item 7 — rollback SQL for the Sunshine demo admin identity migration.
--
-- Restores the account email and display name to the pre-migration values and
-- re-points the GoTrue identity email back. Reads like the migration itself:
-- idempotent lookups by the CURRENT email, no id changes, no data loss.
--
-- REPLACE the placeholders before running:
--   <GOTRUE_USER_ID>       id of the auth.users row carrying the admin login
--   <WAS_ACCOUNT_ID>       public.account id that was migrated
--
-- The password hash is NOT touched: the old placeholder password must not
-- return, and re-issuing access is a board action. Nothing here prints or
-- stores a credential.

-- 1) public.account row back to the old identity.
UPDATE public.account
   SET email     = 'admin@sunshinedaycare.test',
       full_name = 'Maria Lopez'
 WHERE id = '<WAS_ACCOUNT_ID>'
   AND email = 'trois4ever+admin@gmail.com';

-- 2) GoTrue identity back to the old email (same user id, no recreation).
UPDATE auth.users
   SET email = 'admin@sunshinedaycare.test'
 WHERE id = '<GOTRUE_USER_ID>'
   AND email = 'trois4ever+admin@gmail.com';

-- 3) identity_data email snapshot must not go stale (provider = 'email').
UPDATE auth.identities
   SET identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object(
         'email', 'admin@sunshinedaycare.test',
         'email_verified', true
       )
 WHERE user_id = '<GOTRUE_USER_ID>'
   AND provider = 'email';

-- 4) Verify: exactly one account row on each side, no stale row.
SELECT id, email, full_name FROM public.account
 WHERE lower(email) IN ('admin@sunshinedaycare.test', 'trois4ever+admin@gmail.com');

 ---------------------------------------------------------------------------
 -- 5) Optional: re-point QA-fixture authorship back, if the board wants the
 --    historical "Created by" attribution restored on the Sunshine QA rows.
 --    The 2026-11-06 application cleared ownership references row-by-row
 --    over REST (restricting FKs cannot be swapped in a single UPDATE from
 --    the app side). Proven rows re-attached at application time:
 --      - daily_report id = '<SEED_ELLA_REPORT_ID>'  (seed fixture,
 --        lib/seed.ts:211-227) -> created_by_account_id = '<WAS_ACCOUNT_ID>'
 --      - audit_event rows where actor_name = 'Maria Lopez'
 --      - newsfeed_comment id = '<QA_COMMENT_ID>' (re-inserted with body)
 --    The remaining unproven rows are disclosed in README.md ("disclosed
 --    losses"); the audit trail (KID-477) has no evidence that the admin
 --    authored them, so re-pointing them would be guesswork and is left
 --    to the board's QA re-run.
 ---------------------------------------------------------------------------

