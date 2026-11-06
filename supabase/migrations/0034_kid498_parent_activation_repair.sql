-- KID-498: one-time repair for orphan parent accounts — the production state
-- behind the Sunshine Daycare lockout (2026-11-06).
--
-- registerAction creates the `account` row first and links the child in a
-- later step (linkFamily). When that later step failed, the parent was left
-- half-activated: zero `family_member` rows, the invite still `pending`, and
-- the old withdrawal rule (`isAccountAccessWithdrawn` treating "zero links"
-- the same as "every linked child withdrew") answered every login with
-- "This account's access has been withdrawn." That message was false — the
-- enrollment had never started. The Sunshine incident was fixed by hand (a
-- single family_member row + the invite flipped to accepted); this migration
-- finds every other row in the same shape and finishes the activation, so no
-- future environment needs to re-run the manual repair.
--
-- What it does, in two statements:
--
--   1. For every `role = 'parent'` account holding ZERO family_member rows,
--      find the newest still-`pending` invite addressed to the account's own
--      email which names a child (`child_id IS NOT NULL`).
--   2. Link that exact child — and only that exact child — with the invite's
--      own role (default 'parent', same rule as 0018/linkFamily).
--   3. Mark the invite `accepted`, same write registerAction makes. Statement
--      2's predicate also covers the ACT-INVITE failure shape (link restored,
--      invite never consumed): the account linked to the invite's only child
--      with no other links is the same half-activated account by another
--      door.
--
-- Deliberate properties:
--
--  - Insert-only on family_member. An account that already holds ANY link is
--    excluded by the `NOT EXISTS` guard, so a deliberately-set role, a
--    `no_access` link, a staff member's data — none of it is touched or
--    re-derived. Re-running is a no-op: healed accounts drop out of the
--    candidate set on the next pass, and accepted invites drop out of the
--    pool. The invite-status update only moves `pending` → `accepted`.
--  - The invite is the tenant anchor, and the ONLY child ever linked is the
--    one the invite names. No same-email contact join, no sibling inference —
--    this repair does not repeat (and cannot re-open) the KID-152 leak where
--    a shared address at a second centre gained family access. A contact at
--    another centre carrying the same email is invisible to this statement.
--  - The invite's own `institute_id` must agree with the child's
--    `institute_id`. When they disagree, the invite row is damaged data and is
--    REFUSED (stays pending), not repaired into a cross-tenant grant. The
--    "missing on one side" fallback written into the predicate is pure
--    defense-in-depth: invite.institute_id is NOT NULL today, so it can only
--    fire if a future schema ever relaxes that.
--  - Withdrawn or inactive children are never linked and their invites stay
--    pending: finishing an activation into a withdrawn child would grant a
--    login that is withdrawn at first page load. KID-86 semantics decide
--    access by status, so both `status = 'withdrawn'` and `active = 0` refuse.
--  - Staff/admin exclusion belt-and-braces: `role = 'parent'` is required and
--    `staff_id IS NULL` is asserted (KID-485 renamed the old staff/carer
--    accounts; whatever a non-parent role is called, it is out of scope here).
--
-- Numbering note: 0033 (KID-485 role model) runs first and renames legacy
-- staff/carer accounts, so by the time this file runs the role vocabulary is
-- current and this file's `role = 'parent'` guard is exact.
--
-- Do NOT attempt to also delete the pending invite of a refused pair: leaving
-- it pending is what keeps the runtime self-heal (lib/store.ts
-- healParentActivation) and the admin able to see and fix the damaged row by
-- hand, which is the same conservative-miss rule 0018 documents.

DO $$
BEGIN
  IF to_regclass('uq_family_member_account_child') IS NULL THEN
    RAISE EXCEPTION
      'KID-498: uq_family_member_account_child is missing. Apply 0017_family_member_unique.sql before 0034_kid498_parent_activation_repair.sql.';
  END IF;
END
$$;

