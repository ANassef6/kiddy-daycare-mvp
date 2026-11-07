-- KID-500: one-time repair for the stuck `email_confirmed = 0` mirror flag on
-- accounts whose activation COMPLETED through an invite — the mayoda0@gmail.com
-- report (Sunshine Daycare, 2026-11-06).
--
-- Why the row got stuck: registerAction creates the account (and a GoTrue
-- user when one can be created) and then activates through the submitted
-- invite — linkFamily + the invite flip to `accepted`. When the GoTrue
-- sign-up was rate-limited (her case: email_error "email rate limit exceeded")
-- or fell through to the app-side adoption (auth_user_id = null), nothing
-- ever sent or processed a confirmation email, so the GoTrue login-time flag
-- sync (loginAction, `email_confirmed_at && !emailConfirmedFor(account)`) had
-- nothing to run and the local mirror stayed 0 forever. An account that could
-- already sign in kept rendering the admin "Resend activation" affordance and
-- the /welcome confirm banner. (KID-499 fixed the banner's staleness; the
-- underlying row state is what this migration repairs, mirroring what the
-- runtime does from KID-500 onward: a consumed single-use invite issued to
-- the exact address IS the email-ownership proof.)
--
-- What it does: nothing but moving the mirror flag 0 → 1, for accounts that
-- completed a real activation. The predicate asserts every condition on live
-- data, so re-running is a no-op (flagged rows leave the candidate set):
--
--   - role = 'parent' AND staff_id IS NULL — staff/admin mirrors are always
--     excluded (KID-485 renamed the legacy staff/carer roles, so any
--     non-parent role is out of scope whatever it is called).
--   - EXISTS an `accepted` invite whose email matches the account's own
--     address (trimmed/lowercased both sides) — the single-use code was
--     redeemed, which is the ownership evidence. An accepted invite issued
--     to a DIFFERENT address proves nothing about this one.
--   - EXISTS at least one family link to a child that is neither withdrawn
--     nor deactivated — the activation itself must still be alive. A parent
--     of ONLY withdrawn children (a genuine enrollment end) and a zero-link
--     orphan keep the old flag; the KID-498 heal governs orphans, and the
--     "Resend activation" affordance would be wrong to hide on either.
--
-- Deliberately NOT touched: her account's already-repaired row (this predicate
-- releases it as a no-op), her password, children, centre, and the accepted
-- invite itself; every other account column; any invite row.

UPDATE account a
SET email_confirmed = 1
WHERE a.role = 'parent'
  AND a.staff_id IS NULL
  AND COALESCE(a.email_confirmed, 0) = 0
  AND EXISTS (
    SELECT 1
    FROM invite i
    WHERE lower(trim(i.email)) = lower(trim(a.email))
      AND i.status = 'accepted'
  )
  AND EXISTS (
    SELECT 1
    FROM family_member fm
    JOIN child c ON c.id = fm.child_id
    WHERE fm.account_id = a.id
      AND c.status != 'withdrawn'
      AND c.active = 1
  );
