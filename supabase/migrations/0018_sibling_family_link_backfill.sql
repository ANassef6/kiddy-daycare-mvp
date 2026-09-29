-- KID-146: link children that already existed to the parent account that
-- already owns their email address.
--
-- KID-142 wired the sibling auto-link into addContact(), updateContact() and
-- the register path only. `familiesForAccount()` — the single read path behind
-- every /child/* page — renders from `family_member` alone, so a child whose
-- contact was added *before* 05be841 has no family_member row and never appears
-- in that parent's children list. Re-typing the data was the only fix, which is
-- the exact symptom reported on KID-145.
--
-- Migration 0017 only deduped existing rows and added the unique index; it did
-- not create the missing links. This migration reconciles the existing data:
-- for every (parent account, child) pair where a contact on that child carries
-- the account's email, the missing family_member row is created. No staff
-- re-entry required.
--
-- Deliberate properties:
--  - INSERT-only. An existing family_member row is never updated, so a role an
--    admin set deliberately (e.g. a downgraded or `no_access` link) survives.
--  - Idempotent. `ON CONFLICT (account_id, child_id)` needs the unique index
--    from 0017, which the numeric filename ordering guarantees ran first; the
--    guard below turns a missing index into a legible error instead of 42P10.
--  - One statement, so re-running it is safe at any point.
--
-- Matching rules mirror `linkSiblingsByParentEmail` (lib/store.ts):
--  - Case-insensitive, whitespace-trimmed on both sides (normalizeParentEmail).
--  - Scoped by the child's institute, so a contact typed at one centre never
--    links a child of another. `account` is not institute-scoped in the schema
--    (a parent may have children at two centres), so the child supplies it.
--  - Only `role = 'parent'` accounts are linked; staff/admin accounts must
--    never gain family access as a side effect.
--  - Inactive/withdrawn children are linked too. `familiesForAccount` already
--    filters `c.active = 1`, so the link is invisible while withdrawn and
--    access returns without a gap if the child is reactivated.
--  - The contact's `relationship` becomes the link role, falling back to
--    'parent' for anything outside the KID-112 enum (same default as
--    normalizeLegacyRelationship: never lock a real parent out on bad data).
--  - When several same-email contacts on one child disagree about the role,
--    the most permissive wins — the same rule `familyAccessForAccount` already
--    applies across an account's links, so the stored role never contradicts
--    the access the app actually grants.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_family_member_account_child') THEN
    RAISE EXCEPTION
      'KID-146: uq_family_member_account_child is missing. Apply 0017_family_member_unique.sql before 0018_sibling_family_link_backfill.sql.';
  END IF;
END
$$;

INSERT INTO family_member (id, account_id, child_id, role)
SELECT
  md5(random()::text || clock_timestamp()::text || ranked.account_id || ranked.child_id),
  ranked.account_id,
  ranked.child_id,
  ranked.role
FROM (
  SELECT
    matched.account_id,
    matched.child_id,
    matched.role,
    ROW_NUMBER() OVER (
      PARTITION BY matched.account_id, matched.child_id
      ORDER BY
        CASE matched.role
          WHEN 'parent'    THEN 0
          WHEN 'family'    THEN 1
          WHEN 'pickup'    THEN 2
          ELSE 3
        END,
        matched.role
    ) AS rn
  FROM (
    SELECT
      a.id  AS account_id,
      c.id  AS child_id,
      CASE
        WHEN lower(trim(co.relationship)) IN ('parent', 'family', 'pickup', 'no_access')
          THEN lower(trim(co.relationship))
        ELSE 'parent'
      END AS role
    FROM contact co
    JOIN child c  ON c.id = co.child_id
    JOIN account a
      ON a.role = 'parent'
     AND lower(trim(a.email)) = lower(trim(co.email))
    WHERE co.email IS NOT NULL
      AND trim(co.email) <> ''
  ) matched
) ranked
WHERE ranked.rn = 1
ON CONFLICT (account_id, child_id) DO NOTHING;