-- === Statement 1: restore the missing family links =========================
-- The candidate pool: a parent account with no links at all, and its newest
-- still-pending, child-naming invite. One row per account (invite_rn = 1) so
-- a mailbox full of stale invites heals from exactly one of them, the same
-- newest-first rule getPendingInvitesByEmail applies.

WITH orphan AS (
  SELECT
    a.id AS account_id,
    i.id AS invite_id,
    i.child_id AS child_id,
    i.institute_id AS invite_institute_id,
    CASE
      WHEN lower(trim(i.role)) IN ('parent', 'family', 'pickup', 'no_access')
        THEN lower(trim(i.role))
      ELSE 'parent'
    END AS role,
    ROW_NUMBER() OVER (
      PARTITION BY a.id
      ORDER BY i.created_at DESC, i.id DESC
    ) AS invite_rn
  FROM account a
  JOIN invite i
    ON lower(trim(i.email)) = lower(trim(a.email))
   AND i.status = 'pending'
   AND i.child_id IS NOT NULL
  WHERE a.role = 'parent'
    AND a.staff_id IS NULL
    -- Only true orphans: an account already holding any link is never
    -- touched, whatever those links' roles say.
    AND NOT EXISTS (
      SELECT 1 FROM family_member fm WHERE fm.account_id = a.id
    )
),
repairable AS (
  SELECT o.*
  FROM orphan o
  JOIN child c ON c.id = o.child_id
  WHERE o.invite_rn = 1
    -- A withdrawn/inactive child is never linked: finishing the activation
    -- would grant a login that is withdrawn at first page load. The invite
    -- stays pending so the runtime self-heal and the admin keep seeing it.
    AND c.status != 'withdrawn'
    AND c.active = 1
    -- The tenant anchor: the invite's own institute must be the child's.
    -- Both sides MISSING is the only legacy fallback (the invite authorizes
    -- the child by naming it); a present mismatch is damaged data and stays
    -- pending rather than being repaired into a cross-tenant grant.
    AND (o.invite_institute_id IS NULL OR c.institute_id IS NULL OR o.invite_institute_id = c.institute_id)
)
INSERT INTO family_member (id, account_id, child_id, role)
SELECT
  md5(random()::text || clock_timestamp()::text || repairable.account_id || repairable.child_id),
  repairable.account_id,
  repairable.child_id,
  repairable.role
FROM repairable
ON CONFLICT (account_id, child_id) DO NOTHING;

-- === Statement 2: consume the invites the healing touched =================
-- Accepted here is exactly the invite whose pair the repair (or the register
-- flow itself, in the ACT-INVITE failure shape) put in place: the account is
-- a parent linked to the invite's own child AND to no other child, the child
-- is still eligible, and the invite's own institute still agrees with the
-- child's. Every condition is re-asserted on the live data, so a replay
-- accepts nothing new: healed invites are no longer `pending`, and an
-- already-used invite never re-opens.
UPDATE invite
SET status = 'accepted'
WHERE status = 'pending'
  AND child_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM family_member fm
    JOIN account a ON a.id = fm.account_id
    WHERE lower(trim(invite.email)) = lower(trim(a.email))
      AND fm.child_id = invite.child_id
      AND a.role = 'parent'
      AND a.staff_id IS NULL
      -- The account holds no family link to any OTHER child: a stale pending
      -- invite for a second child of an already-onboarded parent is not this
      -- repair's business.
      AND NOT EXISTS (
        SELECT 1 FROM family_member other
        WHERE other.account_id = a.id
          AND other.child_id IS DISTINCT FROM invite.child_id
      )
  )
  AND EXISTS (
    SELECT 1 FROM child c
    WHERE c.id = invite.child_id
      AND c.status != 'withdrawn'
      AND c.active = 1
      AND (invite.institute_id IS NULL OR c.institute_id IS NULL OR invite.institute_id = c.institute_id)
  );
